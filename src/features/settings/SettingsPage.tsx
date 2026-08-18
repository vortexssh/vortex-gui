import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { save, open as openFile } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { api, parseCommandError, type SettingsPublic } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { toast } from '@/store/uiStore'

interface SettingsPageProps {
  open: boolean
  onClose: () => void
}

export function SettingsPage({ open, onClose }: SettingsPageProps) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, enabled: open })
  const st = q.data

  const [coreUrl, setCoreUrl] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const [syncOnStart, setSyncOnStart] = useState(true)
  const [exportPw, setExportPw] = useState('')
  const [importPw, setImportPw] = useState('')
  const [overwrite, setOverwrite] = useState(false)

  useEffect(() => {
    if (!open || !st) return
    setCoreUrl(st.coreUrl)
    setWebUrl(st.webUrl)
    setSyncOnStart(st.syncOnStart)
  }, [open, st])

  const saveMut = useMutation({
    mutationFn: () => api.saveSettings({ coreUrl, webUrl, syncOnStart }),
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
    <Modal
      open={open}
      title="Settings"
      onClose={() => {
        onClose()
      }}
      wide
      footer={
        <Button variant="primary" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
          Save
        </Button>
      }
    >
      <SettingsBody
        st={st}
        coreUrl={coreUrl}
        webUrl={webUrl}
        syncOnStart={syncOnStart}
        setCoreUrl={setCoreUrl}
        setWebUrl={setWebUrl}
        setSyncOnStart={setSyncOnStart}
        loginPending={loginMut.isPending}
        onLogin={() => loginMut.mutate()}
        onLogout={() => logoutMut.mutate()}
        exportPw={exportPw}
        importPw={importPw}
        overwrite={overwrite}
        setExportPw={setExportPw}
        setImportPw={setImportPw}
        setOverwrite={setOverwrite}
        onExport={() => void onExport()}
        onImport={() => void onImport()}
      />
    </Modal>
  )
}

function SettingsBody({
  st,
  coreUrl,
  webUrl,
  syncOnStart,
  setCoreUrl,
  setWebUrl,
  setSyncOnStart,
  loginPending,
  onLogin,
  onLogout,
  exportPw,
  importPw,
  overwrite,
  setExportPw,
  setImportPw,
  setOverwrite,
  onExport,
  onImport,
}: {
  st: SettingsPublic | undefined
  coreUrl: string
  webUrl: string
  syncOnStart: boolean
  setCoreUrl: (v: string) => void
  setWebUrl: (v: string) => void
  setSyncOnStart: (v: boolean) => void
  loginPending: boolean
  onLogin: () => void
  onLogout: () => void
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
    <div className="flex flex-col gap-5">
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

      <section className="flex flex-col gap-3 border-t border-border pt-4">
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

      <details className="border-t border-border pt-4">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-wider text-muted hover:text-dim">
          Advanced · Core / Web URLs
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-dim">
            Leave empty to use production defaults. Wrong URLs break login and proxy.
          </p>
          <Input label="Vortex Web URL" value={webUrl} onChange={(e) => setWebUrl(e.target.value)} />
          <Input
            label="Vortex Core URL"
            value={coreUrl}
            onChange={(e) => setCoreUrl(e.target.value)}
          />
        </div>
      </details>
    </div>
  )
}
