import { forwardRef, type InputHTMLAttributes } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, className = '', ...rest },
  ref,
) {
  return (
    <div className="w-full">
      {label && (
        <label className="mb-1 block text-xs text-[var(--color-text-dim)]">{label}</label>
      )}
      <input
        ref={ref}
        {...rest}
        className={`w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] ${className}`}
      />
    </div>
  )
})
