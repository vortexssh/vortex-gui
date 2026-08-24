import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
}

interface OptionItem {
  value: string
  label: string
  disabled: boolean
}

function flattenLabel(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenLabel).join('')
  if (isValidElement(node)) {
    return flattenLabel((node.props as { children?: ReactNode }).children)
  }
  return ''
}

function collectOptions(children: ReactNode): OptionItem[] {
  const out: OptionItem[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type !== 'option') {
      const nested = (child.props as { children?: ReactNode }).children
      if (nested !== undefined) out.push(...collectOptions(nested))
      return
    }
    const props = child.props as {
      value?: string | number
      children?: ReactNode
      disabled?: boolean
    }
    out.push({
      value: String(props.value ?? ''),
      label: flattenLabel(props.children),
      disabled: Boolean(props.disabled),
    })
  })
  return out
}

/**
 * Custom listbox so GTK/WebKit native <select> popups stay dark (they ignore CSS).
 */
export function Select({
  label,
  className = '',
  children,
  id,
  value,
  disabled,
  onChange,
  name,
}: SelectProps) {
  const autoId = useId()
  const selectId = id ?? name ?? autoId
  const options = useMemo(() => collectOptions(children), [children])
  const current = String(value ?? '')
  const selected = options.find((o) => o.value === current) ?? options[0]
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  function emit(next: string) {
    if (!onChange) return
    onChange({
      target: { value: next, name: name ?? '' },
      currentTarget: { value: next, name: name ?? '' },
    } as ChangeEvent<HTMLSelectElement>)
  }

  useEffect(() => {
    if (!open) return
    const place = () => {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    place()
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const trigger = (
    <button
      ref={triggerRef}
      id={selectId}
      type="button"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
      className={`flex w-full items-center justify-between gap-2 rounded-md border border-border bg-void px-3 py-2 text-left font-mono text-sm text-fg-strong outline-none transition-colors hover:border-border-active focus:border-neon/50 focus:neon-ring disabled:opacity-40 ${className}`}
    >
      <span className="min-w-0 truncate">{selected?.label || '—'}</span>
      <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted ${open ? 'rotate-180' : ''}`} />
    </button>
  )

  const menu =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 160) }}
            className="fixed z-[300] max-h-60 overflow-auto rounded-md border border-border bg-surface py-1 shadow-[0_8px_32px_rgb(0_0_0_/_0.65)]"
          >
            {options.map((opt) => {
              const on = opt.value === current
              return (
                <button
                  key={opt.value || '__empty'}
                  type="button"
                  role="option"
                  aria-selected={on}
                  disabled={opt.disabled}
                  className={`flex w-full px-3 py-1.5 text-left font-mono text-sm ${
                    on ? 'bg-neon/10 text-neon' : 'text-fg hover:bg-panel hover:text-fg-strong'
                  } disabled:opacity-40`}
                  onClick={() => {
                    if (!opt.disabled) emit(opt.value)
                    setOpen(false)
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>,
          document.body,
        )
      : null

  const field = (
    <>
      {trigger}
      {menu}
    </>
  )

  if (!label) return field
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
      {field}
    </label>
  )
}
