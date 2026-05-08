import { GitBranch, MessageSquare } from 'lucide-react'
import Modal from '../ui/Modal'
import RichTextDisplay from '../ui/RichTextDisplay'
import type { FormSubmission } from '../../types'

interface SubmissionOrigin {
  kind: 'chat' | 'workflow_step' | 'standalone'
  /** Human-readable label, e.g. "Workflow run 'X' — bước 'Y'" or "Chat thread của dự án" */
  label: string
}

interface Props {
  open: boolean
  onClose: () => void
  submission: FormSubmission | null
  origin: SubmissionOrigin | null
  /** Map of profile id → name (for resolving submitter / commenter). */
  submitterName?: string
}

export default function FormSubmissionDetailModal({
  open, onClose, submission, origin, submitterName,
}: Props) {
  if (!submission) return null

  const fields = (submission.template_snapshot ?? []) as Array<{ id: string; label: string; type?: string }>
  const data = submission.data as Record<string, unknown>
  const comments = (data.__comments ?? {}) as Record<string, { text?: string; attachments?: string[] }>

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={submission.template_name}
      size="lg"
    >
      <div className="space-y-3">
        {/* Origin + meta */}
        <div className="bg-neutral-25 border border-neutral-100 rounded-lg p-3 space-y-1.5">
          {origin && (
            <div className="flex items-center gap-2 text-xs text-neutral-700">
              {origin.kind === 'workflow_step'
                ? <GitBranch size={12} className="text-amber-600 shrink-0" />
                : <MessageSquare size={12} className="text-primary-600 shrink-0" />}
              <span className="font-medium">{origin.label}</span>
            </div>
          )}
          <div className="text-[11px] text-neutral-500">
            <span>Gửi bởi <strong className="text-neutral-700">{submitterName ?? '—'}</strong></span>
            <span className="mx-1.5">·</span>
            <span>{new Date(submission.submitted_at).toLocaleString('vi')}</span>
          </div>
        </div>

        {/* Fields */}
        <div className="divide-y divide-neutral-100 border border-neutral-100 rounded-lg">
          {fields.map(f => {
            const val = data[f.id]
            const hasValue = !(val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0))
            const display = Array.isArray(val) ? val.join(', ') : String(val ?? '')
            const comment = comments[f.id]
            const hasComment = !!(comment?.text || (comment?.attachments?.length ?? 0) > 0)
            if (!hasValue && !hasComment) return null
            return (
              <div key={f.id} className="px-4 py-2.5 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{f.label}</p>
                {hasValue && <p className="text-sm text-neutral-800">{display}</p>}
                {hasComment && (
                  <div className="bg-neutral-25 border border-neutral-100 rounded-md p-2 mt-1 space-y-1.5">
                    {comment?.text && (
                      <RichTextDisplay content={comment.text} className="text-xs text-neutral-700" />
                    )}
                    {(comment?.attachments ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {comment!.attachments!.map(url => (
                          /^.*\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(url) ? (
                            <a key={url} href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt="" className="w-16 h-16 object-cover rounded-md border border-neutral-200" />
                            </a>
                          ) : (
                            <a key={url} href={url} target="_blank" rel="noreferrer" className="text-xs text-primary-600 hover:underline break-all">
                              {url.split('/').pop()}
                            </a>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
