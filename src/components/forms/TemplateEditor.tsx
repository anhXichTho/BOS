import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Plus, Trash2, GripVertical, ChevronDown, Image as ImageIcon, FileJson, X } from 'lucide-react'
import Button from '../ui/Button'
import ChipInput from '../ui/ChipInput'
import Modal from '../ui/Modal'
import RichTextEditor from '../ui/RichTextEditor'
import { useToast } from '../ui/Toast'
import { uploadAttachment } from '../../lib/uploadAttachment'
import type { FormField, FormTemplate, FieldType, Profile } from '../../types'

/** Compact step shape passed from WorkflowEditPage when this editor is opened in workflow context. */
export interface WorkflowStepRef {
  id: string
  title: string
  order_index: number
  requires_approval?: boolean
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text',         label: 'Văn bản' },
  { value: 'textarea',     label: 'Đoạn văn' },
  { value: 'number',       label: 'Số' },
  { value: 'date',         label: 'Ngày' },
  { value: 'select',       label: 'Dropdown (chọn 1)' },
  { value: 'radio',        label: 'Radio (chọn 1)' },
  { value: 'multi_select', label: 'Multi-select (chọn nhiều)' },
  { value: 'checkbox',     label: 'Checkbox (yes/no)' },
]

const OPTION_TYPES: FieldType[] = ['select', 'radio', 'multi_select']

function newField(): FormField {
  return {
    id: crypto.randomUUID(),
    label: '',
    description: '',
    description_attachments: [],
    type: 'text',
    required: false,
    placeholder: '',
    options: [],
    allow_other: false,
    comment_box: false,
    condition: null,
  }
}

interface Props {
  template?: FormTemplate
  onSave: (data: { name: string; description: string; fields: FormField[]; summary_field_ids: string[] }) => Promise<void>
  onCancel: () => void

  // ─── Workflow context (optional) ───────────────────────────────────────
  // When all three are provided, FieldRow shows the "Quy tắc điền" section
  // (per-field fill_at_step_id + fill_by_role + fill_by_user_id pickers).
  // Standalone use (Settings → Lab → Forms) leaves these undefined → no extra UI.
  /** Steps in the workflow this form is being attached to (DFS order). */
  workflowSteps?: WorkflowStepRef[]
  /** The step id (template-level) this form is being created/edited for. */
  currentWorkflowStepId?: string
  /** Profiles list for the "specific user" picker. */
  workflowUsers?: Profile[]
}

export default function TemplateEditor({
  template, onSave, onCancel,
  workflowSteps, currentWorkflowStepId, workflowUsers,
}: Props) {
  const [fields, setFields] = useState<FormField[]>(template?.fields ?? [newField()])
  const [summaryFieldIds, setSummaryFieldIds] = useState<string[]>(template?.summary_field_ids ?? [])
  const [saving, setSaving] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      name:        template?.name ?? '',
      description: template?.description ?? '',
    },
  })

  async function onSubmit(data: { name: string; description: string }) {
    setSaving(true)
    try {
      // Only persist summary_field_ids that still exist in the current field list.
      const validFieldIds = new Set(fields.map(f => f.id))
      const cleanedSummaryIds = summaryFieldIds.filter(id => validFieldIds.has(id))
      await onSave({ ...data, fields, summary_field_ids: cleanedSummaryIds })
    } finally {
      setSaving(false)
    }
  }

  function addField()                                            { setFields(prev => [...prev, newField()]) }
  function removeField(id: string)                                { setFields(prev => prev.filter(f => f.id !== id)) }
  function updateField(id: string, patch: Partial<FormField>)     { setFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f)) }

  function exportJson() {
    const json = JSON.stringify(fields, null, 2)
    navigator.clipboard.writeText(json)
  }

  function applyJson(json: string) {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) throw new Error('JSON phải là một mảng các trường.')
    // Re-issue ids to avoid collisions
    const cleaned: FormField[] = parsed.map(f => ({
      id: f.id ?? crypto.randomUUID(),
      label: f.label ?? '',
      description: f.description ?? '',
      description_attachments: f.description_attachments ?? [],
      type: (f.type ?? 'text') as FieldType,
      required: !!f.required,
      placeholder: f.placeholder ?? '',
      options: Array.isArray(f.options) ? f.options : [],
      allow_other: !!f.allow_other,
      comment_box: !!f.comment_box,
      validation: f.validation ?? undefined,
      condition: f.condition ?? null,
    }))
    setFields(cleaned)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Meta */}
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Tên form *
          </label>
          <input
            {...register('name', { required: true })}
            placeholder="VD: Báo cáo tiến độ tuần"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm font-serif bg-white w-full"
          />
          {errors.name && <p className="text-xs text-red-500 mt-1">Bắt buộc</p>}
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Mô tả
          </label>
          <input
            {...register('description')}
            placeholder="Mô tả ngắn về mục đích của form"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm font-serif bg-white w-full"
          />
        </div>
      </div>

      {/* Fields */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Các trường ({fields.length})
          </label>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => setJsonOpen(true)}>
              <FileJson size={12} /> JSON
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={addField}>
              <Plus size={12} /> Thêm trường
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {fields.map((field, idx) => (
            <FieldRow
              key={field.id}
              field={field}
              index={idx}
              allFields={fields}
              onChange={patch => updateField(field.id, patch)}
              onRemove={() => removeField(field.id)}
              isSummary={summaryFieldIds.includes(field.id)}
              onToggleSummary={() => {
                setSummaryFieldIds(prev =>
                  prev.includes(field.id)
                    ? prev.filter(id => id !== field.id)
                    : prev.length < 3 ? [...prev, field.id] : prev
                )
              }}
              summaryCount={summaryFieldIds.length}
              workflowSteps={workflowSteps}
              currentWorkflowStepId={currentWorkflowStepId}
              workflowUsers={workflowUsers}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
        <Button type="button" variant="secondary" onClick={onCancel}>Huỷ</Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Đang lưu…' : 'Lưu template'}
        </Button>
      </div>

      <JsonModal
        open={jsonOpen}
        currentJson={JSON.stringify(fields, null, 2)}
        onClose={() => setJsonOpen(false)}
        onApply={json => { applyJson(json); setJsonOpen(false) }}
        onCopy={exportJson}
      />
    </form>
  )
}

// ─── JSON import / export modal ──────────────────────────────────────────────

function JsonModal({
  open, currentJson, onClose, onApply, onCopy,
}: {
  open: boolean
  currentJson: string
  onClose: () => void
  onApply: (json: string) => void
  onCopy: () => void
}) {
  const [draft, setDraft] = useState('')
  const [err, setErr]     = useState<string | null>(null)
  const { success } = useToast()

  function handleApply() {
    try {
      onApply(draft || currentJson)
      setErr(null)
      setDraft('')
    } catch (e: any) {
      setErr(e?.message ?? 'JSON không hợp lệ')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import / Export JSON"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => { onCopy(); success('Đã copy JSON hiện tại') }}>
            Copy hiện tại
          </Button>
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
          <Button onClick={handleApply}>Apply</Button>
        </>
      }
    >
      <div className="space-y-2">
        <p className="text-xs text-neutral-500">
          Dán JSON dạng <code className="font-mono bg-neutral-100 px-1 rounded">[ {'{...}'} , {'{...}'} ]</code> để
          tạo nhanh tất cả các trường. Để trống để giữ nguyên.
        </p>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={14}
          placeholder={currentJson}
          className="w-full font-mono text-xs border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 bg-white resize-y"
        />
        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">{err}</p>}
      </div>
    </Modal>
  )
}

// ─── Field row ───────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: FormField
  index: number
  allFields: FormField[]
  onChange: (patch: Partial<FormField>) => void
  onRemove: () => void
  isSummary: boolean
  onToggleSummary: () => void
  summaryCount: number
  // Workflow-context props (optional — when undefined, fill-rules UI is hidden)
  workflowSteps?: WorkflowStepRef[]
  currentWorkflowStepId?: string
  workflowUsers?: Profile[]
}

function FieldRow({
  field, allFields, onChange, onRemove, isSummary, onToggleSummary, summaryCount,
  workflowSteps, currentWorkflowStepId, workflowUsers,
}: FieldRowProps) {
  const otherFields = allFields.filter(f => f.id !== field.id)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const { error: toastError } = useToast()

  async function handleAttachFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const urls: string[] = []
      for (const f of Array.from(files)) {
        urls.push(await uploadAttachment(f, 'forms'))
      }
      onChange({ description_attachments: [...(field.description_attachments ?? []), ...urls] })
    } catch (err: any) {
      toastError(err?.message ?? 'Không thể upload')
    } finally {
      setUploading(false)
    }
  }

  function removeAttachment(url: string) {
    onChange({ description_attachments: (field.description_attachments ?? []).filter(u => u !== url) })
  }

  return (
    <div className="bg-neutral-25 border border-neutral-100 rounded-lg p-3 space-y-3">
      <div className="flex items-start gap-2">
        <GripVertical size={14} className="text-neutral-300 mt-2 shrink-0 cursor-grab" />

        <div className="flex-1 grid grid-cols-2 gap-2">
          <input
            placeholder="Nhãn câu hỏi *"
            value={field.label}
            onChange={e => onChange({ label: e.target.value })}
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-2 py-1.5 text-sm font-serif bg-white col-span-2"
          />

          {/* Type */}
          <div className="relative">
            <select
              value={field.type}
              onChange={e => onChange({ type: e.target.value as FieldType })}
              className="appearance-none w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm focus:border-primary-400 focus:outline-none bg-white pr-6"
            >
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          </div>

          {/* Placeholder */}
          {(field.type === 'text' || field.type === 'textarea') && (
            <input
              placeholder="Placeholder (tuỳ chọn)"
              value={field.placeholder ?? ''}
              onChange={e => onChange({ placeholder: e.target.value })}
              className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-2 py-1.5 text-sm font-serif bg-white"
            />
          )}

          {/* Validation for number */}
          {field.type === 'number' && (
            <div className="flex gap-1">
              <input
                type="number"
                placeholder="Min"
                value={field.validation?.min ?? ''}
                onChange={e => onChange({ validation: { ...field.validation, min: e.target.value === '' ? undefined : Number(e.target.value) } })}
                className="border border-neutral-200 rounded-lg px-2 py-1.5 text-sm bg-white w-full"
              />
              <input
                type="number"
                placeholder="Max"
                value={field.validation?.max ?? ''}
                onChange={e => onChange({ validation: { ...field.validation, max: e.target.value === '' ? undefined : Number(e.target.value) } })}
                className="border border-neutral-200 rounded-lg px-2 py-1.5 text-sm bg-white w-full"
              />
            </div>
          )}
        </div>

        <button type="button" onClick={onRemove} className="text-neutral-300 hover:text-red-500 transition-colors mt-1.5 shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Options as chips */}
      {OPTION_TYPES.includes(field.type) && (
        <div className="pl-6">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">Lựa chọn</p>
          <ChipInput
            values={field.options ?? []}
            onChange={next => onChange({ options: next })}
            placeholder="Thêm lựa chọn… (Enter)"
          />
        </div>
      )}

      {/* Description with rich text */}
      <div className="pl-6">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">
          Mô tả / Ghi chú
        </p>
        <RichTextEditor
          value={field.description ?? ''}
          onChange={v => onChange({ description: v })}
          placeholder="Hướng dẫn thêm cho người trả lời… (rich text + paste ảnh)"
          uploadPrefix="forms"
          minHeight={48}
          compact
        />
        {(field.description_attachments ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {field.description_attachments!.map(url => (
              <div key={url} className="relative group">
                {/^.*\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(url) ? (
                  <img src={url} alt="" className="w-16 h-16 object-cover rounded-md border border-neutral-200" />
                ) : (
                  <a href={url} target="_blank" rel="noreferrer" className="block w-16 h-16 rounded-md border border-neutral-200 bg-neutral-50 text-[9px] text-neutral-500 flex items-center justify-center text-center p-1 break-all">
                    {url.split('/').pop()?.slice(0, 14)}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(url)}
                  className="absolute -top-1 -right-1 bg-white border border-neutral-200 rounded-full p-0.5 text-neutral-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-primary-600 disabled:opacity-50"
          >
            <ImageIcon size={11} /> {uploading ? 'Đang upload…' : 'Đính kèm file ngoài (không phải ảnh inline)'}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => { handleAttachFiles(e.target.files); e.target.value = '' }}
          />
        </div>
      </div>

      {/* Required + Other + CommentBox + Condition */}
      <div className="pl-6 flex items-center flex-wrap gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
          <input
            type="checkbox"
            checked={field.required}
            onChange={e => onChange({ required: e.target.checked })}
            className="accent-primary-600"
          />
          Bắt buộc
        </label>

        {OPTION_TYPES.includes(field.type) && (
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
            <input
              type="checkbox"
              checked={!!field.allow_other}
              onChange={e => onChange({ allow_other: e.target.checked })}
              className="accent-primary-600"
            />
            Cho phép "Khác"
          </label>
        )}

        <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
          <input
            type="checkbox"
            checked={!!field.comment_box}
            onChange={e => onChange({ comment_box: e.target.checked })}
            className="accent-primary-600"
          />
          Có ô comment + đính kèm
        </label>

        {/* Chat-card summary field toggle (max 3 per template) */}
        <label
          className={`flex items-center gap-1.5 text-xs cursor-pointer ${
            !isSummary && summaryCount >= 3 ? 'opacity-40 cursor-not-allowed' : 'text-neutral-600'
          }`}
          title={!isSummary && summaryCount >= 3 ? 'Đã đủ 3 trường tóm tắt' : 'Hiển thị trong chat card preview'}
        >
          <input
            type="checkbox"
            checked={isSummary}
            onChange={onToggleSummary}
            disabled={!isSummary && summaryCount >= 3}
            className="accent-primary-600"
          />
          Hiện trong chat card{isSummary ? ' ✓' : ''}
        </label>

        {otherFields.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 flex-wrap">
            <span>Hiện khi</span>
            <select
              value={field.condition?.field_id ?? ''}
              onChange={e => onChange({
                condition: e.target.value
                  ? { field_id: e.target.value, operator: 'eq', value: '' }
                  : null,
              })}
              className="border border-neutral-200 rounded-lg px-1.5 py-0.5 text-xs bg-white"
            >
              <option value="">(luôn hiện)</option>
              {otherFields.map(f => <option key={f.id} value={f.id}>{f.label || f.id}</option>)}
            </select>
            {field.condition && (
              <>
                <select
                  value={field.condition.operator}
                  onChange={e => onChange({ condition: { ...field.condition!, operator: e.target.value as any } })}
                  className="border border-neutral-200 rounded-lg px-1.5 py-0.5 text-xs bg-white"
                >
                  <option value="eq">=</option>
                  <option value="neq">≠</option>
                </select>
                <input
                  value={field.condition.value}
                  onChange={e => onChange({ condition: { ...field.condition!, value: e.target.value } })}
                  placeholder="giá trị"
                  className="border border-neutral-200 rounded-lg px-1.5 py-0.5 text-xs bg-white w-20"
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* Workflow fill rules — only when opened from a workflow context */}
      {workflowSteps && currentWorkflowStepId && (
        <FillRulesSection
          field={field}
          onChange={onChange}
          workflowSteps={workflowSteps}
          currentWorkflowStepId={currentWorkflowStepId}
          workflowUsers={workflowUsers ?? []}
        />
      )}

      {/* Inheritance lineage badge */}
      {field.inherited_from_field_id && (
        <div className="pl-6 text-[10px] text-primary-600 italic">
          ↪ Kế thừa từ form bước trước
        </div>
      )}
    </div>
  )
}

// ─── Workflow fill rules section ─────────────────────────────────────────────
// Shows: who fills this field (runner/approver/specific user) and at which step.
// "Fill at later step" dropdown is restricted to steps with order_index >=
// currentStep — fields cannot point backwards.

function FillRulesSection({
  field, onChange, workflowSteps, currentWorkflowStepId, workflowUsers,
}: {
  field: FormField
  onChange: (patch: Partial<FormField>) => void
  workflowSteps: WorkflowStepRef[]
  currentWorkflowStepId: string
  workflowUsers: Profile[]
}) {
  const currentStep = workflowSteps.find(s => s.id === currentWorkflowStepId)
  const currentOrderIndex = currentStep?.order_index ?? 0
  const eligibleSteps = workflowSteps.filter(s => s.order_index >= currentOrderIndex)

  const role: NonNullable<FormField['fill_by_role']> = field.fill_by_role ?? 'runner'
  const fillStep = field.fill_at_step_id ?? null

  // Defensive: detect a fill_at_step_id pointing to a step that no longer exists.
  const stalePointer = !!fillStep && !workflowSteps.some(s => s.id === fillStep)

  // Soft warning: approver-fill on a step that doesn't require approval.
  const targetStep = workflowSteps.find(s => s.id === (fillStep ?? currentWorkflowStepId))
  const approverWithoutApproval = role === 'approver' && targetStep && !targetStep.requires_approval

  return (
    <div className="pl-6">
      <details className="group">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-neutral-500 inline-flex items-center gap-1 select-none">
          <ChevronDown size={10} className="transition-transform group-open:rotate-0 -rotate-90" />
          Quy tắc điền
          {(role !== 'runner' || (fillStep && fillStep !== currentWorkflowStepId)) && (
            <span className="ml-1 text-[9px] bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded-full font-medium normal-case tracking-normal">
              Tuỳ chỉnh
            </span>
          )}
        </summary>

        <div className="mt-2 space-y-2 text-xs text-neutral-700">
          {/* Người điền */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-neutral-500 w-16 shrink-0">Người điền:</span>
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={role === 'runner'}
                onChange={() => onChange({ fill_by_role: 'runner', fill_by_user_id: null })}
                className="accent-primary-600"
              />
              <span>Người chạy</span>
            </label>
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={role === 'approver'}
                onChange={() => onChange({ fill_by_role: 'approver', fill_by_user_id: null })}
                className="accent-primary-600"
              />
              <span>Người duyệt</span>
            </label>
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={role === 'specific_user'}
                onChange={() => onChange({ fill_by_role: 'specific_user' })}
                className="accent-primary-600"
              />
              <span>Người cụ thể</span>
            </label>
            {role === 'specific_user' && (
              <select
                value={field.fill_by_user_id ?? ''}
                onChange={e => onChange({ fill_by_user_id: e.target.value || null })}
                className="border border-neutral-200 rounded px-1.5 py-0.5 text-[11px] bg-white"
              >
                <option value="">— Chọn người —</option>
                {workflowUsers.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Điền tại bước */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-neutral-500 w-16 shrink-0">Điền tại:</span>
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={!fillStep || fillStep === currentWorkflowStepId}
                onChange={() => onChange({ fill_at_step_id: null })}
                className="accent-primary-600"
              />
              <span>Bước hiện tại</span>
            </label>
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={!!fillStep && fillStep !== currentWorkflowStepId}
                onChange={() => {
                  // Default to first eligible step that is not current
                  const next = eligibleSteps.find(s => s.id !== currentWorkflowStepId)?.id ?? null
                  onChange({ fill_at_step_id: next })
                }}
                className="accent-primary-600"
              />
              <span>Bước khác</span>
            </label>
            {fillStep && fillStep !== currentWorkflowStepId && (
              <select
                value={fillStep}
                onChange={e => onChange({ fill_at_step_id: e.target.value || null })}
                className="border border-neutral-200 rounded px-1.5 py-0.5 text-[11px] bg-white"
              >
                {eligibleSteps
                  .filter(s => s.id !== currentWorkflowStepId)
                  .map(s => (
                    <option key={s.id} value={s.id}>{s.title || '(chưa đặt tên)'}</option>
                  ))}
              </select>
            )}
          </div>

          {/* Inline warnings */}
          {stalePointer && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
              ⚠ Bước được trỏ tới đã bị xoá. Field sẽ rơi về bước hiện tại khi chạy.
            </p>
          )}
          {approverWithoutApproval && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
              ⚠ Bước "{targetStep?.title}" chưa bật yêu cầu duyệt — field này sẽ không có người điền.
            </p>
          )}
        </div>
      </details>
    </div>
  )
}
