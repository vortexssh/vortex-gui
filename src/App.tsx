import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { ToastViewport } from '@/components/ui/Toast'
import { BillingPage } from '@/features/billing/BillingPage'
import { HostDetail } from '@/features/hosts/HostDetail'
import { HostForm } from '@/features/hosts/HostForm'
import { HostList } from '@/features/hosts/HostList'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { TerminalPane } from '@/features/terminal/TerminalPane'
import { api, is2faError, parseCommandError, type Host, type SaveHostInput } from '@/lib/api'
import { toast, useUiStore } from '@/store/uiStore'

export default function App() {
  const qc = useQueryClient()
  const view = useUiStore((s) => s.view)
  const selectedId = useUiStore((s) => s.selectedHostId)
  const selectHost = useUiStore((s) => s.selectHost)
  const sessionHostId = useUiStore((s) => s.sessionHostId)
  const setSession = useUiStore((s) => s.setSession)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  const hostsQ = useQuery({ queryKey: ['hosts'], queryFn: api.listHosts })
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const hosts = hostsQ.data ?? []
  const selected = hosts.find((h) => h.id === selectedId) ?? null
  const sessionHost = hosts.find((h) => h.id === sessionHostId) ?? null

  const [editor, setEditor] = useState<Host | 'new' | null>(null)
  const [termGen, setTermGen] = useState(0)

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
      if (sessionHostId === selected.id) setSession(null)
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

  const terminalOpen = Boolean(sessionHostId)

  return (
    <>
      <AppShell
        onSync={() => syncMut.mutate()}
        syncing={syncMut.isPending}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        {view === 'billing' ? (
          <BillingPage />
        ) : (
          <div className="flex h-full min-h-0">
            <HostList
              hosts={hosts}
              selectedId={selectedId}
              onSelect={selectHost}
              onAdd={() => setEditor('new')}
              onMove={onMove}
            />
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div
                className={
                  terminalOpen
                    ? 'min-h-0 shrink-0 overflow-auto'
                    : 'min-h-0 flex-1 overflow-auto'
                }
                style={terminalOpen ? { maxHeight: '42%' } : undefined}
              >
                {selected ? (
                  <HostDetail
                    host={selected}
                    settings={settingsQ.data}
                    onEdit={() => setEditor(selected)}
                    onDelete={(fromCloud) => void onDelete(fromCloud)}
                    onConnect={() => {
                      if (sessionHostId === selected.id) {
                        setTermGen((g) => g + 1)
                      } else {
                        setSession(selected.id)
                      }
                    }}
                    sessionOpen={sessionHostId === selected.id}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center p-8">
                    <div className="max-w-md text-center">
                      <pre className="font-mono text-[10px] leading-tight text-neon/80">{ASCII}</pre>
                      <p className="mt-4 text-sm text-dim">
                        Local-first SSH manager. Secrets never leave this machine. Select a host or
                        add one — cloud login is optional.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {sessionHostId && sessionHost ? (
                <div className="flex min-h-[280px] flex-1 flex-col overflow-hidden border-t border-border">
                  <TerminalPane
                    key={`${sessionHost.id}:${termGen}`}
                    hostId={sessionHost.id}
                    hostName={sessionHost.name}
                    onClose={() => setSession(null)}
                  />
                </div>
              ) : null}
            </main>
          </div>
        )}
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
      <SettingsPage open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ToastViewport />
    </>
  )
}

const ASCII = `
██╗   ██╗ ██████╗ ██████╗ ████████╗███████╗██╗  ██╗
██║   ██║██╔═══██╗██╔══██╗╚══██╔══╝██╔════╝╚██╗██╔╝
██║   ██║██║   ██║██████╔╝   ██║   █████╗   ╚███╔╝
╚██╗ ██╔╝██║   ██║██╔══██╗   ██║   ██╔══╝   ██╔██╗
 ╚████╔╝ ╚██████╔╝██║  ██║   ██║   ███████╗██╔╝ ██╗
  ╚═══╝   ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
`.trim()
