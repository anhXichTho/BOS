/**
 * FormFields — shared field-rendering layer.
 *
 * Extracted from FormFillModal.tsx in Phase 4. Zero logic change.
 * Used by:
 *   - FormFillModal  (existing form-fill modal)
 *   - FormDraftPanel (side-panel fill + auto-save)
 *   - SubmissionView (read-only viewer, disabled=true)
 *
 * Workflow fill rules (added Phase D): when a `runContext` is provided,
 * each field is gated per its `fill_at_step_id` + `fill_by_role`:
 *   - editable  : this step + this user is allowed to fill
 *   - readonly  : another step's responsibility, but a value already exists
 *   - hidden    : another step's responsibility AND no value yet (skip render)
 */
import { ChevronDown } from 'lucide-react'
import RichTextEditor from '../ui/RichTextEditor'
import RichTextDisplay from '../ui/RichTextDisplay'
import type { FormTemplate, FormField } from '../../types'

// ─── Workflow run context ─────────────────────────────────────────────────

export interface FormRunContext {
  /** Template-level workflow_steps.id of the step being run right now. */
  currentStepTemplateId: string
  /** Profile of the current user. */
  currentUserId: string
  /** Whether the current user is the resolved approver of the current step. */
  isApprover: boolean
}

export type FieldMode = 'editable' | 'readonly' | 'hidden'

export function computeFieldMode(
  field: FormField,
  ctx: FormRunContext | undefined,
  currentValue: unknown,
): FieldMode {
  // No run-context (standalone form fill) → behave as today.
  if (!ctx) return 'editable'

  // No fill rules on this field → no restriction.
  const hasFillRules = field.fill_at_step_id || field.fill_by_role
  if (!hasFillRules) return 'editable'

  const expectedStep = field.fill_at_step_id ?? ctx.currentStepTemplateId
  const isThisStep = expectedStep === ctx.currentStepTemplateId

  if (!isThisStep) {
    // This field belongs to another step. If it has a value already (filled
    // earlier or due later), show readonly. Otherwise hide entirely.
    const hasValue =
      currentValue !== undefined && currentValue !== null && currentValue !== '' &&
      !(Array.isArray(currentValue) && currentValue.length === 0)
    return hasValue ? 'readonly' : 'hidden'
  }

  // This step. Check role.
  const role = field.fill_by_role ?? 'runner'
  switch (role) {
    case 'approver':
      return ctx.isApprover ? 'editable' : 'readonly'
    case 'specific_user':
      return ctx.currentUserId === field.fill_by_user_id ? 'editable' : 'readonly'
    case 'runner':
    default:
      return 'editable'
  }
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export const OTHER_MARKER = '__OTHER__'

export interface CommentValue {
  text: string
  attachments: string[]
}

export interface Answers {
  values: Record<string, unknown>        // by field id
  other: Record<string, string>          // free-text for "Khác"
  comments: Record<string, CommentValue> // per-question comment
}

export function emptyAnswers(): Answers {
  return { values: {}, other: {}, comments: {} }
}

// ─── Condition evaluator ─────────────────────────────────────────────────────

export function evaluateCondition(field: FormField, answers: Answers): boolean {
  if (!field.condition) return true
  const { field_id, operator, value } = field.condition
  const raw = answers.values[field_id]
  const actual = Array.isArray(raw) ? raw.join(',') : String(raw ?? '')
  if (operator === 'eq')  return actual === value || (Array.isArray(raw) && raw.includes(value))
  if (operator === 'neq') return actual !== value
  if (operator === 'gt')  return Number(actual) >  Number(value)
  if (operator === 'lt')  return Number(actual) <  Number(value)
  return true
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateField(field: FormField, answers: Answers): string | null {
  const v = answers.values[field.id]
  const otherText = answers.other[field.id] ?? ''

  function isEmpty(val: unknown): boolean {
    if (val === undefined || val === null || val === '') return true
    if (Array.isArray(val) && val.length === 0) return true
    return false
  }

  if ((field.type === 'select' || field.type === 'radio') && v === OTHER_MARKER && !otherText.trim()) {
    return 'Điền nội dung cho "Khác"'
  }
  if (field.type === 'multi_select' && Array.isArray(v) && v.includes(OTHER_MARKER) && !otherText.trim()) {
    return 'Điền nội dung cho "Khác"'
  }

  if (field.required && isEmpty(v) && !(v === OTHER_MARKER && otherText.trim())) {
    return 'Bắt buộc'
  }

  if (field.type === 'number' && v !== '' && v !== undefined && v !== null) {
    const n = Number(v)
    if (field.validation?.min !== undefined && n < field.validation.min) return `Tối thiểu ${field.validation.min}`
    if (field.validation?.max !== undefined && n > field.validation.max) return `Tối đa ${field.validation.max}`
  }

  return null
}

// ─── Comment box ──────────────────────────────────────────────────────────────

function CommentBox({
  fieldId,
  value,
  onChange,
  disabled,
}: {
  fieldId: string
  value: CommentValue
  onChange: (next: CommentValue) => void
  disabled?: boolean
}) {
  if (disabled && !value.text) return null
  return (
    <div className="bg-neutral-25 border border-neutral-100 rounded-lg p-2 mt-1">
      {disabled ? (
        <RichTextDisplay content={value.text} className="text-xs text-neutral-600" />
      ) : (
        <RichTextEditor
          value={value.text}
          onChange={t => onChange({ ...value, text: t })}
          placeholder="Ghi chú thêm cho câu này — rich text + paste ảnh…"
          uploadPrefix={`forms/${fieldId}`}
          compact
          minHeight={48}
        />
      )}
    </div>
  )
}

// ─── Field renderer ───────────────────────────────────────────────────────────

export function FieldBlock({
  field,
  answers,
  setAnswers,
  errorMessage,
  disabled: rawDisabled,
  runContext,
}: {
  field: FormField
  answers: Answers
  setAnswers: (next: Answers) => void
  errorMessage?: string | null
  disabled?: boolean
  /** When provided, applies workflow fill rules (fill_at_step_id, fill_by_role). */
  runContext?: FormRunContext
}) {
  if (!evaluateCondition(field, answers)) return null

  const v = answers.values[field.id]
  // Workflow fill-rule gating: hidden → skip render; readonly → force disabled.
  const mode = computeFieldMode(field, runContext, v)
  if (mode === 'hidden') return null
  /** Effective disabled state — `rawDisabled` from caller PLUS readonly from fill rules. */
  const disabled = rawDisabled || mode === 'readonly'

  const otherText = answers.other[field.id] ?? ''
  const showOther =
    field.allow_other &&
    ((['select', 'radio'].includes(field.type) && v === OTHER_MARKER) ||
     (field.type === 'multi_select' && Array.isArray(v) && v.includes(OTHER_MARKER)))

  function set(value: unknown) {
    if (disabled) return
    setAnswers({ ...answers, values: { ...answers.values, [field.id]: value } })
  }

  function setOther(text: string) {
    if (disabled) return
    setAnswers({ ...answers, other: { ...answers.other, [field.id]: text } })
  }

  const baseInput = 'border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm font-serif bg-white w-full'
  const disabledInput = 'border border-neutral-100 rounded-lg px-3 py-2 text-sm font-serif bg-neutral-50 w-full text-neutral-700'
  const input = disabled ? disabledInput : baseInput

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {field.label} {field.required && <span className="text-red-500">*</span>}
      </label>

      {/* Description + attachments */}
      {(field.description || (field.description_attachments?.length ?? 0) > 0) && (
        <div className="text-xs text-neutral-500 -mt-0.5 mb-1 space-y-1.5">
          {field.description && (
            <RichTextDisplay content={field.description} className="text-xs text-neutral-500" />
          )}
          {(field.description_attachments ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {field.description_attachments!.map(url => (
                /^.*\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(url) ? (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt="" className="w-20 h-20 object-cover rounded-md border border-neutral-200" />
                  </a>
                ) : (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline text-xs break-all">
                    {url.split('/').pop()}
                  </a>
                )
              ))}
            </div>
          )}
        </div>
      )}

      {/* Field input */}
      {field.type === 'text' && (
        disabled
          ? <div className={input}>{(v as string) || <span className="text-neutral-300">—</span>}</div>
          : <input type="text" placeholder={field.placeholder}
              value={(v as string) ?? ''} onChange={e => set(e.target.value)} className={input} />
      )}

      {field.type === 'textarea' && (
        disabled
          ? <div className={`${input} whitespace-pre-wrap`}>{(v as string) || <span className="text-neutral-300">—</span>}</div>
          : <textarea rows={3} placeholder={field.placeholder}
              value={(v as string) ?? ''} onChange={e => set(e.target.value)} className={`${input} resize-y`} />
      )}

      {field.type === 'number' && (
        disabled
          ? <div className={input}>{v !== undefined && v !== null && v !== '' ? String(v) : <span className="text-neutral-300">—</span>}</div>
          : <input type="number"
              value={(v as number | string) ?? ''} onChange={e => set(e.target.value === '' ? '' : Number(e.target.value))} className={input} />
      )}

      {field.type === 'date' && (
        disabled
          ? <div className={input}>{(v as string) ? new Date(v as string).toLocaleDateString('vi') : <span className="text-neutral-300">—</span>}</div>
          : <input type="date"
              value={(v as string) ?? ''} onChange={e => set(e.target.value)} className={input} />
      )}

      {field.type === 'select' && (
        disabled
          ? <div className={input}>{(v as string) || <span className="text-neutral-300">—</span>}</div>
          : (
            <div className="relative">
              <select
                value={(v as string) ?? ''}
                onChange={e => set(e.target.value)}
                className={`${input} appearance-none pr-7`}
              >
                <option value="">— Chọn —</option>
                {(field.options ?? []).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                {field.allow_other && <option value={OTHER_MARKER}>Khác (ghi rõ)…</option>}
              </select>
              <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            </div>
          )
      )}

      {field.type === 'radio' && (
        <div className="space-y-1">
          {(field.options ?? []).map(opt => (
            <label key={opt} className={`flex items-center gap-2 text-sm text-neutral-700 ${disabled ? '' : 'cursor-pointer'}`}>
              <input type="radio" name={field.id} value={opt}
                checked={v === opt} onChange={() => set(opt)}
                disabled={disabled}
                className="accent-primary-600" />
              {opt}
            </label>
          ))}
          {field.allow_other && (
            <label className={`flex items-center gap-2 text-sm text-neutral-700 ${disabled ? '' : 'cursor-pointer'}`}>
              <input type="radio" name={field.id} value={OTHER_MARKER}
                checked={v === OTHER_MARKER} onChange={() => set(OTHER_MARKER)}
                disabled={disabled}
                className="accent-primary-600" />
              Khác (ghi rõ)…
            </label>
          )}
        </div>
      )}

      {field.type === 'multi_select' && (
        <div className="space-y-1">
          {(field.options ?? []).map(opt => {
            const arr = Array.isArray(v) ? (v as string[]) : []
            const checked = arr.includes(opt)
            return (
              <label key={opt} className={`flex items-center gap-2 text-sm text-neutral-700 ${disabled ? '' : 'cursor-pointer'}`}>
                <input type="checkbox" checked={checked}
                  onChange={() => set(checked ? arr.filter(x => x !== opt) : [...arr, opt])}
                  disabled={disabled}
                  className="accent-primary-600" />
                {opt}
              </label>
            )
          })}
          {field.allow_other && (() => {
            const arr = Array.isArray(v) ? (v as string[]) : []
            const checked = arr.includes(OTHER_MARKER)
            return (
              <label className={`flex items-center gap-2 text-sm text-neutral-700 ${disabled ? '' : 'cursor-pointer'}`}>
                <input type="checkbox" checked={checked}
                  onChange={() => set(checked ? arr.filter(x => x !== OTHER_MARKER) : [...arr, OTHER_MARKER])}
                  disabled={disabled}
                  className="accent-primary-600" />
                Khác (ghi rõ)…
              </label>
            )
          })()}
        </div>
      )}

      {field.type === 'checkbox' && (
        <label className={`flex items-center gap-2 text-sm text-neutral-700 ${disabled ? '' : 'cursor-pointer'}`}>
          <input type="checkbox"
            checked={!!v} onChange={e => set(e.target.checked)}
            disabled={disabled}
            className="accent-primary-600" />
          {field.label}
        </label>
      )}

      {showOther && (
        disabled
          ? <div className={`${disabledInput} mt-1`}>{otherText || <span className="text-neutral-300">—</span>}</div>
          : <input
              type="text"
              placeholder="Nhập nội dung khác…"
              value={otherText}
              onChange={e => setOther(e.target.value)}
              className={`${input} mt-1`}
            />
      )}

      {/* Comment box */}
      {field.comment_box && (
        <CommentBox
          fieldId={field.id}
          value={answers.comments[field.id] ?? { text: '', attachments: [] }}
          onChange={cv =>
            setAnswers({ ...answers, comments: { ...answers.comments, [field.id]: cv } })
          }
          disabled={disabled}
        />
      )}

      {errorMessage && <p className="text-xs text-red-500 mt-0.5">{errorMessage}</p>}
    </div>
  )
}

// ─── Wrapper component (renders all fields for a template) ────────────────────

interface FormFieldsProps {
  template: FormTemplate
  answers: Answers
  setAnswers: (next: Answers) => void
  errors?: Record<string, string>
  disabled?: boolean
  /** When provided, applies workflow fill rules (fill_at_step_id, fill_by_role). */
  runContext?: FormRunContext
}

export default function FormFields({
  template, answers, setAnswers, errors, disabled, runContext,
}: FormFieldsProps) {
  return (
    <div className="space-y-4">
      {template.fields.map(field => (
        <FieldBlock
          key={field.id}
          field={field}
          answers={answers}
          setAnswers={setAnswers}
          errorMessage={errors?.[field.id]}
          disabled={disabled}
          runContext={runContext}
        />
      ))}
    </div>
  )
}
