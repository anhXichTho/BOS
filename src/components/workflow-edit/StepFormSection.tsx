/**
 * Form attachment sub-section of the step detail editor.
 * - Helper panel picker (FAQ + AI Chatbot)
 * - Form template picker + "Tạo form mới" launcher
 *
 * In Phase 4, the "Tạo form mới" button will route through `InheritFormModal`
 * to offer "blank" vs "inherit from earlier step" — for now it opens the
 * standard TemplateEditor modal directly.
 */
import { memo } from 'react'
import { FilePlus2 } from 'lucide-react'
import StepFormFullPreview from './StepFormFullPreview'
import { deriveCodes } from './codes'
import type { StepDraft } from './types'
import type { HelperPanel, FormTemplate } from '../../types'

interface Props {
  step: StepDraft
  helpers: HelperPanel[]
  formTemplates: FormTemplate[]
  /** All steps in the editor — needed for the form-fill responsibility map. */
  allSteps?: StepDraft[]
  onUpdate: (id: string, patch: Partial<StepDraft>) => void
  onCreateForm: (stepId: string) => void
  /** Highlight related steps on the canvas while hovering rows in the field map. */
  onHoverSteps?: (stepIds: string[]) => void
}

export default memo(function StepFormSection({
  step, helpers, formTemplates, allSteps, onUpdate, onCreateForm, onHoverSteps,
}: Props) {
  const faqHelpers     = helpers.filter(h => h.type === 'faq')
  const chatbotHelpers = helpers.filter(h => h.type === 'chatbot')

  return (
    <section className="border border-neutral-100 rounded-lg p-3 bg-white space-y-2.5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-700 flex items-center gap-1.5">
        <FilePlus2 size={13} className="text-primary-600" />
        Đính kèm
      </h4>

      {/* Helper panel */}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
          Trợ lý / FAQ
        </label>
        <select
          value={step.helper_panel_id ?? ''}
          onChange={e => onUpdate(step.id, { helper_panel_id: e.target.value || null })}
          className="border border-neutral-200 rounded-lg px-2 py-1 text-xs bg-white w-full"
        >
          <option value="">— Không gắn —</option>
          {faqHelpers.length > 0 && (
            <optgroup label="FAQ">
              {faqHelpers.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </optgroup>
          )}
          {chatbotHelpers.length > 0 && (
            <optgroup label="AI Chatbot">
              {chatbotHelpers.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      {/* Form template */}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
          Form thông tin
        </label>
        <div className="flex gap-1.5">
          <select
            value={step.form_template_id ?? ''}
            onChange={e => onUpdate(step.id, { form_template_id: e.target.value || null })}
            className="border border-neutral-200 rounded-lg px-2 py-1 text-xs bg-white flex-1 min-w-0"
          >
            <option value="">— Không gắn form —</option>
            {formTemplates.map(f => <option key={f.id} value={f.id}>📋 {f.name}</option>)}
          </select>
          <button
            type="button"
            onClick={() => onCreateForm(step.id)}
            className="text-[10px] px-2 py-1 border border-dashed border-primary-300 text-primary-600 rounded-lg hover:bg-primary-50 whitespace-nowrap shrink-0"
            title="Tạo form mới"
          >
            + Tạo
          </button>
        </div>
      </div>

      {/* Round-5 Phase C — full-form responsibility map */}
      {step.form_template_id && allSteps && (
        <StepFormFullPreview
          currentStep={step}
          steps={allSteps}
          formTemplates={formTemplates}
          codes={deriveCodes(allSteps)}
          onHoverSteps={onHoverSteps}
        />
      )}
    </section>
  )
})
