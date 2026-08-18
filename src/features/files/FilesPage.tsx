import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import {
  ArrowUp,
  Download,
  FolderPlus,
  HardDrive,
  Loader2,
  Pencil,
  Plug,
  PlugZap,
  Server,
  Trash2,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import {
  api,
  is2faError,
  listenSftpProgress,
  parseCommandError,
  type FsEntry,
  type Host,
  type SftpProgressEvent,
} from '@/lib/api'
import { toast } from '@/store/uiStore'

const DND = 'application/x-vortex-entry'

interface DragPayload {
  side: 'local' | 'remote'
  path: string
  name: string
  isDir: boolean
}

interface TransferItem extends SftpProgressEvent {}

interface FilesPageProps {
  hosts: Host[]
  selectedId: string | null
  onSelectHost: (id: string) => void
}

export function FilesPage({ hosts, selectedId, onSelectHost }: FilesPageProps) {
  const host = hosts.find((h) => h.id === selectedId) ?? null
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [mode, setMode] = useState<string | null>(null)
  const [localPath, setLocalPath] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [localEntries, setLocalEntries] = useState<FsEntry[]>([])
  const [remoteEntries, setRemoteEntries] = useState<FsEntry[]>([])
  const [localSel, setLocalSel] = useState<FsEntry | null>(null)
  const [remoteSel, setRemoteSel] = useState<FsEntry | null>(null)
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const localPaneRef = useRef<HTMLDivElement>(null)
  const remotePaneRef = useRef<HTMLDivElement>(null)
  const localPathRef = useRef(localPath)
  const remotePathRef = useRef(remotePath)
  const hostRef = useRef(host)
  const connectedRef = useRef(connected)
  localPathRef.current = localPath
  remotePathRef.current = remotePath
  hostRef.current = host
  connectedRef.current = connected

  const refreshLocal = useCallback(async (path: string) => {
    const listing = await api.fsList(path)
    setLocalPath(listing.path)
    setLocalEntries(listing.entries)
    setLocalSel(null)
  }, [])

  const hostId = host?.id

  const refreshRemote = useCallback(async (path: string) => {
    if (!hostId) return
    const listing = await api.sftpList(hostId, path)
    setRemotePath(listing.path)
    setRemoteEntries(listing.entries)
    setRemoteSel(null)
  }, [hostId])

  useEffect(() => {
    void (async () => {
      try {
        const home = await api.fsHome()
        await refreshLocal(home)
      } catch (e) {
        toast(parseCommandError(e).message, 'error')
      }
    })()
  }, [refreshLocal])

  useEffect(() => {
    if (!host) {
      setConnected(false)
      setRemotePath('')
      setRemoteEntries([])
      return
    }
    let cancelled = false
    setConnecting(true)
    setConnected(false)
    void (async () => {
      try {
        const res = await api.sftpConnect(host.id)
        if (cancelled) {
          await api.sftpClose(host.id).catch(() => undefined)
          return
        }
        setMode(res.mode)
        setConnected(true)
        await refreshRemote(res.cwd)
      } catch (e) {
        if (cancelled) return
        const err = parseCommandError(e)
        toast(err.message, 'error')
        if (is2faError(err)) void api.openWebPath('security/2fa')
        setConnected(false)
      } finally {
        if (!cancelled) setConnecting(false)
      }
    })()
    return () => {
      cancelled = true
      void api.sftpClose(host.id).catch(() => undefined)
    }
  }, [hostId, refreshRemote])

  useEffect(() => {
    const un = listenSftpProgress((ev) => {
      setTransfers((prev) => {
        const i = prev.findIndex((t) => t.transferId === ev.transferId)
        if (i < 0) return [...prev, ev].slice(-8)
        const next = [...prev]
        next[i] = ev
        return next
      })
    })
    return () => {
      void un.then((fn) => fn())
    }
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return
        const target = paneAt(event.payload.position, localPaneRef.current, remotePaneRef.current)
        if (!target) return
        void handleOsDrop(target, event.payload.paths)
      })
      .then((fn) => {
        unlisten = fn
      })
    return () => unlisten?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pane refs + latest paths via refs
  }, [])

  function fail(e: unknown) {
    const err = parseCommandError(e)
    toast(err.message, 'error')
    if (is2faError(err)) void api.openWebPath('security/2fa')
  }

  async function handleOsDrop(side: 'local' | 'remote', paths: string[]) {
    const local = localPathRef.current
    const remote = remotePathRef.current
    const h = hostRef.current
    for (const p of paths) {
      const name = p.split('/').pop() || 'file'
      if (side === 'local') {
        try {
          await api.fsCopy(p, joinPath(local, name))
        } catch (e) {
          fail(e)
        }
      } else if (h && connectedRef.current) {
        await runTransfer('put', p, joinPath(remote, name), name)
      }
    }
    await refreshLocal(local)
    if (connectedRef.current) await refreshRemote(remote).catch(fail)
  }

  async function runTransfer(
    direction: 'put' | 'get',
    local: string,
    remote: string,
    name: string,
  ) {
    const h = hostRef.current
    if (!h) return
    const transferId = crypto.randomUUID()
    setTransfers((prev) =>
      [
        ...prev,
        { transferId, done: 0, total: 0, name, finished: false, error: null },
      ].slice(-8),
    )
    try {
      await api.sftpTransfer({
        hostId: h.id,
        direction,
        localPath: local,
        remotePath: remote,
        transferId,
      })
    } catch (e) {
      fail(e)
    }
    await refreshLocal(localPathRef.current)
    if (connectedRef.current) await refreshRemote(remotePathRef.current).catch(fail)
  }

  async function onDropEntry(side: 'local' | 'remote', payload: DragPayload) {
    if (payload.side === side) return
    if (payload.side === 'local' && side === 'remote') {
      await runTransfer('put', payload.path, joinPath(remotePath, payload.name), payload.name)
    } else if (payload.side === 'remote' && side === 'local') {
      await runTransfer('get', joinPath(localPath, payload.name), payload.path, payload.name)
    }
  }

  async function localUp() {
    try {
      await refreshLocal(parentOf(localPath))
    } catch (e) {
      fail(e)
    }
  }
  async function remoteUp() {
    try {
      await refreshRemote(parentOf(remotePath))
    } catch (e) {
      fail(e)
    }
  }

  async function mkdir(side: 'local' | 'remote') {
    const name = window.prompt('Folder name')
    if (!name?.trim()) return
    try {
      if (side === 'local') {
        await api.fsMkdir(joinPath(localPath, name.trim()))
        await refreshLocal(localPath)
      } else if (host) {
        await api.sftpMkdir(host.id, joinPath(remotePath, name.trim()))
        await refreshRemote(remotePath)
      }
    } catch (e) {
      fail(e)
    }
  }

  async function renameSel(side: 'local' | 'remote') {
    const sel = side === 'local' ? localSel : remoteSel
    if (!sel) return
    const name = window.prompt('Rename to', sel.name)
    if (!name?.trim() || name === sel.name) return
    try {
      const dest = joinPath(side === 'local' ? localPath : remotePath, name.trim())
      if (side === 'local') {
        await api.fsRename(sel.path, dest)
        await refreshLocal(localPath)
      } else if (host) {
        await api.sftpRename(host.id, sel.path, dest)
        await refreshRemote(remotePath)
      }
    } catch (e) {
      fail(e)
    }
  }

  async function deleteSel(side: 'local' | 'remote') {
    const sel = side === 'local' ? localSel : remoteSel
    if (!sel) return
    if (!window.confirm(`Delete ${sel.name}?`)) return
    try {
      if (side === 'local') {
        await api.fsRemove(sel.path)
        await refreshLocal(localPath)
      } else if (host) {
        await api.sftpRemove(host.id, sel.path, sel.isDir)
        await refreshRemote(remotePath)
      }
    } catch (e) {
      fail(e)
    }
  }

  async function uploadSel() {
    if (!localSel) return
    await runTransfer('put', localSel.path, joinPath(remotePath, localSel.name), localSel.name)
  }
  async function downloadSel() {
    if (!remoteSel) return
    await runTransfer('get', joinPath(localPath, remoteSel.name), remoteSel.path, remoteSel.name)
  }

  const proxyBlocked = Boolean(host?.proxyEnabled && !host.agentOnline)

  return (
    <div className="flex h-full min-h-0 flex-col bg-void">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="min-w-[14rem]">
          <Select
            value={selectedId ?? ''}
            onChange={(e) => onSelectHost(e.target.value)}
          >
            <option value="" disabled>
              Select host
            </option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </div>
        {connecting ? (
          <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            connecting…
          </span>
        ) : connected ? (
          <span className="flex items-center gap-1.5 font-mono text-xs text-neon">
            <PlugZap className="h-3.5 w-3.5" />
            sftp · {mode}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
            <Plug className="h-3.5 w-3.5" />
            offline
          </span>
        )}
        {proxyBlocked ? (
          <span className="font-mono text-[11px] text-warn">agent offline</span>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-px bg-border">
        <FilePane
          paneRef={localPaneRef}
          side="local"
          icon={<HardDrive className="h-3.5 w-3.5" />}
          title="local"
          path={localPath}
          entries={localEntries}
          selected={localSel}
          onSelect={setLocalSel}
          onOpen={(e) => {
            if (e.isDir) void refreshLocal(e.path).catch(fail)
          }}
          onUp={() => void localUp()}
          onMkdir={() => void mkdir('local')}
          onRename={() => void renameSel('local')}
          onDelete={() => void deleteSel('local')}
          extraAction={
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              disabled={!localSel || !connected}
              onClick={() => void uploadSel()}
              title="Upload to remote"
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
          }
          onDropEntry={(p) => void onDropEntry('local', p)}
          onNavigate={(p) => void refreshLocal(p).catch(fail)}
        />
        <FilePane
          paneRef={remotePaneRef}
          side="remote"
          icon={<Server className="h-3.5 w-3.5" />}
          title={host ? `remote · ${host.name}` : 'remote'}
          path={connected ? remotePath : '—'}
          entries={connected ? remoteEntries : []}
          selected={remoteSel}
          onSelect={setRemoteSel}
          disabled={!connected}
          onOpen={(e) => {
            if (e.isDir) void refreshRemote(e.path).catch(fail)
          }}
          onUp={() => void remoteUp()}
          onMkdir={() => void mkdir('remote')}
          onRename={() => void renameSel('remote')}
          onDelete={() => void deleteSel('remote')}
          extraAction={
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              disabled={!remoteSel || !connected}
              onClick={() => void downloadSel()}
              title="Download to local"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          }
          onDropEntry={(p) => void onDropEntry('remote', p)}
          onNavigate={(p) => void refreshRemote(p).catch(fail)}
        />
      </div>

      {transfers.length > 0 ? (
        <div className="max-h-28 shrink-0 overflow-auto border-t border-border bg-surface px-4 py-2">
          {transfers.map((t) => {
            const pct = t.total > 0 ? Math.min(100, Math.round((t.done / t.total) * 100)) : t.finished ? 100 : 0
            return (
              <div key={t.transferId} className="mb-1 last:mb-0">
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted">
                  <span className="truncate text-dim">{t.name}</span>
                  <span className={t.error ? 'text-danger' : 'text-neon'}>
                    {t.error ? t.error : t.finished ? 'done' : `${pct}%`}
                  </span>
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-panel">
                  <div className="h-full bg-neon/70" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function FilePane({
  paneRef,
  side,
  icon,
  title,
  path,
  entries,
  selected,
  onSelect,
  onOpen,
  onUp,
  onMkdir,
  onRename,
  onDelete,
  extraAction,
  onDropEntry,
  onNavigate,
  disabled,
}: {
  paneRef: RefObject<HTMLDivElement>
  side: 'local' | 'remote'
  icon: ReactNode
  title: string
  path: string
  entries: FsEntry[]
  selected: FsEntry | null
  onSelect: (e: FsEntry | null) => void
  onOpen: (e: FsEntry) => void
  onUp: () => void
  onMkdir: () => void
  onRename: () => void
  onDelete: () => void
  extraAction: ReactNode
  onDropEntry: (p: DragPayload) => void
  onNavigate: (path: string) => void
  disabled?: boolean
}) {
  const [over, setOver] = useState(false)
  const crumbs = breadcrumbs(path)

  return (
    <div
      ref={paneRef}
      className={`flex min-h-0 min-w-0 flex-col bg-void ${over ? 'ring-1 ring-inset ring-neon/40' : ''} ${
        disabled ? 'opacity-60' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const raw = e.dataTransfer.getData(DND)
        if (!raw) return
        try {
          onDropEntry(JSON.parse(raw) as DragPayload)
        } catch {
          /* ignore */
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-neon">
          {icon}
          {title}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" className="!px-2 !py-1 !text-xs" onClick={onUp} disabled={disabled} title="Up">
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            className="!px-2 !py-1 !text-xs"
            onClick={onMkdir}
            disabled={disabled}
            title="New folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            className="!px-2 !py-1 !text-xs"
            onClick={onRename}
            disabled={disabled || !selected}
            title="Rename"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            className="!px-2 !py-1 !text-xs"
            onClick={onDelete}
            disabled={disabled || !selected}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {extraAction}
        </div>
      </div>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1 font-mono text-[11px] text-muted">
        {crumbs.map((c, i) => (
          <span key={`${c.path}-${i}`} className="flex items-center gap-1">
            {i > 0 ? <span className="text-border-active">/</span> : null}
            <button
              type="button"
              className={i === crumbs.length - 1 ? 'text-dim' : 'hover:text-neon'}
              onClick={() => onNavigate(c.path)}
              disabled={disabled}
            >
              {c.label}
            </button>
          </span>
        ))}
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Backspace') {
            e.preventDefault()
            onUp()
          }
          if (e.key === 'Enter' && selected) onOpen(selected)
        }}
      >
        <table className="w-full text-left font-mono text-xs">
          <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-1.5 font-medium">Name</th>
              <th className="w-24 px-3 py-1.5 font-medium">Size</th>
              <th className="w-40 px-3 py-1.5 font-medium">Modified</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((ent) => {
              const on = selected?.path === ent.path
              return (
                <tr
                  key={ent.path}
                  draggable={!disabled}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      DND,
                      JSON.stringify({
                        side,
                        path: ent.path,
                        name: ent.name,
                        isDir: ent.isDir,
                      } satisfies DragPayload),
                    )
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  className={`cursor-default select-none ${
                    on ? 'bg-neon/10 text-neon' : 'text-fg hover:bg-panel'
                  }`}
                  onClick={() => onSelect(ent)}
                  onDoubleClick={() => onOpen(ent)}
                >
                  <td className="truncate px-3 py-1">
                    {ent.isDir ? (
                      <span className="text-neon/80">{ent.name}/</span>
                    ) : (
                      ent.name
                    )}
                  </td>
                  <td className="px-3 py-1 text-muted">{ent.isDir ? '—' : formatSize(ent.size)}</td>
                  <td className="px-3 py-1 text-muted">{formatMtime(ent.mtime)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {entries.length === 0 ? (
          <p className="px-3 py-6 text-center font-mono text-xs text-muted">
            {disabled ? 'connect a host' : 'empty'}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function joinPath(dir: string, name: string): string {
  if (!dir || dir === '/') return `/${name}`.replace(/\/+/g, '/')
  return `${dir.replace(/\/+$/, '')}/${name}`
}

function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  if (i <= 0) return '/'
  return trimmed.slice(0, i)
}

function breadcrumbs(path: string): { label: string; path: string }[] {
  if (!path || path === '—') return [{ label: path || '/', path }]
  const parts = path.split('/').filter(Boolean)
  const out: { label: string; path: string }[] = [{ label: '/', path: '/' }]
  let acc = ''
  for (const p of parts) {
    acc += `/${p}`
    out.push({ label: p, path: acc })
  }
  return out
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatMtime(t: number | null): string {
  if (t == null || t <= 0) return '—'
  const ms = t > 1e12 ? t : t * 1000
  return new Date(ms).toLocaleString()
}

function paneAt(
  pos: { x: number; y: number },
  localEl: HTMLDivElement | null,
  remoteEl: HTMLDivElement | null,
): 'local' | 'remote' | null {
  const scale = window.devicePixelRatio || 1
  const x = pos.x / scale
  const y = pos.y / scale
  const hit = (el: HTMLDivElement | null) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }
  if (hit(localEl)) return 'local'
  if (hit(remoteEl)) return 'remote'
  return null
}
