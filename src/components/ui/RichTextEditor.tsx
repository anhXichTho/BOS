import { useEffect, useRef, useState } from 'react'
import {
  Bold, Heading1, Heading2, List, Palette, Highlighter, Image as ImageIcon, Type, X,
} from 'lucide-react'
import { uploadAttachment, extractClipboardImages } from '../../lib/uploadAttachment'
import { useToast } from './Toast'

interface Props {
  /** Current value — can be plain text or HTML. */
  value: string
  /** Called whenever the editor content changes. */
  onChange: (value: string) => void
  /** Placeholder shown when empty (rich mode renders as overlay). */
  placeholder?: string
  /** Storage prefix for paste-image uploads (e.g. 'chat', 'forms/<fieldId>'). */
  uploadPrefix?: string
  /** Submit hotkey: in plain mode = Enter (Shift+Enter for newline). Optional. */
  onSubmit?: () => void
  /** Min height in px for the input area. */
  minHeight?: number
  /** True to render compact toolbar (chat-style). False = full toolbar. */
  compact?: boolean
  /** Disable the rich-mode toggle entirely (always plain). */
  forcePlain?: boolean
  /** Initial mode (default 'plain'). */
  initialMode?: 'plain' | 'rich'
  /** Hide the in-editor mode toggle (caller controls mode externally). */
  hideToggle?: boolean
  /** Clear the editor — bumps when this number changes. */
  resetSignal?: number
  className?: string
  autoFocus?: boolean
}

const COLOR_PALETTE: { hex: string; name: string }[] = [
  { hex: '#3B3B3B', name: 'Đen ấm' },          // text-primary
  { hex: '#4A6AAB', name: 'Xanh chính' },       // primary
  { hex: '#C9534B', name: 'Đỏ cảnh báo' },      // danger
]
const HIGHLIGHT_PALETTE: { hex: string; name: string }[] = [
  { hex: 'transparent', name: 'Bỏ highlight' },
  { hex: '#FEF3C7', name: 'Vàng nhạt' },
  { hex: '#DBEAFE', name: 'Xanh nhạt' },
  { hex: '#FECACA', name: 'Đỏ nhạt' },
]

export default function RichTextEditor({
  value, onChange, placeholder, uploadPrefix = 'chat', onSubmit,
  minHeight = 80, compact = false, forcePlain = false,
  initialMode = 'plain', hideToggle = false, resetSignal,
  className = '', autoFocus,
}: Props) {
  const [isRich, setIsRich] = useState(initialMode === 'rich' && !forcePlain)
  /** Single-source-of-truth for which popover is open — prevents both opening at once. */
  const [openPopover, setOpenPopover] = useState<'color' | 'highlight' | null>(null)
  const [uploading, setUploading] = useState(false)
  const editorRef    = useRef<HTMLDivElement>(null)
  const textRef      = useRef<HTMLTextAreaElement>(null)
  const fileRef      = useRef<HTMLInputElement>(null)
  const toolbarRef   = useRef<HTMLDivElement>(null)
  const { error: toastError } = useToast()

  // Reset content when resetSignal bumps
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = ''
    if (textRef.current)   textRef.current.value = ''
  }, [resetSignal])

  // Sync external value into editor on mode switch / mount
  useEffect(() => {
    if (isRich && editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value
    }
  }, [isRich])

  // Close popovers when clicking outside the toolbar
  useEffect(() => {
    if (!openPopover) return
    const onDocClick = (e: MouseEvent) => {
      if (!toolbarRef.current?.contains(e.target as Node)) setOpenPopover(null)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [openPopover])

  function exec(cmd: string, arg?: string) {
    document.execCommand(cmd, false, arg)
    editorRef.current?.focus()
    handleInput()
  }

  function setBlock(tag: 'h1' | 'h2' | 'p') {
    document.execCommand('formatBlock', false, tag)
    editorRef.current?.focus()
    handleInput()
  }

  function handleInput() {
    if (editorRef.current) onChange(editorRef.current.innerHTML)
  }

  async function uploadAndInsert(file: File) {
    setUploading(true)
    try {
      const url = await uploadAttachment(file, uploadPrefix)
      // Insert image at caret. execCommand('insertImage') still works in all major browsers.
      document.execCommand('insertImage', false, url)
      handleInput()
    } catch (err: any) {
      toastError(err?.message ?? 'Không thể upload')
    } finally {
      setUploading(false)
    }
  }

  async function handlePasteRich(e: React.ClipboardEvent<HTMLDivElement>) {
    const imgs = extractClipboardImages(e.nativeEvent as ClipboardEvent)
    if (imgs.length > 0) {
      e.preventDefault()
      for (const img of imgs) await uploadAndInsert(img)
      return
    }
    // For text paste, strip styles (insert as plain text). Users can re-format.
    const text = e.clipboardData.getData('text/plain')
    if (text) {
      e.preventDefault()
      document.execCommand('insertText', false, text)
      handleInput()
    }
  }

  function handleKeyRich(e: React.KeyboardEvent<HTMLDivElement>) {
    if (onSubmit && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onSubmit()
    }
  }

  function handleKeyPlain(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (onSubmit && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  function attachFiles(files: FileList | null) {
    if (!files) return
    Array.from(files).forEach(uploadAndInsert)
  }

  // Plain-mode rendering
  if (!isRich) {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <textarea
          ref={textRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyPlain}
          placeholder={placeholder}
          autoFocus={autoFocus}
          style={{ minHeight }}
          className="w-full border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm font-serif bg-white resize-y"
        />
        {!forcePlain && !hideToggle && (
          <button
            type="button"
            onClick={() => setIsRich(true)}
            className="self-start inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-primary-600"
            title="Chuyển sang rich text (định dạng đầy đủ)"
          >
            <Type size={11} /> Rich text
          </button>
        )}
      </div>
    )
  }

  // Rich-mode rendering
  return (
    <div className={`border border-neutral-200 focus-within:border-primary-400 rounded-lg bg-white overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div ref={toolbarRef} className="flex items-center flex-wrap gap-0.5 border-b border-neutral-100 px-1.5 py-1 bg-neutral-25">
        <ToolbarButton title="Đậm (Ctrl+B)" onClick={() => exec('bold')}><Bold size={13} /></ToolbarButton>
        {!compact && (
          <>
            <ToolbarButton title="Tiêu đề H1" onClick={() => setBlock('h1')}><Heading1 size={13} /></ToolbarButton>
            <ToolbarButton title="Tiêu đề H2" onClick={() => setBlock('h2')}><Heading2 size={13} /></ToolbarButton>
          </>
        )}
        <ToolbarButton title="Bullet list" onClick={() => exec('insertUnorderedList')}><List size={13} /></ToolbarButton>

        {/* Color (3 swatches) */}
        <div className="relative">
          <ToolbarButton
            title="Màu chữ"
            onClick={() => setOpenPopover(p => p === 'color' ? null : 'color')}
          >
            <Palette size={13} />
          </ToolbarButton>
          {openPopover === 'color' && (
            <div className="absolute z-20 top-full mt-1 left-0 bg-white border border-neutral-200 rounded-lg shadow-md p-2 flex gap-1.5">
              {COLOR_PALETTE.map(c => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => { exec('foreColor', c.hex); setOpenPopover(null) }}
                  className="w-6 h-6 rounded-md border border-neutral-200 hover:scale-110 transition-transform"
                  style={{ background: c.hex }}
                  title={c.name}
                  aria-label={c.name}
                />
              ))}
            </div>
          )}
        </div>

        {/* Highlight (4 swatches incl. clear) */}
        <div className="relative">
          <ToolbarButton
            title="Highlight"
            onClick={() => setOpenPopover(p => p === 'highlight' ? null : 'highlight')}
          >
            <Highlighter size={13} />
          </ToolbarButton>
          {openPopover === 'highlight' && (
            <div className="absolute z-20 top-full mt-1 left-0 bg-white border border-neutral-200 rounded-lg shadow-md p-2 flex gap-1.5">
              {HIGHLIGHT_PALETTE.map(c => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => { exec('backColor', c.hex); setOpenPopover(null) }}
                  className={`w-6 h-6 rounded-md border border-neutral-200 hover:scale-110 transition-transform ${
                    c.hex === 'transparent'
                      ? 'bg-[linear-gradient(45deg,#fff_45%,#C9534B_45%,#C9534B_55%,#fff_55%)]'
                      : ''
                  }`}
                  style={c.hex === 'transparent' ? undefined : { background: c.hex }}
                  title={c.name}
                  aria-label={c.name}
                />
              ))}
            </div>
          )}
        </div>

        {/* Image */}
        <ToolbarButton
          title="Đính kèm ảnh"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <ImageIcon size={13} />
        </ToolbarButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { attachFiles(e.target.files); e.target.value = '' }}
        />

        <div className="flex-1" />

        {!forcePlain && !hideToggle && (
          <button
            type="button"
            onClick={() => setIsRich(false)}
            title="Chuyển về plain text"
            className="inline-flex items-center gap-1 text-[10px] text-neutral-400 hover:text-neutral-700 px-1.5"
          >
            <X size={10} /> Plain
          </button>
        )}
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onPaste={handlePasteRich}
        onKeyDown={handleKeyRich}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        style={{ minHeight: minHeight + 24 }}
        className="rich-editor px-3 py-2 text-sm font-serif focus:outline-none break-words"
      />
      {uploading && (
        <div className="text-[11px] text-neutral-400 px-3 pb-1">Đang upload ảnh…</div>
      )}
    </div>
  )
}

function ToolbarButton({
  children, onClick, title, disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}  // keep editor selection
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="text-neutral-500 hover:text-primary-600 hover:bg-neutral-100 disabled:opacity-40 rounded-md p-1 transition-colors"
    >
      {children}
    </button>
  )
}
