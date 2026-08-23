import { LayoutGrid, Square, X } from 'lucide-react'
import { HostDetail } from '@/features/hosts/HostDetail'
import { TerminalPane } from '@/features/terminal/TerminalPane'
import { TerminalTabs } from '@/features/terminal/TerminalTabs'
import type { Host, SettingsPublic } from '@/lib/api'
import { layoutOf, termTabTitle, useUiStore } from '@/store/uiStore'

const ASCII = `
██╗   ██╗ ██████╗ ██████╗ ████████╗███████╗██╗  ██╗
██║   ██║██╔═══██╗██╔══██╗╚══██╔══╝██╔════╝╚██╗██╔╝
██║   ██║██║   ██║██████╔╝   ██║   █████╗   ╚███╔╝
╚██╗ ██╔╝██║   ██║██╔══██╗   ██║   ██╔══╝   ██╔██╗
 ╚████╔╝ ╚██████╔╝██║  ██║   ██║   ███████╗██╔╝ ██╗
  ╚═══╝   ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
`.trim()

interface HostWorkspaceProps {
  selected: Host | null
  settings: SettingsPublic | undefined
  onEdit: () => void
  onDelete: (fromCloud: boolean) => void
  onConnect: () => void
  onNewTerm: () => void
  onOpenFiles: () => void
}

export function HostWorkspace({
  selected,
  settings,
  onEdit,
  onDelete,
  onConnect,
  onNewTerm,
  onOpenFiles,
}: HostWorkspaceProps) {
  const layout = layoutOf(settings?.terminalLayout)
  const termTabs = useUiStore((s) => s.termTabs)
  const activeTermId = useUiStore((s) => s.activeTermId)
  const focusTerm = useUiStore((s) => s.focusTerm)
  const closeTerm = useUiStore((s) => s.closeTerm)
  const sessionOpen = Boolean(selected && termTabs.some((t) => t.hostId === selected.id))

  if (layout === 'window' || layout === 'provided') {
    return (
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <DetailOrEmpty
          selected={selected}
          settings={settings}
          onEdit={onEdit}
          onDelete={onDelete}
          onConnect={onConnect}
          onNewTerm={onNewTerm}
          onOpenFiles={onOpenFiles}
          sessionOpen={false}
        />
      </div>
    )
  }

  if (layout === 'split') {
    const hostTabs = selected ? termTabs.filter((t) => t.hostId === selected.id) : termTabs
    const tab =
      hostTabs.find((t) => t.id === activeTermId) ??
      hostTabs[0] ??
      null
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <div
          className={tab ? 'min-h-0 shrink-0 overflow-auto' : 'min-h-0 flex-1 overflow-auto'}
          style={tab ? { maxHeight: '42%' } : undefined}
        >
          <DetailOrEmpty
            selected={selected}
            settings={settings}
            onEdit={onEdit}
            onDelete={onDelete}
            onConnect={onConnect}
            onNewTerm={onNewTerm}
            onOpenFiles={onOpenFiles}
            sessionOpen={sessionOpen}
          />
        </div>
        {tab ? (
          <div className="flex min-h-[280px] flex-1 flex-col overflow-hidden border-t border-border">
            {hostTabs.length > 1 ? (
              <div className="flex shrink-0 items-center gap-px overflow-x-auto border-b border-border bg-surface px-1">
                {hostTabs.map((t) => {
                  const on = t.id === tab.id
                  return (
                    <div
                      key={t.id}
                      className={`flex items-center gap-1 px-2 py-1 font-mono text-[11px] uppercase tracking-wider ${
                        on ? 'text-neon' : 'text-muted hover:text-dim'
                      }`}
                    >
                      <button type="button" className="truncate" onClick={() => focusTerm(t.id)}>
                        {termTabTitle(t, hostTabs)}
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted hover:bg-border hover:text-fg-strong"
                        aria-label={`Close ${termTabTitle(t, hostTabs)}`}
                        onClick={() => closeTerm(t.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : null}
            {hostTabs.length > 1 ? (
              <TerminalTabs tabs={hostTabs} activeId={tab.id} onClose={closeTerm} />
            ) : (
              <TerminalPane
                key={`${tab.id}:${tab.gen}`}
                hostId={tab.hostId}
                hostName={tab.hostName}
                onClose={() => closeTerm(tab.id)}
              />
            )}
          </div>
        ) : null}
      </div>
    )
  }

  const showingTerm = Boolean(activeTermId) && termTabs.length > 0

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-end gap-px overflow-x-auto border-b border-border bg-surface px-1 pt-1">
        <button
          type="button"
          className={`flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ${
            !showingTerm
              ? 'border-neon/35 bg-void text-neon'
              : 'border-transparent text-muted hover:bg-panel hover:text-dim'
          }`}
          onClick={() => focusTerm('__details__')}
        >
          <LayoutGrid className="h-3 w-3" />
          {selected?.name ?? 'host'}
        </button>
        {termTabs.map((tab) => {
          const on = tab.id === activeTermId
          return (
            <div
              key={tab.id}
              className={`flex min-w-0 max-w-[14rem] items-center gap-1 rounded-t-md border border-b-0 px-2 py-1.5 ${
                on
                  ? 'border-neon/35 bg-void text-neon'
                  : 'border-transparent text-muted hover:bg-panel hover:text-dim'
              }`}
            >
              <button
                type="button"
                className="min-w-0 truncate font-mono text-[11px] uppercase tracking-wider"
                onClick={() => focusTerm(tab.id)}
              >
                <Square className="mr-1 inline h-2.5 w-2.5" />
                {termTabTitle(tab, termTabs)}
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-muted hover:bg-border hover:text-fg-strong"
                aria-label={`Close ${termTabTitle(tab, termTabs)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTerm(tab.id)
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          className="absolute inset-0 overflow-auto"
          style={{ display: showingTerm ? 'none' : 'block' }}
        >
          <DetailOrEmpty
            selected={selected}
            settings={settings}
            onEdit={onEdit}
            onDelete={onDelete}
            onConnect={onConnect}
            onNewTerm={onNewTerm}
            onOpenFiles={onOpenFiles}
            sessionOpen={sessionOpen}
          />
        </div>
        <div className="absolute inset-0" style={{ display: showingTerm ? 'block' : 'none' }}>
          <TerminalTabs tabs={termTabs} activeId={activeTermId} onClose={closeTerm} />
        </div>
      </div>
    </div>
  )
}

function DetailOrEmpty({
  selected,
  settings,
  onEdit,
  onDelete,
  onConnect,
  onNewTerm,
  onOpenFiles,
  sessionOpen,
}: {
  selected: Host | null
  settings: SettingsPublic | undefined
  onEdit: () => void
  onDelete: (fromCloud: boolean) => void
  onConnect: () => void
  onNewTerm: () => void
  onOpenFiles: () => void
  sessionOpen: boolean
}) {
  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <pre className="font-mono text-[10px] leading-tight text-neon/80">{ASCII}</pre>
          <p className="mt-4 text-sm text-dim">
            Local-first SSH manager. Secrets never leave this machine. Select a host or add one —
            cloud login is optional.
          </p>
        </div>
      </div>
    )
  }
  return (
    <HostDetail
      host={selected}
      settings={settings}
      onEdit={onEdit}
      onDelete={onDelete}
      onConnect={onConnect}
      onNewTerm={onNewTerm}
      onOpenFiles={onOpenFiles}
      sessionOpen={sessionOpen}
    />
  )
}
