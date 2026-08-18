import { getCurrentWindow } from '@tauri-apps/api/window'
import { TerminalPane } from '@/features/terminal/TerminalPane'

export function TermWindow({ hostId, hostName }: { hostId: string; hostName: string }) {
  return (
    <div className="h-full min-h-0 bg-void">
      <TerminalPane
        hostId={hostId}
        hostName={hostName}
        chrome="full"
        onClose={() => {
          void getCurrentWindow().close()
        }}
      />
    </div>
  )
}

export function parseTermHash(): { hostId: string; hostName: string } | null {
  const hash = window.location.hash
  if (!hash.startsWith('#/term')) return null
  const qIndex = hash.indexOf('?')
  const q = new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex) : '')
  const hostId = q.get('hostId')?.trim() ?? ''
  if (!hostId) return null
  return { hostId, hostName: q.get('name')?.trim() || 'ssh' }
}
