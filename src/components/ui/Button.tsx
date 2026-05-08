import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

/*
  IBM Carbon button variants.
  - primary:   Blue 60 fill, white text. Main action.
  - secondary: Gray 10 fill, dark text. Muted action (pre-existing semantic).
  - tertiary:  Blue 60 outlined. Alternate action.
  - ghost:     Blue text only. "Cancel" / passive action.
  - danger:    Red fill, white text.
*/
const variantClass: Record<Variant, string> = {
  primary:   'bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50',
  secondary: 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200 disabled:opacity-50',
  tertiary:  'border border-primary-600 text-primary-600 hover:bg-primary-50 disabled:opacity-50',
  ghost:     'text-primary-600 hover:bg-primary-50',
  danger:    'bg-red-600 text-white hover:bg-red-700',
}

const sizeClass: Record<Size, string> = {
  sm: 'px-3 h-7 text-xs rounded-md',
  md: 'px-4 h-9 text-sm rounded-md',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
