/**
 * ConditionExpression — shared condition builder used by both:
 *   • Step "Hiện khi" — picks a single expression (or null = always show).
 *   • Branch detail panel — each case is one ConditionExpression-shaped row,
 *     tied to a single shared (source_step + source_field) pair.
 *
 * UI layout:
 *   [ Bước nguồn ▼ ]   [ Outcome | Field ]   [ Field ▼ ]   [ Op ▼ ]   [ Value ]
 *
 * - "Bước nguồn" is filtered to `priorSteps` (DFS-prior to the current step).
 * - "Outcome | Field" only shows when the source step actually has both
 *   - Outcome only available if source.step_type='branch' OR source has
 *     branch_options ≥ 1 (legacy)
 *   - Field only available if source has form_template_id
 * - For Outcome source: operator forced to '=', value picker = source's
 *   branch_options dropdown.
 * - For Field source: field picker uses the source step's form fields;
 *   operator dropdown = the 7 allowed ops; value is a free-text input
 *   except when the field is select/radio — then it's a dropdown of options.
 *
 * The component is a "controlled-with-defaults" pattern — never holds local
 * state. All edits flow up via `onChange`. Pass `value=null` for unset.
 */
import { memo, useMemo } from 'react'
import type { StepDraft, ConditionOperator } from './types'
import type { FormField, FormTemplate } from '../../types'

interface CondShape {
  source_kind: 'outcome' | 'field'
  source_step_id: string | null
  source_field_id: string | null
  operator: ConditionOperator
  value: string
}

interface Props {
  /** Current expression. null/undefined ⇒ unset. */
  value: CondShape | null | undefined
  onChange: (next: CondShape | null) => void
  /** Steps that come before this one in DFS order (eligible sources). */
  priorSteps: StepDraft[]
  /** All form templates — needed for field discovery. */
  formTemplates: FormTemplate[]
  /** Optional placeholder for "no source selected" empty state text. */
  emptyLabel?: string
  /** When true, the source-kind toggle is hidden because the parent already
   *  decided the kind (e.g. branch with multiple cases sharing a kind). */
  hideKindToggle?: boolean
  /** Override the source — useful when caller manages source step + field
   *  centrally and expression rows only edit operator+value. */
  pinnedSource?: { step_id: string | null; field_id: string | null; kind: 'outcome' | 'field' }
}

const ALL_OPERATORS: ConditionOperator[] = ['=', '!=', '>', '<', '>=', '<=', 'contains']

export default memo(function ConditionExpression({
  value, onChange, priorSteps, formTemplates, emptyLabel,
  hideKindToggle = false, pinnedSource,
}: Props) {
  // Resolve the source step from props or from the value.
  const sourceStepId = pinnedSource?.step_id ?? value?.source_step_id ?? null
  const sourceKind   = pinnedSource?.kind    ?? value?.source_kind    ?? 'outcome'
  const sourceFieldId = pinnedSource?.field_id ?? value?.source_field_id ?? null

  const sourceStep = useMemo(
    () => priorSteps.find(s => s.id === sourceStepId) ?? null,
    [priorSteps, sourceStepId],
  )

  const sourceForm = useMemo<FormTemplate | null>(() => {
    if (!sourceStep?.form_template_id) return null
    return formTemplates.find(f => f.id === sourceStep.form_template_id) ?? null
  }, [sourceStep, formTemplates])

  const sourceField = useMemo<FormField | null>(() => {
    if (!sourceForm || !sourceFieldId) return null
    return sourceForm.fields.find(f => f.id === sourceFieldId) ?? null
  }, [sourceForm, sourceFieldId])

  // Available kinds for the chosen source step.
  const kindOutcomeAvailable = !!sourceStep && sourceStep.branch_options.length > 0
  const kindFieldAvailable   = !!sourceForm

  // Derive value-picker options.
  const valueOptions: string[] | null = useMemo(() => {
    if (sourceKind === 'outcome' && sourceStep) return sourceStep.branch_options
    if (sourceKind === 'field' && sourceField && sourceField.options) return sourceField.options
    return null
  }, [sourceKind, sourceStep, sourceField])

  // Helper: emit a partial change (preserves whatever is missing in `value`).
  function emit(patch: Partial<CondShape>) {
    if (!value && !pinnedSource && patch.source_step_id == null) {
      // Editing an unset expression but no source picked — only commit when
      // the user picks a source. Otherwise stay null.
      onChange(null)
      return
    }
    const next: CondShape = {
      source_kind:     pinnedSource?.kind     ?? value?.source_kind     ?? 'outcome',
      source_step_id:  pinnedSource?.step_id  ?? value?.source_step_id  ?? null,
      source_field_id: pinnedSource?.field_id ?? value?.source_field_id ?? null,
      operator:        value?.operator        ?? '=',
      value:           value?.value           ?? '',
      ...patch,
    }
    onChange(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {/* Source step picker (hidden when parent pinned source) */}
      {!pinnedSource && (
        <select
          value={sourceStepId ?? ''}
          onChange={e => {
            const id = e.target.value || null
            // When the source step changes, reset the dependent fields.
            const newSourceStep = priorSteps.find(s => s.id === id) ?? null
            const newKind: 'outcome' | 'field' =
              newSourceStep?.branch_options?.length ? 'outcome'
              : newSourceStep?.form_template_id    ? 'field'
              : 'outcome'
            emit({
              source_step_id:  id,
              source_field_id: null,
              source_kind:     newKind,
              value:           '',
            })
            if (!id) onChange(null)
          }}
          className="border border-neutral-200 rounded px-2 py-1 bg-white"
        >
          <option value="">{emptyLabel ?? '(luôn hiện)'}</option>
          {priorSteps.map(s => (
            <option key={s.id} value={s.id}>{s.title || '(chưa đặt tên)'}</option>
          ))}
        </select>
      )}

      {/* Source kind toggle (Outcome | Field) */}
      {!hideKindToggle && sourceStep && (kindOutcomeAvailable || kindFieldAvailable) && (
        <div className="inline-flex border border-neutral-200 rounded overflow-hidden">
          {kindOutcomeAvailable && (
            <button
              type="button"
              onClick={() => emit({ source_kind: 'outcome', source_field_id: null, value: '', operator: '=' })}
              className={`px-2 py-1 text-[10px] ${sourceKind === 'outcome' ? 'bg-primary-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
            >
              Outcome
            </button>
          )}
          {kindFieldAvailable && (
            <button
              type="button"
              onClick={() => emit({ source_kind: 'field', value: '' })}
              className={`px-2 py-1 text-[10px] ${sourceKind === 'field' ? 'bg-primary-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
            >
              Field
            </button>
          )}
        </div>
      )}

      {/* Field picker (only when source_kind=field) */}
      {sourceKind === 'field' && sourceForm && (
        <select
          value={sourceFieldId ?? ''}
          onChange={e => emit({ source_field_id: e.target.value || null, value: '' })}
          className="border border-neutral-200 rounded px-2 py-1 bg-white"
        >
          <option value="">— chọn field —</option>
          {sourceForm.fields.map(f => (
            <option key={f.id} value={f.id}>{f.label || '(chưa đặt tên)'}</option>
          ))}
        </select>
      )}

      {/* Operator picker */}
      {sourceStepId && (sourceKind !== 'field' || sourceFieldId) && (
        <select
          value={value?.operator ?? '='}
          onChange={e => emit({ operator: e.target.value as ConditionOperator })}
          // For outcome-source we restrict operators to = / !=, since
          // outcomes are discrete enum-like values.
          className="border border-neutral-200 rounded px-1.5 py-1 bg-white font-mono"
        >
          {(sourceKind === 'outcome' ? (['=', '!='] as ConditionOperator[]) : ALL_OPERATORS).map(op => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
      )}

      {/* Value picker / input */}
      {sourceStepId && (sourceKind !== 'field' || sourceFieldId) && (
        valueOptions ? (
          <select
            value={value?.value ?? ''}
            onChange={e => emit({ value: e.target.value })}
            className="border border-neutral-200 rounded px-2 py-1 bg-white"
          >
            <option value="">— giá trị —</option>
            {valueOptions.map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={value?.value ?? ''}
            onChange={e => emit({ value: e.target.value })}
            placeholder="giá trị"
            className="border border-neutral-200 rounded px-2 py-1 bg-white w-28"
          />
        )
      )}

      {/* Edge case: source step has no outcome and no form */}
      {sourceStep && !kindOutcomeAvailable && !kindFieldAvailable && (
        <span className="italic text-neutral-400">(bước này không có outcome/form để so sánh)</span>
      )}
    </div>
  )
})

export type { CondShape }
