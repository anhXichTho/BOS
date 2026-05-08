import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { X } from 'lucide-react'

interface ChipInputProps {
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  className?: string
}

/**
 * Chip-style multi-value input. Each value is a chip; type and press Enter
 * (or the "Thêm" button) to add. Allows characters that would otherwise
 * conflict with delimiter-based inputs (commas, tabs, …).
 */
export default function ChipInput({ values, onChange, placeholder, className = '' }: ChipInputProps) {
  const [draft, setDraft] = useState('')

  function commit() {
    const v = draft.trim()
    if (!v) return
    if (values.includes(v)) { setDraft(''); return }
    onChange([...values, v])
    setDraft('')
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  function removeAt(i: number) {
    onChange(values.filter((_, idx) => idx !== i))
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-1 border border-neutral-200 focus-within:border-primary-400 rounded-lg px-2 py-1.5 bg-white ${className}`}
    >
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="inline-flex items-center gap-1 bg-primary-50 text-primary-700 text-xs rounded-md px-2 py-0.5 max-w-full"
        >
          <span className="truncate">{v}</span>
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="text-primary-400 hover:text-primary-700 shrink-0"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={commit}
        placeholder={values.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] text-xs font-serif bg-transparent focus:outline-none px-1 py-0.5"
      />
    </div>
  )
}
