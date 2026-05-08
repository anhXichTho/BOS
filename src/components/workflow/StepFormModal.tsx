import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import RichTextEditor from '../ui/RichTextEditor'
import RichTextDisplay from '../ui/RichTextDisplay'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { computeFieldMode, type FormRunContext } from '../forms/FormFields'
import type { FormTemplate, FormField, FormSubmission } from '../../types'

const OTHER_MARKER = '__OTHER__'

interface CommentValue { text: string; attachments: string[] }
interface Answers {
  values: Record<string, unknown>
  other: Record<string, string>
  comments: Record<string, CommentValue>
}

const empty = (): Answers => ({ values: {}, other: {}, comments: {} })

interface Props {
  open: boolean
  template: FormTemplate
  existingSubmissionId: string | null
  projectId: string | null
  readOnly: boolean
  onClose: () => void
  onSubmitted: (submissionId: string) => void
  // ─── Workflow run context (Phase D) ─────────────────────────────────────
  /** workflow_runs.id — when set, persists with context_type='workflow_run'. */
  runId?: string | null
  /** workflow_run_steps.id of the currently-running step (audit). */
  runStepId?: string | null
  /** Field-level fill rule context (passed into FieldBlock gating). */
  runContext?: FormRunContext
}

/**
 * Renders a form fill modal scoped to a workflow step.
 *
 * - Standalone (runId not set): inserts a new form_submissions row with
 *   context_type='project' or 'standalone'. Existing behaviour.
 * - Workflow-run (runId set): UPSERTs a single row per (run, template). The
 *   first step that fills the form INSERTs; later steps that reference the
 *   same template UPDATE the same row, merging answers. `last_updated_by_step_id`
 *   tracks audit trail. Field-level gating via `runContext` controls which
 *   fields the current user can edit at this step.
 */
export default function StepFormModal({
  open, template, existingSubmissionId, projectId, readOnly, onClose, onSubmitted,
  runId, runStepId, runContext,
}: Props) {
  const { user } = useAuth()
  const { success, error: toastError } = useToast()
  const [answers, setAnswers] = useState<Answers>(empty)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // Load existing submission when re-opening
  const { data: existing } = useQuery({
    queryKey: ['form-submission', existingSubmissionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('form_submissions')
        .select('*')
        .eq('id', existingSubmissionId!)
        .maybeSingle()
      if (error) throw error
      return data as FormSubmission | null
    },
    enabled: !!existingSubmissionId && open,
  })

  useEffect(() => {
    if (!open) return
    if (existing) {
      const data = existing.data as Record<string, unknown>
      const comments = (data.__comments ?? {}) as Record<string, CommentValue>
      const values: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(data)) if (k !== '__comments') values[k] = v
      setAnswers({ values, other: {}, comments })
    } else {
      setAnswers(empty())
    }
    setErrors({})
  }, [existing, open])

  function evaluateCondition(field: FormField, a: Answers): boolean {
    if (!field.condition) return true
    const { field_id, operator, value } = field.condition
    const raw = a.values[field_id]
    const actual = Array.isArray(raw) ? raw.join(',') : String(raw ?? '')
    if (operator === 'eq')  return actual === value || (Array.isArray(raw) && raw.includes(value))
    if (operator === 'neq') return actual !== value
    if (operator === 'gt')  return Number(actual) >  Number(value)
    if (operator === 'lt')  return Number(actual) <  Number(value)
    return true
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {}
    for (const f of template.fields) {
      if (!evaluateCondition(f, answers)) continue
      const v: unknown = answers.values[f.id]
      const otherText = answers.other[f.id] ?? ''
      const isEmpty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
      const isOtherMarker = v === OTHER_MARKER

      if ((f.type === 'select' || f.type === 'radio') && isOtherMarker && !otherText.trim()) {
        errs[f.id] = 'Điền nội dung cho "Khác"'
        continue
      }
      if (f.type === 'multi_select' && Array.isArray(v) && v.includes(OTHER_MARKER) && !otherText.trim()) {
        errs[f.id] = 'Điền nội dung cho "Khác"'
        continue
      }
      if (f.required && isEmpty && !(isOtherMarker && otherText.trim())) {
        errs[f.id] = 'Bắt buộc'
        continue
      }
      if (f.type === 'number' && v !== '' && v !== undefined && v !== null) {
        const n = Number(v)
        if (f.validation?.min !== undefined && n < f.validation.min) { errs[f.id] = `Tối thiểu ${f.validation.min}`; continue }
        if (f.validation?.max !== undefined && n > f.validation.max) { errs[f.id] = `Tối đa ${f.validation.max}`; continue }
      }
    }
    return errs
  }

  async function submit() {
    if (readOnly) { onClose(); return }
    if (!user) return
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setSubmitting(true)
    try {
      // 1. Materialize field values (handle "Khác" markers).
      const materialized: Record<string, unknown> = {}
      for (const f of template.fields) {
        // Skip fields that are hidden for this step/user — do NOT overwrite
        // their values when other fields are submitted progressively.
        const v = answers.values[f.id]
        if (runContext) {
          const mode = computeFieldMode(f, runContext, v)
          if (mode === 'hidden' || mode === 'readonly') continue
        }
        const other = answers.other[f.id]
        if ((f.type === 'select' || f.type === 'radio') && v === OTHER_MARKER) {
          materialized[f.id] = other ? `Khác: ${other}` : 'Khác'
        } else if (f.type === 'multi_select' && Array.isArray(v)) {
          materialized[f.id] = (v as string[]).map(x => x === OTHER_MARKER ? (other ? `Khác: ${other}` : 'Khác') : x)
        } else {
          materialized[f.id] = v
        }
      }

      // 2. Workflow-run UPSERT path: 1 row per (run, template), merged.
      if (runId) {
        const { data: existingRow, error: lookupErr } = await supabase
          .from('form_submissions')
          .select('id, data, template_snapshot')
          .eq('context_type', 'workflow_run')
          .eq('context_id', runId)
          .eq('template_id', template.id)
          .maybeSingle()
        if (lookupErr) throw lookupErr

        if (existingRow) {
          const prev = (existingRow.data ?? {}) as Record<string, unknown>
          const prevComments = (prev.__comments ?? {}) as Record<string, CommentValue>
          const mergedData: Record<string, unknown> = {
            ...prev,
            ...materialized,
            __comments: { ...prevComments, ...answers.comments },
          }
          const { error: updErr } = await supabase
            .from('form_submissions')
            .update({
              data: mergedData,
              template_snapshot: template.fields,    // refresh snapshot in case fields changed
              submitted_at: new Date().toISOString(),
              last_updated_by_step_id: runStepId ?? null,
            })
            .eq('id', existingRow.id)
          if (updErr) throw updErr
          success(`Đã cập nhật ${template.name}`)
          onSubmitted(existingRow.id)
          return
        }

        // No existing row → INSERT with workflow_run context.
        const data: Record<string, unknown> = { ...materialized }
        if (Object.keys(answers.comments).length > 0) data.__comments = answers.comments
        const { data: submission, error } = await supabase
          .from('form_submissions')
          .insert({
            template_id:       template.id,
            template_name:     template.name,
            template_snapshot: template.fields,
            submitted_by:      user.id,
            context_type:      'workflow_run',
            context_id:        runId,
            data,
            last_updated_by_step_id: runStepId ?? null,
          })
          .select()
          .single()
        if (error) throw error
        success(`Đã nộp ${template.name}`)
        onSubmitted(submission.id)
        return
      }

      // 3. Legacy path (standalone or project context) — unchanged INSERT.
      const data: Record<string, unknown> = { ...materialized }
      if (Object.keys(answers.comments).length > 0) data.__comments = answers.comments
      const { data: submission, error } = await supabase
        .from('form_submissions')
        .insert({
          template_id:       template.id,
          template_name:     template.name,
          template_snapshot: template.fields,
          submitted_by:      user.id,
          context_type:      projectId ? 'project' : 'standalone',
          context_id:        projectId,
          data,
        })
        .select()
        .single()
      if (error) throw error

      success(`Đã nộp ${template.name}`)
      onSubmitted(submission.id)
    } catch (err: any) {
      console.error(err)
      toastError(err?.message ?? 'Không thể gửi form')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={template.name}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{readOnly ? 'Đóng' : 'Huỷ'}</Button>
          {!readOnly && (
            <Button onClick={submit} disabled={submitting}>
              {submitting ? 'Đang gửi…' : existingSubmissionId ? 'Lưu lại (gửi mới)' : 'Hoàn thành'}
            </Button>
          )}
        </>
      }
    >
      {template.description && (
        <p className="text-xs text-neutral-500 mb-3">{template.description}</p>
      )}
      <div className="space-y-4">
        {template.fields.map(field => (
          <FieldBlock
            key={field.id}
            field={field}
            answers={answers}
            setAnswers={setAnswers}
            evaluateCondition={evaluateCondition}
            errorMessage={errors[field.id]}
            readOnly={readOnly}
            runContext={runContext}
          />
        ))}
      </div>
    </Modal>
  )
}

// ─── Field renderer (mirrors FormFillModal — same behaviour, reusable) ───────

function FieldBlock({
  field, answers, setAnswers, evaluateCondition, errorMessage, readOnly: rawReadOnly, runContext,
}: {
  field: FormField
  answers: Answers
  setAnswers: (a: Answers) => void
  evaluateCondition: (f: FormField, a: Answers) => boolean
  errorMessage?: string
  readOnly: boolean
  runContext?: FormRunContext
}) {
  if (!evaluateCondition(field, answers)) return null

  const v = answers.values[field.id]
  // Phase D — workflow fill rule gating: hidden = skip render, readonly = force readOnly.
  const mode = computeFieldMode(field, runContext, v)
  if (mode === 'hidden') return null
  /** Effective read-only state: caller-provided OR field-level readonly via fill rules. */
  const readOnly = rawReadOnly || mode === 'readonly'
  const effectiveReadOnly = readOnly

  const otherText = answers.other[field.id] ?? ''
  const showOther =
    field.allow_other &&
    ((['select', 'radio'].includes(field.type) && v === OTHER_MARKER) ||
     (field.type === 'multi_select' && Array.isArray(v) && v.includes(OTHER_MARKER)))

  function set(value: unknown) {
    if (effectiveReadOnly) return
    setAnswers({ ...answers, values: { ...answers.values, [field.id]: value } })
  }
  function setOther(text: string) {
    if (effectiveReadOnly) return
    setAnswers({ ...answers, other: { ...answers.other, [field.id]: text } })
  }

  const baseInput = 'border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm font-serif bg-white w-full disabled:bg-neutral-50 disabled:text-neutral-500'

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {field.label} {field.required && <span className="text-red-500">*</span>}
      </label>

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

      {field.type === 'text' && (
        <input type="text" placeholder={field.placeholder} disabled={readOnly}
          value={(v as string) ?? ''} onChange={e => set(e.target.value)} className={baseInput} />
      )}
      {field.type === 'textarea' && (
        <textarea rows={3} placeholder={field.placeholder} disabled={readOnly}
          value={(v as string) ?? ''} onChange={e => set(e.target.value)} className={`${baseInput} resize-y`} />
      )}
      {field.type === 'number' && (
        <input type="number" disabled={readOnly}
          value={(v as number | string) ?? ''} onChange={e => set(e.target.value === '' ? '' : Number(e.target.value))} className={baseInput} />
      )}
      {field.type === 'date' && (
        <input type="date" disabled={readOnly}
          value={(v as string) ?? ''} onChange={e => set(e.target.value)} className={baseInput} />
      )}
      {field.type === 'select' && (
        <div className="relative">
          <select value={(v as string) ?? ''} onChange={e => set(e.target.value)} disabled={readOnly}
            className={`${baseInput} appearance-none pr-7`}>
            <option value="">— Chọn —</option>
            {(field.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
            {field.allow_other && <option value={OTHER_MARKER}>Khác (ghi rõ)…</option>}
          </select>
          <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
        </div>
      )}
      {field.type === 'radio' && (
        <div className="space-y-1">
          {(field.options ?? []).map(opt => (
            <label key={opt} className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
              <input type="radio" name={field.id} value={opt} disabled={readOnly}
                checked={v === opt} onChange={() => set(opt)} className="accent-primary-600" />
              {opt}
            </label>
          ))}
          {field.allow_other && (
            <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
              <input type="radio" name={field.id} value={OTHER_MARKER} disabled={readOnly}
                checked={v === OTHER_MARKER} onChange={() => set(OTHER_MARKER)} className="accent-primary-600" />
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
              <label key={opt} className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
                <input type="checkbox" checked={checked} disabled={readOnly}
                  onChange={() => set(checked ? arr.filter(x => x !== opt) : [...arr, opt])}
                  className="accent-primary-600" />
                {opt}
              </label>
            )
          })}
          {field.allow_other && (() => {
            const arr = Array.isArray(v) ? (v as string[]) : []
            const checked = arr.includes(OTHER_MARKER)
            return (
              <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
                <input type="checkbox" checked={checked} disabled={readOnly}
                  onChange={() => set(checked ? arr.filter(x => x !== OTHER_MARKER) : [...arr, OTHER_MARKER])}
                  className="accent-primary-600" />
                Khác (ghi rõ)…
              </label>
            )
          })()}
        </div>
      )}
      {field.type === 'checkbox' && (
        <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
          <input type="checkbox" disabled={readOnly}
            checked={!!v} onChange={e => set(e.target.checked)} className="accent-primary-600" />
          {field.label}
        </label>
      )}

      {showOther && (
        <input type="text" placeholder="Nhập nội dung khác…" disabled={readOnly}
          value={otherText} onChange={e => setOther(e.target.value)} className={`${baseInput} mt-1`} />
      )}

      {field.comment_box && (
        <CommentBox
          fieldId={field.id}
          readOnly={readOnly}
          value={answers.comments[field.id] ?? { text: '', attachments: [] }}
          onChange={cv => setAnswers({ ...answers, comments: { ...answers.comments, [field.id]: cv } })}
        />
      )}

      {errorMessage && <p className="text-xs text-red-500 mt-0.5">{errorMessage}</p>}
    </div>
  )
}

function CommentBox({
  fieldId, value, onChange, readOnly,
}: {
  fieldId: string
  value: CommentValue
  onChange: (v: CommentValue) => void
  readOnly: boolean
}) {
  if (readOnly) {
    if (!value.text) return null
    return (
      <div className="bg-neutral-25 border border-neutral-100 rounded-lg p-2 mt-1">
        <RichTextDisplay content={value.text} className="text-xs text-neutral-700" />
      </div>
    )
  }
  return (
    <div className="bg-neutral-25 border border-neutral-100 rounded-lg p-2 mt-1">
      <RichTextEditor
        value={value.text}
        onChange={t => onChange({ ...value, text: t })}
        placeholder="Ghi chú thêm cho câu này — rich text + paste ảnh…"
        uploadPrefix={`forms/${fieldId}`}
        compact
        minHeight={48}
      />
    </div>
  )
}
