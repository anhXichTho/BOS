/**
 * StepFormFullPreview — full-form responsibility map (Round-5 Phase C).
 *
 * Renders every field of the attached form, each with a status chip showing
 * which step is responsible for it FROM THE CURRENT STEP'S PERSPECTIVE:
 *   • Filled at S{N}      — already filled by an ancestor step (green check)
 *   • S{N} — Bước này điền — required at the current step (primary tint)
 *   • Sẽ điền tại S{N}    — required at a downstream/later step (amber)
 *   • Chưa gán bước       — fill_at_step_id is null (unassigned, grey)
 *
 * Each row is clickable: opens an inline picker that reassigns
 * `fill_at_step_id` for that field. The change is persisted via a single
 * UPDATE on form_templates.fields jsonb. Hovering a row also fires
 * `onHoverSteps([stepId])` so the canvas can outline the responsible
 * step in amber.
 *
 * Only renders when:
 *  • a form is attached to the current step, AND
 *  • the form template has been loaded into the formTemplates list.
 */
import { memo, useMemo, useState } from 'react'
import { CheckCircle2, Circle, ChevronDown } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { StepDraft } from './types'
import type { DerivedCodes } from './codes'
import type { FormTemplate, FormField } from '../../types'

interface Props {
  /** The currently-selected step (whose perspective we're rendering). */
  currentStep: StepDraft
  /** All steps in the editor (for ancestor / descendant lookup). */
  steps: StepDraft[]
  /** All form templates (for resolving step.form_template_id → FormTemplate). */
  formTemplates: FormTemplate[]
  /** Pre-derived S/F codes. */
  codes: DerivedCodes
  /** Highlight-on-canvas callback. Empty array clears. */
  onHoverSteps?: (stepIds: string[]) => void
}

type Bucket = 'filled' | 'current' | 'later' | 'unassigned' | 'unknown'

interface FieldRow {
  field: FormField
  bucket: Bucket
  responsibleStep: StepDraft | null
}

export default memo(function StepFormFullPreview({
  currentStep, steps, formTemplates, codes, onHoverSteps,
}: Props) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(true)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)

  const form = currentStep.form_template_id
    ? formTemplates.find(f => f.id === currentStep.form_template_id) ?? null
    : null

  // Steps that share the same form_template_id (incl. current).
  const sharingSteps = useMemo(() => {
    if (!form) return [] as StepDraft[]
    return steps.filter(s => s.form_template_id === form.id)
  }, [steps, form])

  // Ancestor + descendant sets (used to bucket fields per step responsibility).
  const ancestorIds = useMemo(() => {
    const ids = new Set<string>()
    let cur: string | null = currentStep.parent_step_id
    while (cur) {
      ids.add(cur)
      const s = steps.find(p => p.id === cur)
      cur = s?.parent_step_id ?? null
    }
    return ids
  }, [steps, currentStep.parent_step_id])

  /** Resolve a `fill_at_step_id` (which may be a draft client id OR a db id) to a step. */
  function findStep(id: string | null | undefined): StepDraft | null {
    if (!id) return null
    return steps.find(s => s.id === id || s.db_id === id) ?? null
  }

  function bucketFor(field: FormField): { bucket: Bucket; responsibleStep: StepDraft | null } {
    // null fill_at_step_id ⇒ field is filled at the step where the form is attached.
    // For the visualization that's the current step (when the field has no
    // explicit assignment AND the current step is the form-attaching step).
    if (!field.fill_at_step_id) {
      return { bucket: 'unassigned', responsibleStep: null }
    }
    const responsible = findStep(field.fill_at_step_id)
    if (!responsible) return { bucket: 'unknown', responsibleStep: null }
    if (responsible.id === currentStep.id || responsible.db_id === currentStep.db_id) {
      return { bucket: 'current', responsibleStep: responsible }
    }
    if (ancestorIds.has(responsible.id) || (responsible.db_id && ancestorIds.has(responsible.db_id))) {
      return { bucket: 'filled', responsibleStep: responsible }
    }
    return { bucket: 'later', responsibleStep: responsible }
  }

  const rows: FieldRow[] = useMemo(() => {
    if (!form) return []
    return form.fields.map(field => {
      const { bucket, responsibleStep } = bucketFor(field)
      return { field, bucket, responsibleStep }
    })
  }, [form, steps, ancestorIds, currentStep])

  // Counts for the header.
  const counts = useMemo(() => {
    const c = { filled: 0, current: 0, later: 0, unassigned: 0, unknown: 0 }
    for (const r of rows) c[r.bucket] += 1
    return c
  }, [rows])

  if (!form) return null

  // ─── Persist a field's fill_at_step_id change ─────────────────────────────
  async function reassignField(fieldId: string, newStepIdOrNull: string | null) {
    if (!form) return
    // Build the new fields array in-place.
    const updated = form.fields.map(f =>
      f.id === fieldId ? { ...f, fill_at_step_id: newStepIdOrNull } : f,
    )
    const { error } = await supabase
      .from('form_templates')
      .update({ fields: updated, updated_at: new Date().toISOString() })
      .eq('id', form.id)
    if (error) {
      console.error('[StepFormFullPreview] reassign failed:', error.message)
      return
    }
    // Refresh the form-templates query so the new bucket renders.
    qc.invalidateQueries({ queryKey: ['form-templates'] })
    qc.invalidateQueries({ queryKey: ['form-templates-all'] })
    setEditingFieldId(null)
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const formCode = codes.formCode[form.id] ?? 'F?'

  return (
    <section className="border border-neutral-100 rounded-lg bg-white">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 border-b border-neutral-100 hover:bg-neutral-50/50"
      >
        <ChevronDown
          size={12}
          className={`text-neutral-500 transition-transform ${expanded ? '' : '-rotate-90'}`}
        />
        <span className="text-[11px] font-semibold text-neutral-700 flex-1 text-left">
          Toàn bộ form: <span className="font-mono text-neutral-500">{formCode}</span> · {form.name}
        </span>
        {/* Counts */}
        <span className="text-[10px] text-neutral-500 inline-flex gap-2">
          {counts.filled  > 0 && <span className="text-green-700">{counts.filled} đã điền</span>}
          {counts.current > 0 && <span className="text-primary-700">{counts.current} bước này</span>}
          {counts.later   > 0 && <span className="text-amber-700">{counts.later} bước sau</span>}
          {counts.unassigned > 0 && <span className="text-neutral-400">{counts.unassigned} chưa gán</span>}
        </span>
      </button>

      {/* Inheritance hint */}
      {expanded && sharingSteps.length >= 2 && (
        <div className="px-3 py-1.5 bg-amber-50/40 border-b border-amber-100 text-[10px] text-amber-700">
          Form này dùng chung với{' '}
          {sharingSteps
            .filter(s => s.id !== currentStep.id)
            .map(s => codes.stepCode[s.id])
            .filter(Boolean)
            .join(', ')}
        </div>
      )}

      {/* Field list */}
      {expanded && (
        <ul className="divide-y divide-neutral-100">
          {rows.map(({ field, bucket, responsibleStep }) => {
            const stepCode = responsibleStep ? codes.stepCode[responsibleStep.id] : null
            const isEditing = editingFieldId === field.id
            const tone = bucketTone(bucket)
            return (
              <li
                key={field.id}
                className={`px-3 py-2 transition-colors ${tone.bg} ${tone.hover}`}
                onMouseEnter={() => responsibleStep && onHoverSteps?.([responsibleStep.id])}
                onMouseLeave={() => onHoverSteps?.([])}
              >
                <div className="flex items-center gap-2">
                  {/* Status icon */}
                  {bucket === 'filled' ? (
                    <CheckCircle2 size={13} className="text-green-600 shrink-0" />
                  ) : (
                    <Circle size={13} className={`${tone.icon} shrink-0`} />
                  )}

                  {/* Field label + required flag */}
                  <span className="flex-1 text-[12px] text-neutral-800 truncate">
                    {field.label || <span className="italic text-neutral-400">(field chưa đặt tên)</span>}
                    {field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </span>

                  {/* Status chip */}
                  <button
                    type="button"
                    onClick={() => setEditingFieldId(isEditing ? null : field.id)}
                    className={`text-[10px] px-1.5 py-0.5 border rounded ${tone.chip} hover:opacity-90 whitespace-nowrap shrink-0`}
                    title="Bấm để đổi bước phụ trách"
                  >
                    {bucketLabel(bucket, stepCode, codes.stepCode[currentStep.id])}
                  </button>
                </div>

                {/* Inline picker (when editing) */}
                {isEditing && (
                  <div className="mt-1.5 ml-5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-neutral-500">Bước điền:</span>
                    <select
                      value={field.fill_at_step_id ?? ''}
                      onChange={e => reassignField(field.id, e.target.value || null)}
                      className="border border-neutral-200 rounded px-1.5 py-0.5 text-[11px] bg-white"
                    >
                      <option value="">(chưa gán)</option>
                      {sharingSteps.map(s => {
                        const code = codes.stepCode[s.id]
                        // Use db_id when available so the form-template-level reference is portable;
                        // fall back to client id for new (unsaved) steps.
                        const idVal = s.db_id ?? s.id
                        return (
                          <option key={s.id} value={idVal}>
                            {code} — {s.title || '(chưa đặt tên)'}
                          </option>
                        )
                      })}
                    </select>
                    <button
                      type="button"
                      onClick={() => setEditingFieldId(null)}
                      className="text-[10px] text-neutral-500 hover:text-neutral-800"
                    >
                      Đóng
                    </button>
                  </div>
                )}
              </li>
            )
          })}
          {rows.length === 0 && (
            <li className="px-3 py-3 text-[11px] italic text-neutral-400 text-center">
              Form này chưa có field nào.
            </li>
          )}
        </ul>
      )}
    </section>
  )
})

// ─── Helpers ────────────────────────────────────────────────────────────────

function bucketTone(b: Bucket) {
  switch (b) {
    case 'filled':     return { bg: 'bg-green-50/40',  hover: 'hover:bg-green-50',  icon: 'text-green-600',   chip: 'bg-green-50 text-green-700 border-green-200' }
    case 'current':    return { bg: 'bg-primary-50/50',hover: 'hover:bg-primary-50',icon: 'text-primary-600', chip: 'bg-primary-100 text-primary-800 border-primary-300' }
    case 'later':      return { bg: 'bg-amber-50/40', hover: 'hover:bg-amber-50',  icon: 'text-amber-600',   chip: 'bg-amber-50 text-amber-700 border-amber-300' }
    case 'unassigned': return { bg: '',               hover: 'hover:bg-neutral-50',icon: 'text-neutral-400', chip: 'bg-neutral-100 text-neutral-600 border-neutral-200' }
    case 'unknown':    return { bg: '',               hover: 'hover:bg-neutral-50',icon: 'text-neutral-400', chip: 'bg-neutral-100 text-neutral-600 border-neutral-300 italic' }
  }
}

function bucketLabel(b: Bucket, stepCode: string | null, _currentCode?: string) {
  switch (b) {
    case 'filled':     return stepCode ? `Đã điền tại ${stepCode}` : 'Đã điền'
    case 'current':    return stepCode ? `${stepCode} — bước này điền` : 'Bước này điền'
    case 'later':      return stepCode ? `Sẽ điền tại ${stepCode}` : 'Sẽ điền sau'
    case 'unassigned': return 'Chưa gán bước'
    case 'unknown':    return 'Bước khác workflow'
  }
}
