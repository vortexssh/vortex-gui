import { ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { MetricChart } from '@/features/dashboard/MetricChart'
import { useTelemetrySeries } from '@/hooks/useTelemetrySeries'
import { api, is2faError } from '@/lib/api'

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '—'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function HostTelemetry({
  hostId,
  enabled,
  hasAgent,
}: {
  hostId: string
  enabled: boolean
  hasAgent: boolean
}) {
  const { points, status, error, isLoading, reconnect } = useTelemetrySeries(hostId, enabled)
  const last = points.at(-1)
  const twoFa = error ? is2faError({ code: '', message: error }) : false

  if (!enabled) {
    return (
      <p className="px-5 pb-4 font-mono text-xs text-muted">
        Sign in to stream telemetry from Core.
      </p>
    )
  }
  if (!hasAgent) {
    return (
      <div className="mx-5 mb-4 rounded-lg border border-dashed border-border bg-panel p-6">
        <h2 className="font-mono text-sm uppercase tracking-wider text-neon">No agent on this host</h2>
        <p className="mt-2 text-sm text-dim">
          Install the Vortex Agent to stream CPU, RAM, network and uptime.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 px-5 pb-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status === 'open' ? 'neon' : status === 'connecting' ? 'warn' : 'danger'}>
          poll · {status}
        </Badge>
        {status !== 'open' ? (
          <Button variant="outline" className="!text-xs" onClick={reconnect}>
            Retry
          </Button>
        ) : null}
        {error && !twoFa ? <span className="font-mono text-xs text-warn">{error}</span> : null}
        <span className="font-mono text-[10px] text-muted">Redis history · poll 5s</span>
      </div>

      {twoFa ? (
        <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>Telemetry is locked until 2FA is enabled.</p>
            <Button
              variant="outline"
              className="mt-2 !border-warn/40 !text-warn !text-xs"
              onClick={() => void api.openWebPath('security/2fa')}
            >
              Open 2FA setup
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'CPU', value: last ? `${last.cpu_percent.toFixed(0)}%` : '—' },
          { label: 'RAM', value: last ? `${last.ram_percent.toFixed(0)}%` : '—' },
          { label: 'Uptime', value: last ? formatUptime(last.uptime_seconds) : '—' },
          {
            label: 'Net',
            value: last
              ? `↓ ${last.net_rx_mbps.toFixed(1)}  ↑ ${last.net_tx_mbps.toFixed(1)} Mbps`
              : '—',
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-panel px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{stat.label}</div>
            <div className="mt-1 font-mono text-xl text-neon text-glow">{stat.value}</div>
          </div>
        ))}
      </div>

      {isLoading && points.length === 0 ? (
        <p className="font-mono text-xs text-muted">Waiting for telemetry snapshot…</p>
      ) : points.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <MetricChart title="CPU load" unit="%" dataKey="cpu_percent" points={points} />
          <MetricChart title="Memory" unit="%" dataKey="ram_percent" points={points} />
          <MetricChart
            title="Network RX"
            unit=" Mbps"
            dataKey="net_rx_mbps"
            points={points}
            color="#22c55e"
          />
          <MetricChart
            title="Network TX"
            unit=" Mbps"
            dataKey="net_tx_mbps"
            points={points}
            color="#86efac"
          />
        </div>
      ) : null}
    </div>
  )
}
