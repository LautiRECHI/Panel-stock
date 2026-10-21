import { type ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-foreground text-white border border-transparent hover:bg-foreground/90',
  secondary: 'bg-white text-foreground border border-[#D5D3CB] hover:bg-surface',
  ghost: 'bg-transparent text-foreground border border-transparent hover:bg-black/5',
  danger: 'bg-stock-none text-white border border-transparent hover:bg-stock-none/90',
}

export default function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 h-11 px-4 rounded-input text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${variantClass[variant]} ${className}`}
      {...props}
    >
      {loading && (
        <span
          className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  )
}
