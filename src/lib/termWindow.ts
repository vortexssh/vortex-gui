import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

export async function openTermWindow(
  hostId: string,
  hostName: string,
  fresh = false,
): Promise<void> {
  const base = `term-${hostId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const label = fresh ? `${base}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}` : base
  if (!fresh) {
    const existing = await WebviewWindow.getByLabel(label)
    if (existing) {
      await existing.close()
      await new Promise((r) => window.setTimeout(r, 80))
    }
  }
  const q = new URLSearchParams({ hostId, name: hostName })
  const origin = window.location.href.split('#')[0]
  const url = `${origin}#/term?${q.toString()}`
  await new Promise<void>((resolve, reject) => {
    const w = new WebviewWindow(label, {
      url,
      title: `ssh · ${hostName}`,
      width: 980,
      height: 620,
      minWidth: 640,
      minHeight: 400,
      backgroundColor: '#0a0a0a',
      focus: true,
    })
    void w.once('tauri://created', () => resolve())
    void w.once('tauri://error', (ev) => {
      const msg =
        typeof ev.payload === 'string' ? ev.payload : 'Failed to open terminal window'
      reject(new Error(msg))
    })
  })
}
