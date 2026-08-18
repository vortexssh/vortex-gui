import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'ghost' | 'danger' | 'outline'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  children: ReactNode
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'border-neon/40 bg-neon/10 text-neon hover:shadow-[0_0_6px_rgb(57_255_20_/_0.25)] disabled:opacity-40',
  ghost: 'border-transparent text-dim hover:border-border-active hover:bg-panel hover:text-neon/80',
  danger: 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-40',
  outline: 'border-border text-dim hover:border-neon/40 hover:text-neon disabled:opacity-40',
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
