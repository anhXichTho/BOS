import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Footer content. Rendered right-aligned by default (Carbon: primary action on the right). */
  footer?: ReactNode
  /** Optional left-aligned footer content (Carbon: ghost/secondary actions on the left). */
  footerLeft?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
}

// Carbon spec sizes: sm=320, md=480, lg=640. xl/2xl/full added for callers
// that need a wider workspace (AI assistant modal etc.).
const sizeClass: Record<NonNullable<ModalProps['size']>, string> = {
  sm:   'sm:max-w-[320px]',
  md:   'sm:max-w-[480px]',
  lg:   'sm:max-w-[640px]',
  xl:   'sm:max-w-[800px]',
  '2xl':'sm:max-w-[1100px]',
  full: 'sm:max-w-[95vw]',
}

export default function Modal({ open, onClose, title, children, footer, footerLeft, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const hasFooter = !!footer || !!footerLeft

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`bg-white border border-neutral-100 rounded-xl shadow-lg w-full flex flex-col ${sizeClass[size]} max-h-[90vh]`}>
        {/* Header — 48px, Carbon Heading 01 */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 h-12 shrink-0">
          <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-neutral-600 hover:text-neutral-900 transition-colors p-1 -m-1 hover:bg-neutral-50"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {/* Footer — ghost left, primary right (Carbon spec) */}
        {hasFooter && (
          <div className="border-t border-neutral-100 px-5 py-3 flex justify-between items-center gap-2 shrink-0">
            <div className="flex items-center gap-2">{footerLeft}</div>
            <div className="flex items-center gap-2">{footer}</div>
          </div>
        )}
      </div>
    </div>
  )
}
