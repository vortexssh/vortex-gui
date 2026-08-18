import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X } from 'lucide-react'
import {
  api,
  decodeB64,
  encodeBytes,
  is2faError,
  listenSshData,
  listenSshExit,
  parseCommandError,
} from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { toast } from '@/store/uiStore'

interface TerminalPaneProps {
  hostId: string
  hostName: string
  onClose: () => void
  active?: boolean
  chrome?: 'full' | 'none'
}

export function TerminalPane({
  hostId,
  hostName,
  onClose,
  active = true,
  chrome = 'full',
}: TerminalPaneProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<string | null>(null)
  const [status, setStatus] = useState('connecting…')

  const close = useCallback(async () => {
    const sid = sessionRef.current
    sessionRef.current = null
    if (sid) {
      try {
        await api.sshClose(sid)
      } catch {
        /* already gone */
      }
    }
    onClose()
  }, [onClose])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let cancelled = false
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e7eb',
        cursor: '#39ff14',
        selectionBackground: 'rgba(57,255,20,0.25)',
        black: '#0a0a0a',
        green: '#39ff14',
        brightGreen: '#39ff14',
      },
      scrollback: 4000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term
    fitRef.current = fit

    const writeBytes = (b64: string) => {
      term.write(decodeB64(b64))
    }

    const pending: { sessionId: string; data: string }[] = []
    const unDataP = listenSshData((ev) => {
      if (!sessionRef.current) {
        pending.push(ev)
        return
      }
      if (ev.sessionId !== sessionRef.current) return
      writeBytes(ev.data)
    })
    const unExitP = listenSshExit((ev) => {
      if (!sessionRef.current || ev.sessionId !== sessionRef.current) return
      term.write(`\r\n\x1b[33m[${ev.message}]\x1b[0m\r\n`)
      setStatus(ev.message)
      sessionRef.current = null
    })

    const applySize = () => {
      if (el.clientHeight < 24 || el.clientWidth < 24) return
      try {
        fit.fit()
      } catch {
        return
      }
      const sid = sessionRef.current
      if (sid && term.cols && term.rows) {
        void api.sshResize(sid, term.cols, term.rows)
      }
    }

    const ro = new ResizeObserver(() => applySize())
    ro.observe(el)

    term.onData((data) => {
      const sid = sessionRef.current
      if (!sid) return
      void api.sshWrite(sid, encodeBytes(new TextEncoder().encode(data)))
    })

    const boot = window.setTimeout(() => {
      void (async () => {
        for (let i = 0; i < 24 && !cancelled; i++) {
          applySize()
          if (el.clientHeight >= 40 && el.clientWidth >= 40 && (term.cols || 0) >= 20) break
          await new Promise((r) => window.setTimeout(r, 16))
        }
        if (cancelled) return
        const cols = Math.max(term.cols || 80, 20)
        const rows = Math.max(term.rows || 24, 8)
        try {
          const res = await api.connectHost(hostId, cols, rows)
          if (cancelled) {
            await api.sshClose(res.sessionId).catch(() => undefined)
            return
          }
          sessionRef.current = res.sessionId
          for (const ev of pending) {
            if (ev.sessionId === res.sessionId) writeBytes(ev.data)
          }
          pending.length = 0
          setStatus(`connected · ${res.mode}`)
          applySize()
        } catch (e) {
          if (cancelled) return
          const err = parseCommandError(e)
          setStatus(err.message)
          term.write(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`)
          toast(err.message, 'error')
          if (is2faError(err)) void api.openWebPath('security/2fa')
        }
      })()
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(boot)
      ro.disconnect()
      void unDataP.then((u) => u())
      void unExitP.then((u) => u())
      const sid = sessionRef.current
      sessionRef.current = null
      if (sid) void api.sshClose(sid).catch(() => undefined)
      term.dispose()
      termRef.current = null
    }
  }, [hostId])

  useEffect(() => {
    if (!active) return
    const fit = fitRef.current
    const el = wrapRef.current
    if (!fit || !el) return
    const id = window.requestAnimationFrame(() => {
      if (el.clientHeight < 24 || el.clientWidth < 24) return
      try {
        fit.fit()
      } catch {
        /* collapsed */
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [active])

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-void"
      hidden={!active}
      style={{ display: active ? 'flex' : 'none' }}
    >
      {chrome === 'full' ? (
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wider text-neon">
            ssh · {hostName}
            <span className="ml-2 text-muted">{status}</span>
          </span>
          <Button variant="ghost" className="!px-2 !py-0.5 !text-xs" onClick={() => void close()}>
            <X className="h-3.5 w-3.5" />
            close
          </Button>
        </div>
      ) : (
        <div className="shrink-0 border-b border-border px-3 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
          {status}
        </div>
      )}
      <div ref={wrapRef} className="xterm-wrap min-h-0 flex-1 p-1" />
    </div>
  )
}
