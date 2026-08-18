import { create } from 'zustand'
import type { TerminalLayout } from '@/lib/api'

export type ToastTone = 'info' | 'success' | 'error'

interface ToastItem {
  id: string
  message: string
  tone: ToastTone
}

export interface TermTab {
  id: string
  hostId: string
  hostName: string
  gen: number
}

interface UiState {
  view: 'hosts' | 'billing' | 'settings'
  settingsSection: 'cloud' | 'terminal' | 'roster' | 'advanced'
  selectedHostId: string | null
  termTabs: TermTab[]
  activeTermId: string | null
  toasts: ToastItem[]
  setView: (view: UiState['view']) => void
  setSettingsSection: (section: UiState['settingsSection']) => void
  selectHost: (id: string | null) => void
  openTerm: (hostId: string, hostName: string, mode?: 'reconnect' | 'new') => void
  closeTerm: (tabId: string) => void
  focusTerm: (tabId: string) => void
  closeTermsForHost: (hostId: string) => void
  pushToast: (message: string, tone?: ToastTone) => void
  dismissToast: (id: string) => void
}

const timers = new Map<string, number>()

export const useUiStore = create<UiState>((set, get) => ({
  view: 'hosts',
  settingsSection: 'cloud',
  selectedHostId: null,
  termTabs: [],
  activeTermId: null,
  toasts: [],
  setView: (view) => set({ view }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  selectHost: (id) => set({ selectedHostId: id, activeTermId: null, view: 'hosts' }),
  openTerm: (hostId, hostName, mode = 'reconnect') => {
    const { termTabs, activeTermId } = get()
    if (mode !== 'new') {
      const existing =
        termTabs.find((t) => t.id === activeTermId && t.hostId === hostId) ??
        termTabs.find((t) => t.hostId === hostId)
      if (existing) {
        set({
          activeTermId: existing.id,
          termTabs: termTabs.map((t) =>
            t.id === existing.id ? { ...t, gen: t.gen + 1, hostName: t.hostName || hostName } : t,
          ),
        })
        return
      }
    }
    const id = crypto.randomUUID()
    set({
      termTabs: [...termTabs, { id, hostId, hostName, gen: 0 }],
      activeTermId: id,
    })
  },
  closeTerm: (tabId) => {
    const { termTabs, activeTermId } = get()
    const next = termTabs.filter((t) => t.id !== tabId)
    let active = activeTermId
    if (active === tabId) {
      const idx = termTabs.findIndex((t) => t.id === tabId)
      active = next[idx]?.id ?? next[idx - 1]?.id ?? null
    }
    set({ termTabs: next, activeTermId: active })
  },
  focusTerm: (tabId) => set({ activeTermId: tabId === '__details__' ? null : tabId }),
  closeTermsForHost: (hostId) => {
    const { termTabs, activeTermId } = get()
    const next = termTabs.filter((t) => t.hostId !== hostId)
    const active = next.some((t) => t.id === activeTermId)
      ? activeTermId
      : (next.at(-1)?.id ?? null)
    set({ termTabs: next, activeTermId: active })
  },
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

export function layoutOf(raw: string | undefined | null): TerminalLayout {
  if (raw === 'split' || raw === 'window' || raw === 'tabs') return raw
  return 'tabs'
}

export function termTabTitle(tab: TermTab, tabs: TermTab[]): string {
  const same = tabs.filter((t) => t.hostId === tab.hostId)
  if (same.length < 2) return tab.hostName
  return `${tab.hostName} · ${same.findIndex((t) => t.id === tab.id) + 1}`
}
