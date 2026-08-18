import { TerminalPane } from './TerminalPane'
import type { TermTab } from '@/store/uiStore'

interface TerminalTabsProps {
  tabs: TermTab[]
  activeId: string | null
  onClose: (id: string) => void
}

/** Keeps every SSH session mounted; only the active pane is visible. */
export function TerminalTabs({ tabs, activeId, onClose }: TerminalTabsProps) {
  if (tabs.length === 0) return null
  return (
    <div className="relative h-full min-h-0">
      {tabs.map((tab) => (
        <div key={`${tab.id}:${tab.gen}`} className="absolute inset-0 flex min-h-0 flex-col">
          <TerminalPane
            hostId={tab.hostId}
            hostName={tab.hostName}
            active={tab.id === activeId}
            chrome="none"
            onClose={() => onClose(tab.id)}
          />
        </div>
      ))}
    </div>
  )
}
