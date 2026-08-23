import { ExternalLink, Folder, Pencil, Plus, Trash2, TerminalSquare } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, is2faError, parseCommandError, type Host, type SettingsPublic } from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { HostTelemetry } from './HostTelemetry'
import { toast } from '@/store/uiStore'

interface HostDetailProps {
  host: Host
  settings: SettingsPublic | undefined
  onEdit: () => void
  onDelete: (fromCloud: boolean) => void
  onConnect: () => void
  onNewTerm: () => void
  onOpenFiles: () => void
  sessionOpen: boolean
}

export function HostDetail({
  host,
  settings,
  onEdit,
  onDelete,
  onConnect,
  onNewTerm,
  onOpenFiles,
  sessionOpen,
}: HostDetailProps) {
  const provided = settings?.terminalLayout === 'provided'
  const externalMut = useMutation({
    mutationFn: () => api.openSystemSsh(host.id),
    onSuccess: () => toast('Launched system terminal', 'success'),
    onError: (e) => toast(parseCommandError(e).message, 'error'),
  })

  const connectDisabled =
    (host.proxyEnabled && !host.agentOnline) ||
    (provided && (host.proxyEnabled || !host.address.trim()))

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-medium text-fg-strong">{host.name}</h1>
              <Badge tone={host.source === 'cloud' ? 'neon' : 'muted'}>{host.source}</Badge>
              <Badge tone={host.proxyEnabled ? 'neon' : 'muted'}>
                {host.proxyEnabled ? 'proxy' : 'direct'}
              </Badge>
              <Badge tone={host.agentOnline ? 'neon' : 'muted'}>
                {host.agentOnline ? 'agent online' : 'agent off'}
              </Badge>
            </div>
            <p className="mt-1 font-mono text-sm text-dim">
              {host.user}@{host.address || '(nat)'}:{host.port}
            </p>
            {host.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {host.tags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {sessionOpen && !provided ? (
              <div className="inline-flex">
                <Button
                  variant="primary"
                  className="!rounded-r-none"
                  onClick={onConnect}
                  disabled={connectDisabled}
                >
                  <TerminalSquare className="h-4 w-4" />
                  Reconnect
                </Button>
                <Button
                  variant="primary"
                  className="!rounded-l-none !border-l-0 !px-2"
                  onClick={onNewTerm}
                  disabled={connectDisabled}
                  title="New terminal"
                  aria-label="New terminal"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button variant="primary" onClick={onConnect} disabled={connectDisabled}>
                <TerminalSquare className="h-4 w-4" />
                {provided ? 'Open terminal' : 'Connect'}
              </Button>
            )}
            {!host.proxyEnabled && !provided ? (
              <Button
                variant="outline"
                onClick={() => externalMut.mutate()}
                disabled={externalMut.isPending || !host.address.trim()}
                title={settings?.sshCommand || 'ssh'}
              >
                <ExternalLink className="h-4 w-4" />
                External
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={onOpenFiles}
              disabled={host.proxyEnabled && !host.agentOnline}
            >
              <Folder className="h-4 w-4" />
              Files
            </Button>
            <Button variant="outline" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            <Button variant="danger" onClick={() => onDelete(false)}>
              <Trash2 className="h-4 w-4" />
              Delete local
            </Button>
            {host.source === 'cloud' ? (
              <Button variant="danger" onClick={() => onDelete(true)}>
                Delete + cloud
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-4">
        <Metric label="secret" value={host.hasSecret ? host.authType ?? 'yes' : 'agent / prompt'} />
        <Metric label="mode" value={host.proxyEnabled ? 'vortex proxy' : 'direct ssh'} />
        <Metric label="agent" value={host.agentId ? host.agentId.slice(0, 8) : '—'} />
        <Metric
          label="last sync"
          value={host.lastSyncedAt ? host.lastSyncedAt.replace('T', ' ').slice(0, 19) : 'never'}
        />
      </div>

      <HostBillingCard host={host} linked={Boolean(settings?.linked)} />

      <HostTelemetry
        hostId={host.id}
        enabled={Boolean(settings?.linked && host.source === 'cloud')}
        hasAgent={Boolean(host.agentId)}
      />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-panel px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 font-mono text-sm text-neon">{value}</div>
    </div>
  )
}

function HostBillingCard({ host, linked }: { host: Host; linked: boolean }) {
  const qc = useQueryClient()
  const renew = useMutation({
    mutationFn: () => api.billingAdvance(host.id),
    onSuccess: async () => {
      toast('Marked paid · period renewed', 'success')
      await qc.invalidateQueries({ queryKey: ['hosts'] })
      await qc.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (e) => {
      const err = parseCommandError(e)
      toast(err.message, 'error')
      if (is2faError(err)) void api.openWebPath('security/2fa')
    },
  })

  if (!linked || host.source !== 'cloud') return null
  const b = host.billing
  if (!b?.enabled) {
    return (
      <p className="px-5 pb-2 font-mono text-xs text-muted">
        Billing not tracked — enable in Edit host.
      </p>
    )
  }
  return (
    <div className="mx-5 mb-4 rounded-lg border border-border bg-panel p-4">
      <h3 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted">Billing</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {b.payerName ? (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted">Payer</div>
            <div className="text-sm text-fg-strong">{b.payerName}</div>
          </div>
        ) : null}
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted">Cycle</div>
          <div className="text-sm text-fg-strong">
            {b.cycle}
            {b.cycle === 'custom' && b.customDays ? ` (${b.customDays}d)` : ''}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted">Next renewal</div>
          <div className="text-sm text-neon">{b.renewalAt ?? '—'}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted">Amount</div>
          <div className="font-mono text-sm text-fg-strong">
            {b.amount ?? '—'} {b.currency ?? ''}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted">Auto-renew</div>
          <div className="text-sm text-fg-strong">{b.autoRenew ? 'on (agent online)' : 'off'}</div>
        </div>
        {b.notes?.trim() ? (
          <div className="sm:col-span-2 lg:col-span-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
              Billing notes
            </div>
            <div className="text-sm text-dim">{b.notes}</div>
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <Button
          variant="outline"
          className="!text-xs"
          disabled={renew.isPending || !b.renewalAt}
          onClick={() => renew.mutate()}
        >
          {renew.isPending ? 'Renewing…' : 'Mark paid · renew period'}
        </Button>
        <span className="font-mono text-[10px] text-muted">
          After you pay the provider — advances next due date by one cycle
        </span>
      </div>
    </div>
  )
}
