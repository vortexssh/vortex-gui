import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { save, open as openFile } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import {
  Cloud,
  KeyRound,
  Monitor,
  Shield,
  SlidersHorizontal,
} from 'lucide-react'
import {
  api,
  parseCommandError,
  type SettingsPublic,
  type TerminalLayout,
} from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { layoutOf, toast, useUiStore } from '@/store/uiStore'

type Section = 'cloud' | 'terminal' | 'roster' | 'advanced'

const NAV: { id: Section; label: string; icon: typeof Cloud }[] = [
  { id: 'cloud', label: 'Cloud', icon: Cloud },
  { id: 'terminal', label: 'Terminal', icon: Monitor },
  { id: 'roster', label: 'E2EE roster', icon: Shield },
  { id: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
]

export function SettingsPage() {
  const qc = useQueryClient()
  const section = useUiStore((s) => s.settingsSection)
  const setSection = useUiStore((s) => s.setSettingsSection)
  const q = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const st = q.data

  const [coreUrl, setCoreUrl] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const [syncOnStart, setSyncOnStart] = useState(true)
  const [terminalLayout, setTerminalLayout] = useState<TerminalLayout>('tabs')
  const [sshCommand, setSshCommand] = useState('ssh')
  const [exportPw, setExportPw] = useState('')
  const [importPw, setImportPw] = useState('')
  const [overwrite, setOverwrite] = useState(false)

  useEffect(() => {
    if (!st) return
    setCoreUrl(st.coreUrl)
    setWebUrl(st.webUrl)
    setSyncOnStart(st.syncOnStart)
    setTerminalLayout(layoutOf(st.terminalLayout))
    setSshCommand(st.sshCommand?.trim() || 'ssh')
  }, [st])

  const saveMut = useMutation({
    mutationFn: () =>
      api.saveSettings({ coreUrl, webUrl, syncOnStart, terminalLayout, sshCommand }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s)
      toast('Settings saved', 'success')
    },
    onError: (e) => toast(parseCommandError(e).message, 'error'),
  })

  const loginMut = useMutation({
    mutationFn: api.browserLogin,
    onSuccess: async (s) => {
      qc.setQueryData(['settings'], s)
      toast(`Linked as ${s.accountEmail || 'account'}`, 'success')
      await qc.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (e) => toast(parseCommandError(e).message, 'error'),
  })

  const logoutMut = useMutation({
    mutationFn: api.logout,
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s)
      qc.removeQueries({ queryKey: ['me'] })
      toast('Signed out — local hosts kept', 'success')
    },
  })

  async function onExport() {
    if (exportPw.length < 12) {
      toast('Export password must be at least 12 characters', 'error')
      return
    }
    const path = await save({
      defaultPath: 'roster.vortex',
      filters: [{ name: 'Vortex E2EE', extensions: ['vortex'] }],
    })
    if (!path) return
    try {
      await api.exportVortex(path, exportPw)
      toast('Exported .vortex', 'success')
      setExportPw('')
    } catch (e) {
      toast(parseCommandError(e).message, 'error')
    }
  }

  async function onImport() {
    if (importPw.length < 12) {
      toast('Password must be at least 12 characters', 'error')
      return
    }
    const path = await openFile({
      filters: [{ name: 'Vortex E2EE', extensions: ['vortex'] }],
      multiple: false,
    })
    if (!path || Array.isArray(path)) return
    try {
      const n = await api.importVortex(path, importPw, overwrite)
      toast(`Imported ${n} host(s)`, 'success')
      setImportPw('')
      await qc.invalidateQueries({ queryKey: ['hosts'] })
    } catch (e) {
      toast(parseCommandError(e).message, 'error')
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-surface py-3">
        <div className="px-4 pb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
          Settings
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((item) => {
            const Icon = item.icon
            const on = section === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-left font-mono text-xs uppercase tracking-wider ${
                  on ? 'bg-neon/10 text-neon' : 'text-muted hover:bg-panel hover:text-dim'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            )
          })}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <div className="mx-auto flex max-w-xl flex-col gap-5">
            {section === 'cloud' ? (
              <CloudSection
                st={st}
                syncOnStart={syncOnStart}
                setSyncOnStart={setSyncOnStart}
                loginPending={loginMut.isPending}
                onLogin={() => loginMut.mutate()}
                onLogout={() => logoutMut.mutate()}
              />
            ) : null}
            {section === 'terminal' ? (
              <TerminalSection
                value={terminalLayout}
                onChange={setTerminalLayout}
                sshCommand={sshCommand}
                onSshCommandChange={setSshCommand}
              />
            ) : null}
            {section === 'roster' ? (
              <RosterSection
                exportPw={exportPw}
                importPw={importPw}
                overwrite={overwrite}
                setExportPw={setExportPw}
                setImportPw={setImportPw}
                setOverwrite={setOverwrite}
                onExport={() => void onExport()}
                onImport={() => void onImport()}
              />
            ) : null}
            {section === 'advanced' ? (
              <AdvancedSection
                coreUrl={coreUrl}
                webUrl={webUrl}
                setCoreUrl={setCoreUrl}
                setWebUrl={setWebUrl}
              />
            ) : null}
          </div>
        </div>
        <div className="flex justify-end border-t border-border px-6 py-3">
          <Button variant="primary" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function CloudSection({
  st,
  syncOnStart,
  setSyncOnStart,
  loginPending,
  onLogin,
  onLogout,
}: {
  st: SettingsPublic | undefined
  syncOnStart: boolean
  setSyncOnStart: (v: boolean) => void
  loginPending: boolean
  onLogin: () => void
  onLogout: () => void
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-mono text-xs uppercase tracking-wider text-neon">Cloud</h3>
      <p className="text-sm text-dim">
        {st?.linked
          ? `Linked as ${st.accountEmail || 'account'}. API key stays on disk, never shown.`
          : 'Local-only mode. Log in via Vortex Web (device-link) to sync metadata and use Proxy.'}
      </p>
      <div className="flex gap-2">
        {st?.linked ? (
          <Button variant="outline" onClick={onLogout}>
            Log out
          </Button>
        ) : (
          <Button variant="primary" disabled={loginPending} onClick={onLogin}>
            {loginPending ? 'Waiting for browser…' : 'Log in via browser'}
          </Button>
        )}
      </div>
      <Toggle checked={syncOnStart} onChange={setSyncOnStart} label="Sync on start" />
    </section>
  )
}

function TerminalSection({
  value,
  onChange,
  sshCommand,
  onSshCommandChange,
}: {
  value: TerminalLayout
  onChange: (v: TerminalLayout) => void
  sshCommand: string
  onSshCommandChange: (v: string) => void
}) {
  const options: { id: TerminalLayout; title: string; body: string }[] = [
    {
      id: 'tabs',
      title: 'Tabs',
      body: 'SSH sessions as tabs next to host details. Default.',
    },
    {
      id: 'split',
      title: 'Split pane',
      body: 'Terminal docks under the host card (old layout).',
    },
    {
      id: 'window',
      title: 'Separate window',
      body: 'Each session opens in its own OS window.',
    },
  ]
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-mono text-xs uppercase tracking-wider text-neon">Terminal</h3>
      <p className="text-sm text-dim">How Connect places the in-app SSH session.</p>
      <div className="flex flex-col gap-2">
        {options.map((opt) => {
          const on = value === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={`rounded-md border px-4 py-3 text-left transition-colors ${
                on ? 'border-neon/40 bg-neon/10' : 'border-border bg-panel hover:border-border-active'
              }`}
            >
              <div className={`font-mono text-xs uppercase tracking-wider ${on ? 'text-neon' : 'text-dim'}`}>
                {opt.title}
              </div>
              <p className="mt-1 text-sm text-muted">{opt.body}</p>
            </button>
          )
        })}
      </div>
      <div className="mt-2 border-t border-border pt-4">
        <Input
          label="SSH command"
          value={sshCommand}
          onChange={(e) => onSshCommandChange(e.target.value)}
          placeholder="ssh"
          className="font-mono"
        />
        <p className="mt-2 text-sm text-muted">
          Used by External on direct hosts. Default <span className="font-mono text-dim">ssh</span>.
          Prefer a terminal wrapper so a window opens — e.g.{' '}
          <span className="font-mono text-dim">kitty +kitten ssh</span>,{' '}
          <span className="font-mono text-dim">wezterm ssh</span>.
        </p>
      </div>
    </section>
  )
}

function RosterSection({
  exportPw,
  importPw,
  overwrite,
  setExportPw,
  setImportPw,
  setOverwrite,
  onExport,
  onImport,
}: {
  exportPw: string
  importPw: string
  overwrite: boolean
  setExportPw: (v: string) => void
  setImportPw: (v: string) => void
  setOverwrite: (v: boolean) => void
  onExport: () => void
  onImport: () => void
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-mono text-xs uppercase tracking-wider text-neon">E2EE roster (.vortex)</h3>
      <p className="text-sm text-dim">
        Same Argon2id + AES-256-GCM format as Vortex TUI. Password ≥ 12 chars. Secrets never hit
        Core.
      </p>
      <Input
        label="Export password"
        type="password"
        value={exportPw}
        onChange={(e) => setExportPw(e.target.value)}
      />
      <Button variant="outline" onClick={onExport}>
        Export .vortex
      </Button>
      <Input
        label="Import password"
        type="password"
        value={importPw}
        onChange={(e) => setImportPw(e.target.value)}
      />
      <Toggle checked={overwrite} onChange={setOverwrite} label="Overwrite existing secrets" />
      <Button variant="outline" onClick={onImport}>
        Import .vortex
      </Button>
    </section>
  )
}

function AdvancedSection({
  coreUrl,
  webUrl,
  setCoreUrl,
  setWebUrl,
}: {
  coreUrl: string
  webUrl: string
  setCoreUrl: (v: string) => void
  setWebUrl: (v: string) => void
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted">
        <KeyRound className="h-3.5 w-3.5" />
        Core / Web URLs
      </h3>
      <p className="text-sm text-dim">
        Leave empty to use production defaults. Wrong URLs break login and proxy.
      </p>
      <Input label="Vortex Web URL" value={webUrl} onChange={(e) => setWebUrl(e.target.value)} />
      <Input label="Vortex Core URL" value={coreUrl} onChange={(e) => setCoreUrl(e.target.value)} />
    </section>
  )
}
