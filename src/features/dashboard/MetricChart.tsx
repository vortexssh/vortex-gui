import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TelemetryPoint } from '@/lib/api'

type MetricKey = keyof Pick<TelemetryPoint, 'cpu_percent' | 'ram_percent' | 'net_rx_mbps' | 'net_tx_mbps'>

interface MetricChartProps {
  title: string
  unit: string
  dataKey: MetricKey
  points: TelemetryPoint[]
  color?: string
}

function formatTick(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MetricChart({
  title,
  unit,
  dataKey,
  points,
  color = '#39FF14',
}: MetricChartProps) {
  const latest = points.at(-1)?.[dataKey]
  const latestLabel =
    latest === undefined
      ? '—'
      : `${latest.toFixed(dataKey.includes('net') ? 1 : 0)}${unit}`

  return (
    <section className="flex flex-col rounded-lg border border-border bg-panel p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{title}</h3>
        <span className="font-mono text-lg font-semibold text-neon text-glow">{latestLabel}</span>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1f1f1f" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatTick}
              tick={{ fill: '#6b7280', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tick={{ fill: '#6b7280', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: '#111111',
                border: '1px solid #1f1f1f',
                borderRadius: 8,
                fontFamily: 'JetBrains Mono',
                fontSize: 11,
              }}
              labelFormatter={(label) =>
                typeof label === 'string' ? new Date(label).toLocaleString() : String(label)
              }
              formatter={(value) => [
                `${typeof value === 'number' ? value.toFixed(1) : String(value)}${unit}`,
                title,
              ]}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={1.75}
              fill={`url(#fill-${dataKey})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
