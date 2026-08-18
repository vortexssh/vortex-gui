import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function Modal({ open, title, onClose, children, footer, wide }: ModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Close modal backdrop"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 w-full rounded-lg border border-border bg-surface shadow-[0_0_6px_rgb(57_255_20_/_0.25)] ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-mono text-sm uppercase tracking-wider text-neon">{title}</h2>
          <Button variant="ghost" className="!px-2" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-auto p-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  )
}
