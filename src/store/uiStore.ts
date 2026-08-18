import { create } from 'zustand'

export type ToastTone = 'info' | 'success' | 'error'

interface ToastItem {
  id: string
  message: string
  tone: ToastTone
}

interface UiState {
  view: 'hosts' | 'billing'
  selectedHostId: string | null
  sessionHostId: string | null
  settingsOpen: boolean
  toasts: ToastItem[]
  setView: (view: 'hosts' | 'billing') => void
  selectHost: (id: string | null) => void
  setSession: (hostId: string | null, sessionId?: string | null) => void
  setSettingsOpen: (open: boolean) => void
  pushToast: (message: string, tone?: ToastTone) => void
  dismissToast: (id: string) => void
}

const timers = new Map<string, number>()

export const useUiStore = create<UiState>((set, get) => ({
  view: 'hosts',
  selectedHostId: null,
  sessionHostId: null,
  settingsOpen: false,
  toasts: [],
  setView: (view) => set({ view }),
  selectHost: (id) => set({ selectedHostId: id }),
  setSession: (hostId) => set({ sessionHostId: hostId }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  pushToast: (message, tone = 'info') => {
    const trimmed = message.trim()
    if (!trimmed) return
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts, { id, message: trimmed, tone }].slice(-5) }))
    const tid = window.setTimeout(() => get().dismissToast(id), 4500)
    timers.set(id, tid)
  },
  dismissToast: (id) => {
    const tid = timers.get(id)
    if (tid) {
      window.clearTimeout(tid)
      timers.delete(id)
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

export function toast(message: string, tone?: ToastTone): void {
  useUiStore.getState().pushToast(message, tone)
}
