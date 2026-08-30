import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, parseCommandError, type BillingHostBrief } from '@/lib/api'
import { countryFlag } from '@/lib/countryFlag'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { toast } from '@/store/uiStore'
import { PayersSection } from './PayersSection'

function monthLabel(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function startWeekday(year: number, month: number) {
  const d = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  return (d + 6) % 7
}

function todayIso() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

function moneyText(v: string | number | null | undefined): string {
  if (v == null) return ''
  return String(v)
}

export function BillingPage() {
  const qc = useQueryClient()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedPayerId, setSelectedPayerId] = useState('')
  const [renewTarget, setRenewTarget] = useState<{
    id: string
    name: string
    due: string | null
    cycle: string | null
    amount: string | number | null
    currency: string | null
  } | null>(null)
  const today = todayIso()
  const payerFilter = selectedPayerId || undefined

  const payersQuery = useQuery({
    queryKey: ['billing', 'payers'],
    queryFn: api.billingPayers,
  })

  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const to = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`

  const calendarQuery = useQuery({
    queryKey: ['billing', 'calendar', year, month, selectedPayerId],
    queryFn: () => api.billingCalendar(year, month, payerFilter),
  })
  const summaryQuery = useQuery({
    queryKey: ['billing', 'summary', from, to, selectedPayerId],
    queryFn: () => api.billingSummary(from, to, payerFilter),
  })

  const renewMutation = useMutation({
    mutationFn: (hostId: string) => api.billingAdvance(hostId),
    onSuccess: () => {
      setRenewTarget(null)
      void qc.invalidateQueries({ queryKey: ['billing'] })
      void qc.invalidateQueries({ queryKey: ['hosts'] })
      toast('Marked paid · period renewed', 'success')
    },
    onError: (err: unknown) => toast(parseCommandError(err).message, 'error'),
  })

  const byDate = useMemo(() => {
    const map = new Map<string, BillingHostBrief[]>()
    for (const day of calendarQuery.data?.days ?? []) {
      map.set(day.date, day.hosts)
    }
    return map
  }, [calendarQuery.data])

  function shiftMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    setYear(y)
    setMonth(m)
    setSelectedDay(null)
  }

  const totalDays = daysInMonth(year, month)
  const pad = startWeekday(year, month)
  const cells: Array<{ day: number | null; date: string | null }> = []
  for (let i = 0; i < pad; i++) cells.push({ day: null, date: null })
  for (let d = 1; d <= totalDays; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, date })
  }

  const selectedHosts = selectedDay ? (byDate.get(selectedDay) ?? []) : []
  const currency = summaryQuery.data?.currency ?? calendarQuery.data?.currency ?? 'USD'
  const activePayerName = selectedPayerId
    ? payersQuery.data?.find((p) => p.id === selectedPayerId)?.name
    : null

  const viewingCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
  const viewingPast =
    year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)

  const monthStats = useMemo(() => {
    const days = calendarQuery.data?.days ?? []
    const nextDateByHost = new Map<string, string>()
    for (const day of days) {
      for (const h of day.hosts) {
        if (h.is_next) nextDateByHost.set(h.id, day.date)
      }
    }

    let total = 0
    let remaining = 0
    for (const day of days) {
      for (const h of day.hosts) {
        if (h.amount_converted == null) continue
        const amt = Number(h.amount_converted)
        if (!Number.isFinite(amt)) continue
        total += amt
        if (h.is_next) {
          remaining += amt
          continue
        }
        if (h.next_renewal_at) {
          if (day.date > h.next_renewal_at) remaining += amt
          continue
        }
        const nextDate = nextDateByHost.get(h.id)
        if (nextDate != null) {
          if (day.date > nextDate) remaining += amt
          continue
        }
        if (!viewingPast && !viewingCurrentMonth) remaining += amt
      }
    }
    return { total, remaining, ready: Boolean(calendarQuery.data) }
  }, [calendarQuery.data, viewingCurrentMonth, viewingPast])

  function formatMoney(n: number) {
    return n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-5">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="rounded-lg border border-border bg-panel p-4">
          <h3 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted">
            Payer filter
          </h3>
          <div className="max-w-sm">
            <Select
              label="Show renewals for"
              value={selectedPayerId}
              onChange={(e) => {
                setSelectedPayerId(e.target.value)
                setSelectedDay(null)
              }}
            >
              <option value="">All payers</option>
              {(payersQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.host_count})
                </option>
              ))}
            </Select>
          </div>
        </section>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-panel px-4 py-3">
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted">
                {viewingCurrentMonth ? 'Left to pay this month' : 'Upcoming in this month'}
              </h2>
              <p className="mt-1 text-2xl font-semibold text-fg-strong">
                {monthStats.ready ? formatMoney(monthStats.remaining) : '—'}{' '}
                <span className="font-mono text-base text-neon">{currency}</span>
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted">
                Next dues
                {viewingCurrentMonth ? ' · includes overdue · excludes paid' : ''}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-panel px-4 py-3">
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted">
                Total this month
              </h2>
              <p className="mt-1 text-2xl font-semibold text-fg-strong">
                {monthStats.ready ? formatMoney(monthStats.total) : '—'}{' '}
                <span className="font-mono text-base text-neon">{currency}</span>
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted">
                {activePayerName ? `Payer: ${activePayerName} · ` : ''}
                All renewals in {monthLabel(year, month)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => shiftMonth(-1)}>
              ←
            </Button>
            <span className="min-w-[10rem] text-center font-mono text-sm text-fg-strong">
              {monthLabel(year, month)}
            </span>
            <Button variant="ghost" onClick={() => shiftMonth(1)}>
              →
            </Button>
          </div>
        </div>

        {(summaryQuery.data?.skipped.length ?? 0) > 0 ? (
          <p className="font-mono text-xs text-warn">
            Skipped FX: {summaryQuery.data!.skipped.join('; ')}
          </p>
        ) : null}

        {calendarQuery.isError ? (
          <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
            {parseCommandError(calendarQuery.error).message}
          </div>
        ) : null}

        <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] uppercase text-muted">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, idx) => {
            if (!cell.day || !cell.date) {
              return <div key={`pad-${idx}`} className="min-h-16 rounded-md bg-transparent" />
            }
            const hosts = byDate.get(cell.date) ?? []
            const hasNext = hosts.some((h) => h.is_next)
            const hasProjectedOnly = hosts.length > 0 && !hasNext
            const selected = selectedDay === cell.date
            const isToday = cell.date === today
            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => setSelectedDay(cell.date)}
                className={`relative min-h-16 rounded-md border p-1.5 text-left transition-colors ${
                  selected
                    ? 'border-neon/50 bg-neon/10'
                    : hasNext
                      ? 'border-border-active bg-panel hover:border-neon/40'
                      : hasProjectedOnly
                        ? 'border-border/60 bg-surface/40 hover:border-border'
                        : 'border-border bg-surface hover:border-border-active'
                } ${isToday ? 'ring-1 ring-neon/60' : ''}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={`font-mono text-xs ${isToday ? 'font-semibold text-neon' : 'text-dim'}`}>
                    {cell.day}
                  </span>
                  {isToday ? (
                    <span className="font-mono text-[8px] uppercase tracking-wider text-neon">
                      today
                    </span>
                  ) : null}
                </div>
                {hosts.length ? (
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {hosts.slice(0, 3).map((h) => (
                      <span
                        key={`${h.id}-${h.is_next ? 'n' : 'p'}`}
                        className={`text-sm leading-none ${h.is_next ? '' : 'opacity-35 grayscale'}`}
                      >
                        {countryFlag(h.country_code)}
                      </span>
                    ))}
                    {hosts.length > 3 ? (
                      <span className="font-mono text-[10px] text-muted">+{hosts.length - 3}</span>
                    ) : null}
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>

        <p className="font-mono text-[10px] text-muted">
          Bright = next due · dimmed past = paid (after Renew) · dimmed future = projected
        </p>

        <section className="rounded-lg border border-border bg-panel p-4">
          <h3 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted">
            {selectedDay ? `Due ${selectedDay}` : 'Select a day'}
          </h3>
          {!selectedDay ? (
            <p className="text-sm text-dim">Click a marked day to see renewing hosts.</p>
          ) : selectedHosts.length === 0 ? (
            <p className="text-sm text-dim">No renewals this day.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {selectedHosts.map((h) => (
                <li
                  key={`${h.id}-${h.is_next ? 'next' : 'proj'}`}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                    h.is_next ? 'border-border bg-void' : 'border-border/50 bg-void/40 opacity-60'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`text-base ${h.is_next ? '' : 'grayscale'}`}>
                      {countryFlag(h.country_code)}
                    </span>
                    <div>
                      <span className="text-sm text-fg-strong">{h.name}</span>
                      {h.payer_name ? (
                        <span className="ml-2 font-mono text-[10px] text-muted">{h.payer_name}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={h.is_next ? 'neon' : 'muted'}>
                      {moneyText(h.billing_amount)} {h.billing_currency}
                      {h.amount_converted != null
                        ? ` · ${moneyText(h.amount_converted)} ${currency}`
                        : ''}
                      {h.cycle ? ` / ${h.cycle}` : ''}
                    </Badge>
                    {h.is_next ? (
                      <Button
                        variant="outline"
                        className="!px-2 !text-[10px]"
                        disabled={renewMutation.isPending}
                        onClick={() =>
                          setRenewTarget({
                            id: h.id,
                            name: h.name,
                            due: selectedDay,
                            cycle: h.cycle,
                            amount: h.billing_amount,
                            currency: h.billing_currency,
                          })
                        }
                      >
                        Renew
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {summaryQuery.data && summaryQuery.data.items.length > 0 ? (
          <section className="rounded-lg border border-border bg-panel p-4">
            <h3 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted">
              Next renewals this month
            </h3>
            <ul className="flex flex-col gap-1">
              {summaryQuery.data.items.map((item) => (
                <li
                  key={item.host_id}
                  className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-dim"
                >
                  <span>{item.host_name}</span>
                  <div className="flex items-center gap-2">
                    <span>
                      {item.amount} {item.currency}
                      {item.amount_converted != null
                        ? ` → ${moneyText(item.amount_converted)} ${currency}`
                        : ''}
                      {item.renewal_at ? ` · due ${item.renewal_at}` : ''}
                    </span>
                    <Button
                      variant="outline"
                      className="!px-2 !text-[10px]"
                      disabled={renewMutation.isPending}
                      onClick={() =>
                        setRenewTarget({
                          id: item.host_id,
                          name: item.host_name,
                          due: item.renewal_at,
                          cycle: item.cycle,
                          amount: item.amount,
                          currency: item.currency,
                        })
                      }
                    >
                      Renew
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <PayersSection />
      </div>

      <Modal
        open={Boolean(renewTarget)}
        title="Confirm renew"
        onClose={() => setRenewTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenewTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={renewMutation.isPending || !renewTarget}
              onClick={() => {
                if (renewTarget) renewMutation.mutate(renewTarget.id)
              }}
            >
              {renewMutation.isPending ? 'Renewing…' : 'Yes, mark paid'}
            </Button>
          </>
        }
      >
        {renewTarget ? (
          <p className="text-sm text-dim">
            Mark «{renewTarget.name}» as paid
            {renewTarget.amount != null
              ? ` (${moneyText(renewTarget.amount)} ${renewTarget.currency ?? ''})`
              : ''}{' '}
            and advance next due
            {renewTarget.due ? (
              <>
                {' '}
                from <span className="font-mono text-neon">{renewTarget.due}</span>
              </>
            ) : null}{' '}
            by one {renewTarget.cycle ?? 'billing'} period?
          </p>
        ) : null}
      </Modal>
    </div>
  )
}
