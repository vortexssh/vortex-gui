import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, className = '', id, ...rest }: InputProps) {
  const inputId = id ?? rest.name
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      {label ? <span className="text-xs uppercase tracking-wider text-muted">{label}</span> : null}
      <input
        id={inputId}
        className={`rounded-md border border-border bg-void px-3 py-2 font-mono text-sm text-fg-strong outline-none transition-colors placeholder:text-muted focus:border-neon/50 focus:neon-ring ${error ? 'border-danger/50' : ''} ${className}`}
        {...rest}
      />
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  )
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export function TextArea({ label, className = '', ...rest }: TextAreaProps) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      {label ? <span className="text-xs uppercase tracking-wider text-muted">{label}</span> : null}
      <textarea
        className={`min-h-24 rounded-md border border-border bg-void px-3 py-2 font-mono text-sm text-fg-strong outline-none placeholder:text-muted focus:border-neon/50 focus:neon-ring ${className}`}
        {...rest}
      />
    </label>
  )
}
