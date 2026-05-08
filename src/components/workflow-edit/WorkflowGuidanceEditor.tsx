/**
 * WorkflowGuidanceEditor — guidance / how-to / common-mistakes notes for a
 * workflow template. Saved in `workflow_templates.guidance_html`.
 *
 * Round-4d: defaults to PLAIN mode (cleaner — no toolbar). The user toggles
 * to rich mode via the built-in "T" button when formatting is needed (e.g.
 * bullet lists, links, images). If saved content already contains HTML
 * markup (from a prior session), it boots in rich mode automatically.
 *
 * Auto-saves on blur via the parent's onChange callback.
 */
import { memo } from 'react'
import { BookOpen } from 'lucide-react'
import RichTextEditor from '../ui/RichTextEditor'

interface Props {
  value: string
  onChange: (next: string) => void
  className?: string
}

/** Detect whether the saved value has any HTML markup → boot rich. */
function hasHtmlMarkup(s: string): boolean {
  if (!s) return false
  return /<\/?(p|div|br|strong|em|b|i|u|h1|h2|h3|ul|ol|li|a|img|blockquote|pre|code)\b/i.test(s)
}

export default memo(function WorkflowGuidanceEditor({ value, onChange, className = '' }: Props) {
  const initialMode: 'plain' | 'rich' = hasHtmlMarkup(value) ? 'rich' : 'plain'
  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-neutral-100 bg-neutral-25">
        <BookOpen size={12} className="text-neutral-500" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
          Hướng dẫn chi tiết
        </span>
        <span className="ml-auto text-[10px] text-neutral-400">
          T để bật định dạng
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        <RichTextEditor
          value={value}
          onChange={onChange}
          placeholder="Mô tả kỹ hơn về nghiệp vụ này — các bước hỗ trợ, lưu ý quan trọng, sai sót thường gặp…"
          uploadPrefix="workflow-guidance"
          minHeight={180}
          initialMode={initialMode}
        />
      </div>
    </div>
  )
})
