import { useEffect, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type AuthType, type Host, type HostBilling, type SaveHostInput } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'

const CYCLES = ['monthly', 'quarterly', 'semiannual', 'annual', 'custom'] as const

interface HostFormProps {
  open: boolean
  host: Host | null
  linked: boolean
  onClose: () => void
  onSave: (input: SaveHostInput) => Promise<void>
  saving: boolean
}

function emptyBilling(): HostBilling {
  return {
    enabled: false,
    cycle: 'monthly',
    customDays: 30,
    renewalAt: null,
    amount: null,
    currency: 'USD',
    autoRenew: true,
    notes: null,
    payerId: null,
    payerName: null,
  }
}

export function HostForm({ open, host, linked, onClose, onSave, saving }: HostFormProps) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [port, setPort] = useState('22')
  const [user, setUser] = useState('root')
  const [tags, setTags] = useState('')
  const [proxy, setProxy] = useState(false)
  const [publish, setPublish] = useState(false)
  const [authType, setAuthType] = useState<AuthType>('password')
  const [secret, setSecret] = useState('')
  const [billingEnabled, setBillingEnabled] = useState(false)
  const [billingCycle, setBillingCycle] = useState<string>('monthly')
  const [billingCustomDays, setBillingCustomDays] = useState('30')
  const [billingRenewalAt, setBillingRenewalAt] = useState('')
  const [billingAmount, setBillingAmount] = useState('')
  const [billingCurrency, setBillingCurrency] = useState('USD')
  const [billingAutoRenew, setBillingAutoRenew] = useState(true)
  const [billingNotes, setBillingNotes] = useState('')
  const [billingPayerId, setBillingPayerId] = useState('')

  const payersQ = useQuery({
    queryKey: ['billing', 'payers'],
    queryFn: api.billingPayers,
    enabled: open && linked,
  })

  useEffect(() => {
    if (!open) return
    const b = host?.billing ?? emptyBilling()
    if (host) {
      setName(host.name)
      setAddress(host.address)
      setPort(String(host.port || 22))
      setUser(host.user || 'root')
      setTags(host.tags.join(', '))
      setProxy(host.proxyEnabled)
      setPublish(host.source === 'cloud')
      setAuthType(host.authType ?? 'password')
      setSecret('')
    } else {
      setName('')
      setAddress('')
      setPort('22')
      setUser('root')
      setTags('')
      setProxy(false)
      setPublish(false)
      setAuthType('password')
      setSecret('')
    }
    setBillingEnabled(b.enabled)
    setBillingCycle(b.cycle || 'monthly')
    setBillingCustomDays(String(b.customDays ?? 30))
    setBillingRenewalAt(b.renewalAt ?? '')
    setBillingAmount(b.amount ?? '')
    setBillingCurrency(b.currency || 'USD')
    setBillingAutoRenew(b.autoRenew)
    setBillingNotes(b.notes ?? '')
    setBillingPayerId(b.payerId ?? '')
  }, [open, host])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const input: SaveHostInput = {
      id: host?.id,
      name,
      address,
      port: Number(port) || 22,
      user,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      proxyEnabled: proxy,
      publishCloud: publish,
    }
    if (secret.trim()) {
      input.secret = { authType, payload: secret }
    }
    if (publish && linked) {
      input.billing = billingEnabled
        ? {
            enabled: true,
            cycle: billingCycle,
            customDays: billingCycle === 'custom' ? Number(billingCustomDays) || 30 : null,
            renewalAt: billingRenewalAt || null,
            amount: billingAmount || null,
            currency: billingCurrency.toUpperCase(),
            autoRenew: billingAutoRenew,
            notes: billingNotes.trim() ? billingNotes.trim() : null,
            payerId: billingPayerId || null,
            payerName: null,
          }
        : { ...emptyBilling(), enabled: false, payerId: null }
    }
    await onSave(input)
  }

  return (
    <Modal
      open={open}
      title={host ? `Edit ${host.name}` : 'Add host'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} type="submit" form="host-form">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="host-form" className="grid grid-cols-2 gap-3" onSubmit={(e) => void submit(e)}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input
          label="Address"
          placeholder="IP / hostname (empty if NAT + proxy)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <Input label="Port" value={port} onChange={(e) => setPort(e.target.value)} />
        <Input label="User" value={user} onChange={(e) => setUser(e.target.value)} />
        <div className="col-span-2">
          <Input
            label="Tags"
            placeholder="prod, db"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>
        <Toggle checked={proxy} onChange={setProxy} label="Vortex Proxy (NAT)" />
        <Toggle
          checked={publish}
          onChange={setPublish}
          label="Publish metadata to Core"
          disabled={!linked}
        />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs uppercase tracking-wider text-muted">Auth</span>
          <select
            className="rounded-md border border-border bg-void px-3 py-2 font-mono text-sm text-fg-strong outline-none focus:border-neon/50"
            value={authType}
            onChange={(e) => setAuthType(e.target.value as AuthType)}
          >
            <option value="password">password</option>
            <option value="private_key">private_key (PEM)</option>
          </select>
        </label>
        <div className="col-span-2">
          <TextArea
            label={
              host?.hasSecret
                ? 'Replace secret (leave empty to keep existing — never sent to Core)'
                : 'Secret (optional, stored locally only)'
            }
            placeholder={authType === 'private_key' ? '-----BEGIN OPENSSH PRIVATE KEY-----' : 'password'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
          />
        </div>

        {linked && publish ? (
          <div className="col-span-2 mt-1 flex flex-col gap-3 border-t border-border pt-3">
            <Toggle
              checked={billingEnabled}
              onChange={setBillingEnabled}
              label="Track billing on Core"
            />
            {billingEnabled ? (
              <>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs uppercase tracking-wider text-muted">Payer</span>
                  <select
                    className="rounded-md border border-border bg-void px-3 py-2 font-mono text-sm text-fg-strong"
                    value={billingPayerId}
                    onChange={(e) => setBillingPayerId(e.target.value)}
                  >
                    <option value="">— none —</option>
                    {(payersQ.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs uppercase tracking-wider text-muted">Cycle</span>
                  <select
                    className="rounded-md border border-border bg-void px-3 py-2 font-mono text-sm text-fg-strong"
                    value={billingCycle}
                    onChange={(e) => setBillingCycle(e.target.value)}
                  >
                    {CYCLES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                {billingCycle === 'custom' ? (
                  <Input
                    label="Custom days"
                    type="number"
                    min={1}
                    value={billingCustomDays}
                    onChange={(e) => setBillingCustomDays(e.target.value)}
                    required
                  />
                ) : null}
                <Input
                  label="Next renewal"
                  type="date"
                  value={billingRenewalAt}
                  onChange={(e) => setBillingRenewalAt(e.target.value)}
                  required
                />
                <Input
                  label="Amount"
                  type="number"
                  step="0.01"
                  min={0}
                  value={billingAmount}
                  onChange={(e) => setBillingAmount(e.target.value)}
                  required
                />
                <Input
                  label="Currency"
                  value={billingCurrency}
                  onChange={(e) => setBillingCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  required
                />
                <div className="col-span-2">
                  <Toggle
                    checked={billingAutoRenew}
                    onChange={setBillingAutoRenew}
                    label="Auto-advance when overdue & agent online"
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    label="Billing notes"
                    value={billingNotes}
                    onChange={(e) => setBillingNotes(e.target.value)}
                    placeholder="provider, invoice ref…"
                  />
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        <p className="col-span-2 font-mono text-[11px] text-muted">
          SSH password / private key stay on this machine. Core receives metadata only (name, IP,
          port, username, tags, proxy, billing) — never secrets.
        </p>
      </form>
    </Modal>
  )
}
