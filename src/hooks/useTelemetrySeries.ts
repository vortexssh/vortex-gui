import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api,
  is2faError,
  parseCommandError,
  type Telemetry,
  type TelemetryPoint,
} from '@/lib/api'

const MAX_POINTS = 120

function snapshotsToPoints(snaps: Telemetry[]): TelemetryPoint[] {
  const points: TelemetryPoint[] = []
  let prev: { recv: number; sent: number; at: number } | null = null

  for (const snap of snaps) {
    const at = snap.collectedAt ? Date.parse(snap.collectedAt) : Date.now()
    let netRx = 0
    let netTx = 0
    if (prev && snap.netBytesRecv != null && snap.netBytesSent != null && Number.isFinite(at)) {
      const dt = Math.max(0.5, (at - prev.at) / 1000)
      netRx = Math.max(0, ((snap.netBytesRecv - prev.recv) * 8) / dt / 1_000_000)
      netTx = Math.max(0, ((snap.netBytesSent - prev.sent) * 8) / dt / 1_000_000)
    }
    if (snap.netBytesRecv != null && snap.netBytesSent != null && Number.isFinite(at)) {
      prev = { recv: snap.netBytesRecv, sent: snap.netBytesSent, at }
    }
    points.push({
      timestamp: snap.collectedAt || new Date(at).toISOString(),
      cpu_percent: snap.cpuPercent ?? 0,
      ram_percent: snap.ramPercent ?? 0,
      net_rx_mbps: netRx,
      net_tx_mbps: netTx,
      uptime_seconds: snap.uptimeSeconds ?? 0,
    })
  }
  return points.slice(-MAX_POINTS)
}

export function useTelemetrySeries(hostId: string | null, enabled: boolean) {
  const [points, setPoints] = useState<TelemetryPoint[]>([])
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('closed')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const lastAbs = useRef<{ recv: number; sent: number; at: number } | null>(null)
  const lastTs = useRef<string | null>(null)

  const appendSnap = useCallback((snap: Telemetry) => {
    const ts = snap.collectedAt ?? ''
    if (ts && ts === lastTs.current) return
    lastTs.current = ts || null

    const now = snap.collectedAt ? Date.parse(snap.collectedAt) : Date.now()
    let netRx = 0
    let netTx = 0
    if (
      lastAbs.current &&
      snap.netBytesRecv != null &&
      snap.netBytesSent != null &&
      Number.isFinite(now)
    ) {
      const dt = Math.max(0.5, (now - lastAbs.current.at) / 1000)
      netRx = Math.max(0, ((snap.netBytesRecv - lastAbs.current.recv) * 8) / dt / 1_000_000)
      netTx = Math.max(0, ((snap.netBytesSent - lastAbs.current.sent) * 8) / dt / 1_000_000)
    }
    if (snap.netBytesRecv != null && snap.netBytesSent != null && Number.isFinite(now)) {
      lastAbs.current = { recv: snap.netBytesRecv, sent: snap.netBytesSent, at: now }
    }
    setPoints((prev) => [
      ...prev.slice(-(MAX_POINTS - 1)),
      {
        timestamp: snap.collectedAt || new Date().toISOString(),
        cpu_percent: snap.cpuPercent ?? 0,
        ram_percent: snap.ramPercent ?? 0,
        net_rx_mbps: netRx,
        net_tx_mbps: netTx,
        uptime_seconds: snap.uptimeSeconds ?? 0,
      },
    ])
  }, [])

  const poll = useCallback(async () => {
    if (!hostId) return
    try {
      const snap = await api.getTelemetry(hostId)
      appendSnap(snap)
      setStatus('open')
      setError(null)
    } catch (err) {
      const e = parseCommandError(err)
      if (is2faError(e)) {
        setStatus('error')
        setError(e.message)
        return
      }
      if (/404|not found|no telemetry/i.test(e.message)) {
        setStatus('closed')
        setError('No telemetry yet — waiting for agent')
        return
      }
      setStatus('error')
      setError(e.message)
    }
  }, [hostId, appendSnap])

  useEffect(() => {
    lastAbs.current = null
    lastTs.current = null
    setPoints([])
    setError(null)
    if (!hostId || !enabled) {
      setStatus('closed')
      return
    }
    let cancelled = false
    setStatus('connecting')
    setIsLoading(true)
    void (async () => {
      try {
        const hist = await api.getTelemetryHistory(hostId)
        if (cancelled) return
        const series = snapshotsToPoints(hist)
        setPoints(series)
        const last = hist.at(-1)
        if (last) {
          lastTs.current = last.collectedAt
          if (last.netBytesRecv != null && last.netBytesSent != null) {
            lastAbs.current = {
              recv: last.netBytesRecv,
              sent: last.netBytesSent,
              at: last.collectedAt ? Date.parse(last.collectedAt) : Date.now(),
            }
          }
          setStatus('open')
        }
      } catch {
        /* history optional */
      } finally {
        if (!cancelled) setIsLoading(false)
      }
      if (!cancelled) await poll()
    })()
    const id = window.setInterval(() => void poll(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [hostId, enabled, poll])

  return { points, status, error, isLoading, reconnect: () => void poll() }
}
