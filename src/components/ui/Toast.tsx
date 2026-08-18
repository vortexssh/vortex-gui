import { X } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'

export function ToastViewport() {
  const items = useUiStore((s) => s.toasts)
  const dismiss = useUiStore((s) => s.dismissToast)

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[9999] flex flex-col items-end gap-2 p-4 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex w-full items-start justify-between gap-3 rounded-md border bg-panel/95 px-3 py-2.5 text-sm shadow-lg backdrop-blur-sm animate-[toast-in_180ms_ease-out] ${
            t.tone === 'success'
              ? 'border-neon/50 text-neon'
              : t.tone === 'error'
                ? 'border-danger/50 text-danger'
                : 'border-border-active text-dim'
          }`}
        >
          <span className="min-w-0 flex-1 break-words">{t.message}</span>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted hover:text-dim"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
