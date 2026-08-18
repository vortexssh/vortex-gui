interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  id?: string
}

export function Toggle({ checked, onChange, label, disabled, id }: ToggleProps) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full border transition-colors ${
          checked ? 'border-neon/50 bg-neon/30' : 'border-border bg-void'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full transition-transform ${
            checked ? 'translate-x-4 bg-neon shadow-[0_0_6px_rgb(57_255_20_/_0.25)]' : 'bg-muted'
          }`}
        />
      </button>
      {label ? <span className="text-sm text-dim">{label}</span> : null}
    </label>
  )
}
