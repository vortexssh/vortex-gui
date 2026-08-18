import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, parseCommandError, type BillingPayer } from '@/lib/api'
import { countryFlag } from '@/lib/countryFlag'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/store/uiStore'

export function PayersSection() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [editing, setEditing] = useState<BillingPayer | null>(null)
  const [editName, setEditName] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BillingPayer | null>(null)

  const payersQuery = useQuery({
    queryKey: ['billing', 'payers'],
    queryFn: api.billingPayers,
  })
  const detailQuery = useQuery({
    queryKey: ['billing', 'payers', expandedId],
    queryFn: () => api.billingPayer(expandedId!),
    enabled: Boolean(expandedId),
  })

  const createMutation = useMutation({
    mutationFn: () => api.billingCreatePayer(name.trim(), notes.trim() ? notes.trim() : null),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['billing', 'payers'] })
      setName('')
      setNotes('')
      setExpandedId(p.id)
      toast(`Payer «${p.name}» created`, 'success')
    },
    onError: (err: unknown) => toast(parseCommandError(err).message, 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      api.billingUpdatePayer(editing!.id, editName.trim(), editNotes.trim() ? editNotes.trim() : null),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['billing', 'payers'] })
      setEditing(null)
      toast(`Payer «${p.name}» updated`, 'success')
    },
    onError: (err: unknown) => toast(parseCommandError(err).message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.billingDeletePayer(deleteTarget!.id),
    onSuccess: () => {
      const removed = deleteTarget
      void qc.invalidateQueries({ queryKey: ['billing', 'payers'] })
      void qc.invalidateQueries({ queryKey: ['hosts'] })
      if (expandedId === removed?.id) setExpandedId(null)
      setDeleteTarget(null)
      toast(`Payer «${removed?.name}» deleted`, 'success')
    },
    onError: (err: unknown) => toast(parseCommandError(err).message, 'error'),
  })

  const payers = payersQuery.data ?? []

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border bg-panel p-4">
        <h2 className="mb-1 font-mono text-xs uppercase tracking-wider text-muted">
          Billing payers
        </h2>
        <p className="mb-4 text-sm text-dim">
          Create payers and attach them to hosts in Vortex Web. Calendar can filter by payer.
        </p>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            createMutation.mutate()
          }}
        >
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Company / person"
            className="min-w-[12rem] flex-1"
            required
          />
          <Input
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="INN, contract…"
            className="min-w-[12rem] flex-1"
          />
          <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
            Add payer
          </Button>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-panel p-4">
        <h3 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted">Your payers</h3>
        {payersQuery.isLoading ? (
          <p className="font-mono text-xs text-muted">loading…</p>
        ) : payers.length === 0 ? (
          <p className="text-sm text-dim">No payers yet. Add one above.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {payers.map((p) => {
              const open = expandedId === p.id
              return (
                <li key={p.id} className="rounded-md border border-border bg-void">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setExpandedId(open ? null : p.id)}
                    >
                      <span className="truncate text-sm font-medium text-fg-strong">{p.name}</span>
                      <Badge tone="muted">{p.host_count} hosts</Badge>
                    </button>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        className="!px-2 text-xs"
                        onClick={() => {
                          setEditing(p)
                          setEditName(p.name)
                          setEditNotes(p.notes ?? '')
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        className="!px-2 text-xs text-danger"
                        onClick={() => setDeleteTarget(p)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  {p.notes ? (
                    <p className="border-t border-border/60 px-3 py-1.5 text-xs text-dim">{p.notes}</p>
                  ) : null}
                  {open ? (
                    <div className="border-t border-border px-3 py-3">
                      {detailQuery.isLoading ? (
                        <p className="font-mono text-xs text-muted">loading hosts…</p>
                      ) : !detailQuery.data?.hosts.length ? (
                        <p className="font-mono text-xs text-muted">No hosts linked to this payer.</p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {detailQuery.data.hosts.map((h) => (
                            <li
                              key={h.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-panel px-3 py-2 font-mono text-xs"
                            >
                              <span className="flex items-center gap-2 text-fg-strong">
                                <span>{countryFlag(h.country_code)}</span>
                                {h.name}
                              </span>
                              <span className="text-muted">
                                {h.billing_enabled
                                  ? `${h.billing_amount ?? '—'} ${h.billing_currency ?? ''} · due ${h.billing_renewal_at ?? '—'}`
                                  : 'billing off'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Modal
        open={Boolean(editing)}
        title="Edit payer"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={!editName.trim() || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input label="Name" value={editName} onChange={(e) => setEditName(e.target.value)} required />
          <Input
            label="Notes"
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        title="Delete payer"
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-dim">
          Delete «{deleteTarget?.name}»? Linked hosts keep billing; the payer field is cleared.
        </p>
      </Modal>
    </div>
  )
}
