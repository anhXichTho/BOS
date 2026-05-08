/**
 * InheritFormModal — shown when user clicks "+ Tạo form" on a workflow step.
 *
 * Two paths:
 *   1. "Form mới hoàn toàn" → caller opens blank TemplateEditor.
 *   2. "Kế thừa từ form bước trước" → user picks an earlier step, this modal
 *      deep-clones that step's template fields with `inherited_from_field_id`
 *      lineage markers, and the caller opens TemplateEditor pre-populated.
 *
 * Only earlier steps (order_index < current) are listed — fields cannot
 * inherit from later steps.
 */
import { memo, useState } from 'react'
import { FilePlus2, ArrowLeftRight } from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import type { StepDraft } from './types'
import type { FormTemplate, FormField } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  /** All steps in the current workflow (for finding earlier steps with forms). */
  steps: StepDraft[]
  /** The step we're creating a form for. */
  currentStepId: string
  /** All form_templates known to the editor (must include those referenced by earlier steps). */
  formTemplates: FormTemplate[]
  /** Caller decides what to do with the chosen path. */
  onPickBlank: () => void
  onPickInherit: (clonedFields: FormField[], sourceTemplateName: string) => void
}

export default memo(function InheritFormModal({
  open, onClose, steps, currentStepId, formTemplates, onPickBlank, onPickInherit,
}: Props) {
  const [mode, setMode] = useState<'menu' | 'inherit'>('menu')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')

  const currentStep = steps.find(s => s.id === currentStepId)
  const currentOrder = currentStep?.order_index ?? 0

  /** Earlier steps that have a form template attached. */
  const eligibleSteps = steps
    .filter(s => s.order_index < currentOrder && s.form_template_id)
    .sort((a, b) => a.order_index - b.order_index)

  // De-dupe by template id (multiple steps may share the same template).
  const seenTemplateIds = new Set<string>()
  const eligibleEntries = eligibleSteps
    .map(s => {
      const tmpl = formTemplates.find(t => t.id === s.form_template_id)
      if (!tmpl) return null
      if (seenTemplateIds.has(tmpl.id)) return null
      seenTemplateIds.add(tmpl.id)
      return { step: s, template: tmpl }
    })
    .filter((x): x is { step: StepDraft; template: FormTemplate } => x !== null)

  function handleInherit() {
    const tmpl = formTemplates.find(t => t.id === selectedTemplateId)
    if (!tmpl) return
    // Deep clone fields with fresh ids + lineage markers.
    const cloned: FormField[] = tmpl.fields.map(f => ({
      ...f,
      id: crypto.randomUUID(),
      inherited_from_field_id: f.id,
      // Default cloned fields to "filled at the source step" — the runner at
      // the source step has already entered them; subsequent steps see readonly.
      // We don't know the source step's template-level id at this layer, but
      // we do know the source step's *draft* id; the caller's save flow maps
      // draft ids to db ids on save, so this works end-to-end.
      fill_at_step_id: eligibleEntries.find(e => e.template.id === selectedTemplateId)?.step.id ?? null,
      fill_by_role: f.fill_by_role ?? 'runner',
    }))
    onPickInherit(cloned, tmpl.name)
    onClose()
    setMode('menu')
    setSelectedTemplateId('')
  }

  function handleClose() {
    onClose()
    setMode('menu')
    setSelectedTemplateId('')
  }

  return (
    <Modal open={open} onClose={handleClose} title="Tạo form cho bước này" size="md">
      {mode === 'menu' && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">
            Chọn cách tạo form mới cho bước này:
          </p>

          <button
            type="button"
            onClick={() => { onPickBlank(); handleClose() }}
            className="w-full text-left border border-neutral-200 rounded-lg p-3 hover:border-primary-400 hover:bg-primary-50/30 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <FilePlus2 size={14} className="text-primary-600" />
              <strong className="text-sm text-neutral-700">Form mới hoàn toàn</strong>
            </div>
            <p className="text-[11px] text-neutral-500">
              Bắt đầu từ form trống. Bạn sẽ tự thêm các trường thông tin cần thiết.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setMode('inherit')}
            disabled={eligibleEntries.length === 0}
            className="w-full text-left border border-neutral-200 rounded-lg p-3 hover:border-primary-400 hover:bg-primary-50/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-neutral-200 disabled:hover:bg-transparent"
          >
            <div className="flex items-center gap-2 mb-1">
              <ArrowLeftRight size={14} className="text-primary-600" />
              <strong className="text-sm text-neutral-700">Kế thừa từ form bước trước</strong>
            </div>
            <p className="text-[11px] text-neutral-500">
              {eligibleEntries.length > 0
                ? `Sao chép các trường từ form đã gắn ở bước trước (${eligibleEntries.length} form khả dụng), bạn có thể bổ sung thêm trường mới.`
                : 'Chưa có bước trước nào gắn form — chọn "Form mới" để bắt đầu.'}
            </p>
          </button>
        </div>
      )}

      {mode === 'inherit' && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">
            Chọn form bước trước để kế thừa các trường:
          </p>

          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {eligibleEntries.map(({ step, template }) => (
              <label
                key={template.id}
                className={`flex items-start gap-2 border rounded-lg p-2.5 cursor-pointer transition-colors ${
                  selectedTemplateId === template.id
                    ? 'border-primary-400 bg-primary-50/30'
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <input
                  type="radio"
                  checked={selectedTemplateId === template.id}
                  onChange={() => setSelectedTemplateId(template.id)}
                  className="mt-1 accent-primary-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-neutral-700 truncate">
                    📋 {template.name}
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    Từ bước "{step.title || '(chưa đặt tên)'}" · {template.fields.length} trường
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
            <Button variant="secondary" onClick={() => { setMode('menu'); setSelectedTemplateId('') }}>
              Quay lại
            </Button>
            <Button onClick={handleInherit} disabled={!selectedTemplateId}>
              Kế thừa và tiếp tục
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
})
