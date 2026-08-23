import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { ToastViewport } from '@/components/ui/Toast'
import { BillingPage } from '@/features/billing/BillingPage'
import { FilesPage } from '@/features/files/FilesPage'
import { HostForm } from '@/features/hosts/HostForm'
import { HostList } from '@/features/hosts/HostList'
import { HostWorkspace } from '@/features/hosts/HostWorkspace'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { api, is2faError, parseCommandError, type Host, type SaveHostInput } from '@/lib/api'
import { openTermWindow } from '@/lib/termWindow'
import { layoutOf, toast, useUiStore } from '@/store/uiStore'

export default function App() {
  const qc = useQueryClient()
  const view = useUiStore((s) => s.view)
  const selectedId = useUiStore((s) => s.selectedHostId)
  const selectHost = useUiStore((s) => s.selectHost)
  const openTerm = useUiStore((s) => s.openTerm)
  const closeTermsForHost = useUiStore((s) => s.closeTermsForHost)
  const closeTerm = useUiStore((s) => s.closeTerm)
  const openFiles = useUiStore((s) => s.openFiles)
  const termTabs = useUiStore((s) => s.termTabs)

  const hostsQ = useQuery({ queryKey: ['hosts'], queryFn: api.listHosts })
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const hosts = hostsQ.data ?? []
  const selected = hosts.find((h) => h.id === selectedId) ?? null
  const layout = layoutOf(settingsQ.data?.terminalLayout)

  const [editor, setEditor] = useState<Host | 'new' | null>(null)

  const syncMut = useMutation({
    mutationFn: api.syncCloud,
    onSuccess: async (r) => {
      toast(`Synced ${r.upserted} host(s)` + (r.removed ? `, removed ${r.removed}` : ''), 'success')
      await qc.invalidateQueries({ queryKey: ['hosts'] })
    },
    onError: (e) => {
      const err = parseCommandError(e)
      toast(err.message, 'error')
      if (is2faError(err) && err.web2faUrl) {
        void api.openWebPath('security/2fa')
      }
    },
  })

  const saveMut = useMutation({
    mutationFn: (input: SaveHostInput) => api.saveHost(input),
    onSuccess: async (h) => {
      toast(`Saved ${h.name}`, 'success')
      setEditor(null)
      selectHost(h.id)
      await qc.invalidateQueries({ queryKey: ['hosts'] })
    },
    onError: (e) => toast(parseCommandError(e).message, 'error'),
  })

  async function onDelete(fromCloud: boolean) {
    if (!selected) return
    const msg = fromCloud
      ? `Delete ${selected.name} locally and remove cloud metadata? SSH secret is local-only.`
      : `Delete ${selected.name} and its local secret? Cloud copy (if any) stays until next sync.`
    if (!window.confirm(msg)) return
    try {
      await api.deleteHost(selected.id, fromCloud)
      toast('Deleted', 'success')
      closeTermsForHost(selected.id)
      selectHost(null)
      await qc.invalidateQueries({ queryKey: ['hosts'] })
    } catch (e) {
      toast(parseCommandError(e).message, 'error')
    }
  }

  async function onMove(id: string, delta: number) {
    try {
      const next = await api.moveHost(id, delta)
      qc.setQueryData(['hosts'], next)
    } catch (e) {
      toast(parseCommandError(e).message, 'error')
    }
  }

  async function onConnect(mode: 'reconnect' | 'new' = 'reconnect') {
    if (!selected) return
    if (layout === 'provided') {
      try {
        await api.openSystemSsh(selected.id)
        toast('Launched system terminal', 'success')
      } catch (e) {
        toast(parseCommandError(e).message, 'error')
      }
      return
    }
    if (layout === 'window') {
      try {
        await openTermWindow(selected.id, selected.name, mode === 'new')
      } catch (e) {
        toast(parseCommandError(e).message, 'error')
      }
      return
    }
    if (layout === 'split' && mode !== 'new') {
      for (const t of termTabs) {
        if (t.hostId !== selected.id) closeTerm(t.id)
      }
    }
    openTerm(selected.id, selected.name, mode)
  }

  return (
    <>
      <AppShell onSync={() => syncMut.mutate()} syncing={syncMut.isPending}>
        <div className="relative h-full min-h-0">
          {view === 'billing' ? <BillingPage /> : null}
          {view === 'settings' ? <SettingsPage /> : null}
          {view === 'files' ? (
            <div className="h-full min-h-0">
              <FilesPage hosts={hosts} selectedId={selectedId} onSelectHost={(id) => openFiles(id)} />
            </div>
          ) : null}
          <div className={`flex h-full min-h-0 ${view === 'hosts' ? '' : 'hidden'}`}>
            <HostList
              hosts={hosts}
              selectedId={selectedId}
              onSelect={selectHost}
              onAdd={() => setEditor('new')}
              onMove={onMove}
            />
            <HostWorkspace
              selected={selected}
              settings={settingsQ.data}
              onEdit={() => {
                if (selected) setEditor(selected)
              }}
              onDelete={(fromCloud) => void onDelete(fromCloud)}
              onConnect={() => void onConnect()}
              onNewTerm={() => void onConnect('new')}
              onOpenFiles={() => {
                if (selected) openFiles(selected.id)
              }}
            />
          </div>
        </div>
      </AppShell>
      <HostForm
        open={editor !== null}
        host={editor === 'new' || editor === null ? null : editor}
        linked={Boolean(settingsQ.data?.linked)}
        saving={saveMut.isPending}
        onClose={() => setEditor(null)}
        onSave={async (input) => {
          await saveMut.mutateAsync(input)
        }}
      />
      <ToastViewport />
    </>
  )
}
