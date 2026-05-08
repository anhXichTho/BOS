/**
 * Top section of the left panel: workflow template name + description.
 *
 * Round-4d cognitive-load pass — hover-to-edit pattern (matches StepDetailPanel):
 *  • Title: read-only display by default; faded pencil brightens on hover →
 *    click to inline-edit. Enter / blur commits, Esc cancels.
 *  • Description: read-only display by default with the same pencil; click
 *    to inline-edit (textarea). Same commit/cancel keys.
 *
 * Eliminates the always-visible textboxes that visually competed with
 * the flow canvas + detail panel.
 */
import { memo, useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'

interface Props {
  name: string
  description: string
  onNameChange: (next: string) => void
  onDescriptionChange: (next: string) => void
}

export default memo(function WorkflowMetaPanel({
  name, description, onNameChange, onDescriptionChange,
}: Props) {
  const [editingName, setEditingName] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)

  return (
    <div className="p-3 border-b border-neutral-100 space-y-3 bg-white">
      {/* ── Name ── */}
      <section className="group">
        {!editingName ? (
          <div className="flex items-baseline gap-1.5">
            <h3
              className="text-sm font-serif font-semibold text-neutral-800 leading-snug truncate flex-1 cursor-text"
              onClick={() => setEditingName(true)}
              title="Bấm để chỉnh sửa tên"
            >
              {name || <span className="italic text-neutral-400">(chưa đặt tên)</span>}
            </h3>
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="text-neutral-400 opacity-30 group-hover:opacity-100 hover:text-primary-600 transition-opacity p-0.5 shrink-0"
              title="Chỉnh sửa tên"
              aria-label="Chỉnh sửa tên"
            >
              <Pencil size={12} />
            </button>
          </div>
        ) : (
          <CommitInput
            initial={name}
            placeholder="Tên nghiệp vụ *"
            onCommit={v => { onNameChange(v); setEditingName(false) }}
            onCancel={() => setEditingName(false)}
            className="border border-primary-400 focus:outline-none rounded-lg px-2 py-1.5 text-sm font-serif font-semibold bg-white w-full"
          />
        )}
      </section>

      {/* ── Description ── */}
      <section className="group">
        {!editingDesc ? (
          <div className="flex items-start gap-1.5">
            <p
              className="text-xs text-neutral-600 leading-relaxed flex-1 cursor-text whitespace-pre-wrap"
              onClick={() => setEditingDesc(true)}
              title="Bấm để chỉnh sửa mô tả"
            >
              {description || <span className="italic text-neutral-400">Mô tả ngắn (tuỳ chọn)…</span>}
            </p>
            <button
              type="button"
              onClick={() => setEditingDesc(true)}
              className="text-neutral-400 opacity-30 group-hover:opacity-100 hover:text-primary-600 transition-opacity p-0.5 shrink-0 mt-0.5"
              title="Chỉnh sửa mô tả"
              aria-label="Chỉnh sửa mô tả"
            >
              <Pencil size={11} />
            </button>
          </div>
        ) : (
          <CommitInput
            initial={description}
            placeholder="Mô tả ngắn (tuỳ chọn)…"
            multiline
            rows={3}
            onCommit={v => { onDescriptionChange(v); setEditingDesc(false) }}
            onCancel={() => setEditingDesc(false)}
            className="border border-primary-400 focus:outline-none rounded-lg px-2 py-1.5 text-xs font-serif bg-white w-full resize-none"
          />
        )}
      </section>
    </div>
  )
})

/**
 * Inline-edit textbox that:
 *   • autofocuses on mount
 *   • commits on Enter (single-line) or blur
 *   • cancels on Escape
 *   • supports multi-line via `multiline` (Cmd/Ctrl+Enter commits)
 */
function CommitInput({
  initial, onCommit, onCancel, placeholder, className, multiline, rows,
}: {
  initial: string
  onCommit: (v: string) => void
  onCancel: () => void
  placeholder?: string
  className?: string
  multiline?: boolean
  rows?: number
}) {
  const inputRef  = useRef<HTMLInputElement | null>(null)
  const areaRef   = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = (inputRef.current ?? areaRef.current) as HTMLInputElement | HTMLTextAreaElement | null
    if (el) {
      el.focus()
      // Place caret at end
      const len = el.value.length
      try { el.setSelectionRange(len, len) } catch {}
    }
  }, [])

  if (multiline) {
    return (
      <textarea
        ref={areaRef}
        defaultValue={initial}
        placeholder={placeholder}
        rows={rows ?? 3}
        onBlur={e => onCommit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onCommit((e.target as HTMLTextAreaElement).value)
        }}
        className={className}
      />
    )
  }
  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={initial}
      placeholder={placeholder}
      onBlur={e => onCommit(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Escape') onCancel()
        if (e.key === 'Enter') onCommit((e.target as HTMLInputElement).value)
      }}
      className={className}
    />
  )
}
