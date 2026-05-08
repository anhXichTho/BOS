/**
 * StepPreviewModal — read-only "what will the user see when running this
 * step" preview, opened from the StepDetailPanel header.
 *
 * Renders:
 *  • Step title + description (read-only display)
 *  • Approval & duration meta chips
 *  • Attached helper-panel name (if any) — link only, content lives elsewhere
 *  • Attached form template — fields rendered editable so the editor can feel
 *    the actual fill experience, but nothing is submitted (state is local).
 *
 * Modal is sized "xl" so it visually mirrors the detail panel column width.
 */
import { memo, useState } from 'react'
import { ShieldCheck, FileText, Bot, Clock } from 'lucide-react'
import Modal from '../ui/Modal'
import RichTextDisplay from '../ui/RichTextDisplay'
import FormFields, { emptyAnswers, type Answers } from '../forms/FormFields'
import type { StepDraft } from './types'
import type { FormTemplate, HelperPanel, Profile } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  step: StepDraft
  helpers: HelperPanel[]
  formTemplates: FormTemplate[]
  profiles: Profile[]
}

export default memo(function StepPreviewModal({
  open, onClose, step, helpers, formTemplates, profiles,
}: Props) {
  const helper = step.helper_panel_id
    ? helpers.find(h => h.id === step.helper_panel_id) ?? null
    : null
  const form = step.form_template_id
    ? formTemplates.find(f => f.id === step.form_template_id) ?? null
    : null
  const approverName = step.approver_user_id
    ? profiles.find(p => p.id === step.approver_user_id)?.full_name ?? '—'
    : step.approver_role === 'admin'  ? 'Tất cả Admin'
    : step.approver_role === 'editor' ? 'Tất cả Editor'
    : '—'

  // Local form state — never submitted; resets each open.
  const [answers, setAnswers] = useState<Answers>(() => emptyAnswers())

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Preview bước: ${step.title || '(chưa đặt tên)'}`}
    >
      <div className="space-y-5">
        {/* Meta chips row */}
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-100 text-neutral-600 rounded">
            <Clock size={10} /> {step.duration_hours ?? 3} tiếng
          </span>
          {step.step_type === 'branch' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded">
              Chia nhánh ({step.branch_options.length || '?'})
            </span>
          )}
          {step.requires_approval && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded">
              <ShieldCheck size={10} /> Cần duyệt: {approverName}
            </span>
          )}
        </div>

        {/* Description block */}
        {step.description && (
          <section>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              Mô tả bước
            </h4>
            <p className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">
              {step.description}
            </p>
          </section>
        )}

        {/* Helper panel reference */}
        {helper && (
          <section className="border border-neutral-100 rounded-lg p-3 bg-neutral-50/50">
            <div className="flex items-center gap-2 mb-1">
              <Bot size={13} className="text-primary-600" />
              <h4 className="text-xs font-semibold text-neutral-700">{helper.name}</h4>
              <span className="text-[10px] text-neutral-400">
                ({helper.type === 'chatbot' ? 'AI Assistant' : 'FAQ Doc'})
              </span>
            </div>
            {helper.description && (
              <p className="text-[11px] text-neutral-500">{helper.description}</p>
            )}
          </section>
        )}

        {/* Form preview */}
        {form && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <FileText size={13} className="text-primary-600" />
              <h4 className="text-xs font-semibold text-neutral-700">Form: {form.name}</h4>
            </div>
            {form.description && (
              <RichTextDisplay
                content={form.description}
                className="text-[11px] text-neutral-500 mb-2"
              />
            )}
            <div className="border border-neutral-100 rounded-lg p-3 bg-white">
              <FormFields
                template={form}
                answers={answers}
                setAnswers={setAnswers}
              />
              <p className="text-[10px] text-neutral-400 italic mt-3">
                Đây là bản preview — dữ liệu nhập vào không được lưu.
              </p>
            </div>
          </section>
        )}

        {!helper && !form && !step.description && (
          <p className="text-xs text-neutral-400 italic">
            Bước này chưa có hướng dẫn, AI hoặc form đính kèm. Người chạy chỉ cần đánh dấu hoàn thành.
          </p>
        )}
      </div>
    </Modal>
  )
})
