import { useQuery } from '@tanstack/react-query'
import { Activity, Cloud, CloudOff, RefreshCw, Server, Settings, Wallet } from 'lucide-react'
import { api, type UserMe } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { TwoFactorBanner } from './TwoFactorBanner'
import { useUiStore } from '@/store/uiStore'

interface AppShellProps {
  children: React.ReactNode
  onSync: () => void
  syncing: boolean
  onOpenSettings: () => void
}

export function AppShell({ children, onSync, syncing, onOpenSettings }: AppShellProps) {
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
    enabled: Boolean(settingsQ.data?.linked),
    retry: false,
  })
  const settings = settingsQ.data
  const me: UserMe | null = meQ.data ?? null
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)

  return (
    <div className="flex h-full flex-col bg-void">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-neon" strokeWidth={2.25} />
            <div className="leading-tight">
              <div className="font-mono text-sm font-semibold tracking-wide text-neon text-glow">
                VORTEX
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                desktop · local-first
              </div>
            </div>
          </div>
          <nav className="flex gap-1">
            <Button
              variant={view === 'hosts' ? 'primary' : 'ghost'}
              className="!text-xs"
              onClick={() => setView('hosts')}
            >
              <Server className="h-3.5 w-3.5" />
              Hosts
            </Button>
            <Button
              variant={view === 'billing' ? 'primary' : 'ghost'}
              className="!text-xs"
              disabled={!settings?.linked}
              title={settings?.linked ? 'Billing calendar' : 'Sign in to use billing'}
              onClick={() => setView('billing')}
            >
              <Wallet className="h-3.5 w-3.5" />
              Billing
            </Button>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {settings?.linked ? (
            <span className="hidden items-center gap-1.5 font-mono text-xs text-dim sm:flex">
              <Cloud className="h-3.5 w-3.5 text-neon" />
              {settings.accountEmail || 'linked'}
            </span>
          ) : (
            <span className="hidden items-center gap-1.5 font-mono text-xs text-muted sm:flex">
              <CloudOff className="h-3.5 w-3.5" />
              local-only
            </span>
          )}
          <Button
            variant="outline"
            className="!text-xs"
            disabled={!settings?.linked || syncing}
            onClick={onSync}
            title={settings?.linked ? 'Sync metadata from Core' : 'Sign in to sync'}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync
          </Button>
          <Button variant="ghost" className="!px-2" onClick={onOpenSettings} aria-label="Settings">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <TwoFactorBanner user={settings?.linked ? me : null} />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
