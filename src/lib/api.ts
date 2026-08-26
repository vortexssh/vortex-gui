import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type HostSource = 'local' | 'cloud'
export type AuthType = 'password' | 'private_key'

export interface Host {
  id: string
  name: string
  address: string
  port: number
  user: string
  tags: string[]
  source: HostSource
  proxyEnabled: boolean
  agentOnline: boolean
  agentId: string
  hasSecret: boolean
  authType: AuthType | null
  sortOrder: number
  createdAt: string
  updatedAt: string
  lastSyncedAt: string | null
  billing: HostBilling
}

export interface HostBilling {
  enabled: boolean
  cycle: string | null
  customDays: number | null
  renewalAt: string | null
  amount: string | null
  currency: string | null
  autoRenew: boolean
  notes: string | null
  payerId: string | null
  payerName: string | null
}

export type TerminalLayout = 'tabs' | 'split' | 'window' | 'provided'

/** OS terminal used when layout is `provided` (or External button). */
export type SystemTerminal =
  | 'kitty'
  | 'wezterm'
  | 'alacritty'
  | 'ghostty'
  | 'konsole'
  | 'gnome-terminal'
  | 'custom'

export interface SettingsPublic {
  coreUrl: string
  webUrl: string
  accountEmail: string
  lastSyncAt: string | null
  syncOnStart: boolean
  terminalLayout: TerminalLayout
  systemTerminal: SystemTerminal
  /** Resolved launcher (preset or custom). */
  sshCommand: string
  linked: boolean
}

export interface UserMe {
  id: string
  email: string
  is2faEnabled: boolean
  require2fa: boolean
}

export interface Telemetry {
  hostId: string
  cpuPercent: number | null
  ramPercent: number | null
  ramUsedBytes: number | null
  ramTotalBytes: number | null
  netBytesSent: number | null
  netBytesRecv: number | null
  uptimeSeconds: number | null
  collectedAt: string
}

/** Chart-friendly point derived from polled snapshots (same shape as Vortex Web). */
export interface TelemetryPoint {
  timestamp: string
  cpu_percent: number
  ram_percent: number
  net_rx_mbps: number
  net_tx_mbps: number
  uptime_seconds: number
}

export interface BillingPayer {
  id: string
  name: string
  notes: string | null
  host_count: number
  created_at: string
  updated_at: string
}

export interface BillingPayerHostBrief {
  id: string
  name: string
  billing_enabled: boolean
  billing_amount: string | null
  billing_currency: string | null
  billing_renewal_at: string | null
  billing_cycle: string | null
  billing_auto_renew: boolean
  country_code: string | null
}

export interface BillingPayerDetail extends BillingPayer {
  hosts: BillingPayerHostBrief[]
}

export interface BillingHostBrief {
  id: string
  name: string
  billing_amount: string | number | null
  billing_currency: string | null
  amount_converted: string | number | null
  country_code: string | null
  is_next: boolean
  cycle: string | null
  payer_id: string | null
  payer_name: string | null
}

export interface BillingCalendarResponse {
  year: number
  month: number
  currency: string
  days: { date: string; hosts: BillingHostBrief[] }[]
  payer_id: string | null
  payer_name: string | null
}

export interface BillingSummaryResponse {
  currency: string
  from_date: string
  to_date: string
  total: string
  items: {
    host_id: string
    host_name: string
    amount: string
    currency: string
    amount_converted: string | number | null
    renewal_at: string | null
    cycle: string | null
  }[]
  skipped: string[]
  payer_id: string | null
  payer_name: string | null
}

export interface SyncResult {
  upserted: number
  removed: number
}

export interface ConnectResult {
  sessionId: string
  mode: 'direct' | 'proxy' | string
}

export interface SaveHostInput {
  id?: string
  name: string
  address: string
  port: number
  user: string
  tags: string[]
  proxyEnabled: boolean
  publishCloud: boolean
  secret?: { authType: AuthType; payload: string }
  billing?: HostBilling
}

export interface CommandError {
  code: string
  message: string
  web2faUrl?: string
}

export function parseCommandError(err: unknown): CommandError {
  if (typeof err === 'object' && err !== null) {
    const o = err as Record<string, unknown>
    if (typeof o.message === 'string') {
      return {
        code: typeof o.code === 'string' ? o.code : 'error',
        message: o.message,
        web2faUrl: typeof o.web2faUrl === 'string' ? o.web2faUrl : undefined,
      }
    }
  }
  if (typeof err === 'string') {
    try {
      const o = JSON.parse(err) as CommandError
      if (o && typeof o.message === 'string') return o
    } catch {
      /* plain string */
    }
    return { code: 'error', message: err }
  }
  return { code: 'error', message: 'unknown error' }
}

export function is2faError(err: CommandError): boolean {
  return (
    err.code === '2fa_required' ||
    err.code === 'totp_required' ||
    /2fa|totp|two-factor/i.test(err.message)
  )
}

export function userSatisfies2faPolicy(user: UserMe | null): boolean {
  if (!user) return false
  if (user.require2fa === false) return true
  return user.is2faEnabled
}

export type DiscoveredUrls = {
  coreUrl: string
  webUrl: string
  infoUrl: string
  mirror: string
  latencyMs: number
}

export const api = {
  listHosts: () => invoke<Host[]>('list_hosts'),
  getSettings: () => invoke<SettingsPublic>('get_settings'),
  saveSettings: (input: {
    coreUrl: string
    webUrl: string
    syncOnStart: boolean
    terminalLayout: TerminalLayout
    systemTerminal: SystemTerminal
    sshCommand: string
  }) =>
    invoke<SettingsPublic>('save_settings', {
      coreUrl: input.coreUrl,
      webUrl: input.webUrl,
      syncOnStart: input.syncOnStart,
      terminalLayout: input.terminalLayout,
      systemTerminal: input.systemTerminal,
      sshCommand: input.sshCommand,
    }),
  resetCloudUrls: () => invoke<DiscoveredUrls>('reset_cloud_urls'),
  openSystemSsh: (hostId: string) => invoke<void>('open_system_ssh', { hostId }),
  health: () => invoke<boolean>('health'),
  getMe: () => invoke<UserMe>('get_me'),
  browserLogin: () => invoke<SettingsPublic>('browser_login'),
  logout: () => invoke<SettingsPublic>('logout'),
  syncCloud: () => invoke<SyncResult>('sync_cloud'),
  saveHost: (input: SaveHostInput) => invoke<Host>('save_host', { input }),
  deleteHost: (id: string, fromCloud: boolean) =>
    invoke<void>('delete_host', { id, fromCloud }),
  moveHost: (id: string, delta: number) => invoke<Host[]>('move_host', { id, delta }),
  getTelemetry: (hostId: string) => invoke<Telemetry>('get_telemetry', { hostId }),
  getTelemetryHistory: (hostId: string) =>
    invoke<Telemetry[]>('get_telemetry_history', { hostId }),
  billingCalendar: (year: number, month: number, payerId?: string) =>
    invoke<BillingCalendarResponse>('billing_calendar', {
      year,
      month,
      payerId: payerId || null,
    }),
  billingSummary: (from: string, to: string, payerId?: string) =>
    invoke<BillingSummaryResponse>('billing_summary', {
      from,
      to,
      payerId: payerId || null,
    }),
  billingPayers: () => invoke<BillingPayer[]>('billing_payers'),
  billingPayer: (id: string) => invoke<BillingPayerDetail>('billing_payer', { id }),
  billingCreatePayer: (name: string, notes?: string | null) =>
    invoke<BillingPayer>('billing_create_payer', { name, notes: notes ?? null }),
  billingUpdatePayer: (id: string, name?: string, notes?: string | null) =>
    invoke<BillingPayer>('billing_update_payer', { id, name: name ?? null, notes: notes ?? null }),
  billingDeletePayer: (id: string) => invoke<void>('billing_delete_payer', { id }),
  billingAdvance: (hostId: string) => invoke<void>('billing_advance', { hostId }),
  connectHost: (hostId: string, cols: number, rows: number) =>
    invoke<ConnectResult>('connect_host', { hostId, cols, rows }),
  sshWrite: (sessionId: string, data: string) =>
    invoke<void>('ssh_write', { sessionId, data }),
  sshResize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>('ssh_resize', { sessionId, cols, rows }),
  sshClose: (sessionId: string) => invoke<void>('ssh_close', { sessionId }),
  sftpConnect: (hostId: string) => invoke<SftpConnectResult>('sftp_connect', { hostId }),
  sftpClose: (hostId: string) => invoke<void>('sftp_close', { hostId }),
  sftpCancel: (transferId: string) => invoke<void>('sftp_cancel', { transferId }),
  sftpList: (hostId: string, path: string) =>
    invoke<FsListing>('sftp_list', { hostId, path }),
  sftpMkdir: (hostId: string, path: string) => invoke<void>('sftp_mkdir', { hostId, path }),
  sftpRename: (hostId: string, from: string, to: string) =>
    invoke<void>('sftp_rename', { hostId, from, to }),
  sftpRemove: (hostId: string, path: string, isDir: boolean) =>
    invoke<void>('sftp_remove', { hostId, path, isDir }),
  sftpTransfer: (input: {
    hostId: string
    direction: 'put' | 'get'
    localPath: string
    remotePath: string
    transferId: string
  }) =>
    invoke<void>('sftp_transfer', {
      hostId: input.hostId,
      direction: input.direction,
      localPath: input.localPath,
      remotePath: input.remotePath,
      transferId: input.transferId,
    }),
  fsHome: () => invoke<string>('fs_home'),
  fsList: (path: string) => invoke<FsListing>('fs_list', { path }),
  fsMkdir: (path: string) => invoke<void>('fs_mkdir', { path }),
  fsRename: (from: string, to: string) => invoke<void>('fs_rename', { from, to }),
  fsRemove: (path: string) => invoke<void>('fs_remove', { path }),
  fsCopy: (from: string, to: string) => invoke<void>('fs_copy', { from, to }),
  exportVortex: (path: string, password: string) =>
    invoke<void>('export_vortex', { path, password }),
  importVortex: (path: string, password: string, overwrite: boolean) =>
    invoke<number>('import_vortex', { path, password, overwrite }),
  openWebPath: (path: string) => invoke<void>('open_web_path', { path }),
}

export interface SshDataEvent {
  sessionId: string
  data: string
}

export interface SshExitEvent {
  sessionId: string
  message: string
}

export function listenSshData(handler: (ev: SshDataEvent) => void): Promise<UnlistenFn> {
  return listen<SshDataEvent>('ssh-data', (e) => handler(e.payload))
}

export function listenSshExit(handler: (ev: SshExitEvent) => void): Promise<UnlistenFn> {
  return listen<SshExitEvent>('ssh-exit', (e) => handler(e.payload))
}

export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  mtime: number | null
  mode: number | null
}

export interface FsListing {
  path: string
  entries: FsEntry[]
}

export interface SftpConnectResult {
  cwd: string
  mode: string
}

export interface SftpProgressEvent {
  transferId: string
  done: number
  total: number
  name: string
  finished: boolean
  error: string | null
}

export function listenSftpProgress(handler: (ev: SftpProgressEvent) => void): Promise<UnlistenFn> {
  return listen<SftpProgressEvent>('sftp-progress', (e) => handler(e.payload))
}

export function toastError(err: unknown, fallback = 'request failed'): CommandError {
  const e = parseCommandError(err)
  return e.message ? e : { ...e, message: fallback }
}

export function encodeBytes(data: Uint8Array): string {
  let s = ''
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]!)
  return btoa(s)
}

export function decodeB64(data: string): Uint8Array {
  const bin = atob(data)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
