import { useState } from 'react'
import { Cloud, HardDrive, Lock, Search, Plus, ChevronUp, ChevronDown } from 'lucide-react'
import type { Host } from '@/lib/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface HostListProps {
  hosts: Host[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onMove: (id: string, delta: number) => void
}

export function HostList({ hosts, selectedId, onSelect, onAdd, onMove }: HostListProps) {
  const [q, setQ] = useState('')
  const filtered = hosts.filter((h) => {
    const hay = `${h.name} ${h.address} ${h.user} ${h.tags.join(' ')}`.toLowerCase()
    return hay.includes(q.trim().toLowerCase())
  })

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-muted" />
          <Input
            className="!py-1.5 !pl-8"
            placeholder="filter hosts"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button variant="primary" className="!px-2" onClick={onAdd} aria-label="Add host">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center font-mono text-xs text-muted">
            {hosts.length === 0 ? 'No hosts yet. Add one locally — cloud is optional.' : 'No match'}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filtered.map((h) => {
              const active = h.id === selectedId
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(h.id)}
                    className={`flex w-full flex-col gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors ${
                      active
                        ? 'border-neon/40 bg-neon/10 neon-ring'
                        : 'border-transparent hover:border-border hover:bg-panel'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {h.source === 'cloud' ? (
                        <Cloud className="h-3.5 w-3.5 shrink-0 text-neon/80" />
                      ) : (
                        <HardDrive className="h-3.5 w-3.5 shrink-0 text-muted" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-strong">
                        {h.name}
                      </span>
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          h.agentOnline ? 'dot-online bg-neon' : 'bg-muted'
                        }`}
                        title={h.agentOnline ? 'agent online' : 'agent offline / local'}
                      />
                      {h.hasSecret ? (
                        <Lock className="h-3 w-3 text-neon/70" />
                      ) : (
                        <Lock className="h-3 w-3 text-muted/40" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 pl-5">
                      <span className="truncate font-mono text-[11px] text-dim">
                        {h.user}@{h.address || '(nat)'}:{h.port}
                      </span>
                      <Badge tone={h.proxyEnabled ? 'neon' : 'muted'}>
                        {h.proxyEnabled ? 'proxy' : 'direct'}
                      </Badge>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {selectedId ? (
        <div className="flex justify-end gap-1 border-t border-border p-2">
          <Button variant="ghost" className="!px-2" onClick={() => onMove(selectedId, -1)}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" className="!px-2" onClick={() => onMove(selectedId, 1)}>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </aside>
  )
}
