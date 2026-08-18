import type { ReactNode } from 'react'

type Tone = 'neon' | 'warn' | 'danger' | 'muted'

interface BadgeProps {
  children: ReactNode
  tone?: Tone
}

const TONE: Record<Tone, string> = {
  neon: 'border-neon/30 bg-neon/15 text-neon',
  warn: 'border-warn/30 bg-warn/15 text-warn',
  danger: 'border-danger/25 bg-danger/10 text-danger',
  muted: 'border-border bg-void text-muted',
}

export function Badge({ children, tone = 'muted' }: BadgeProps) {
  return (
    <span
      className={`inline-flex rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${TONE[tone]}`}
    >
      {children}
    </span>
  )
}
