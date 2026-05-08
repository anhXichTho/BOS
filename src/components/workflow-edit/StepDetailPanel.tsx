/**
 * Centre-column detail editor for the currently selected step.
 *
 * Round-4 redesign — reduce cognitive load:
 *  • Title is read-only display text by default; a faded pencil icon next to
 *    it brightens on hover and toggles inline-edit mode.
 *  • Short description sits directly below the title (was: separated by the
 *    type/duration row before).
 *  • Step type uses two segmented toggle buttons (Đơn giản / Chia nhánh)
 *    instead of a dropdown.
 *  • Duration stays on its own row, right-aligned, smaller affordance.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Trash2, Pencil, Check, Eye, HelpCircle, Plus, X, Sparkles } from 'lucide-react'
import StepApprovalSection from './StepApprovalSection'
import StepFormSection from './StepFormSection'
import StepPreviewModal from './StepPreviewModal'
import ConditionExpression from './ConditionExpression'
import type { CondShape } from './ConditionExpression'
import type { StepDraft, BranchConfig, ShowWhen, ConditionCase } from './types'
import type { HelperPanel, FormTemplate, Profile, StepType } from '../../types'

interface Props {
  step: StepDraft
  /** Steps that come before this one in DFS order (for "show when" picker). */
  priorSteps: StepDraft[]
  /** All steps — needed for the form-fill responsibility map (Phase C). */
  allSteps?: StepDraft[]
  helpers: HelperPanel[]
  formTemplates: FormTemplate[]
  profiles: Profile[]
  /** Pre-computed S{N} code for the current step, shown in the header. */
  stepCode?: string
  onUpdate: (id: string, patch: Partial<StepDraft>) => void
  onRemove: (id: string) => void
  onCreateForm: (stepId: string) => void
  /** Highlight a step on the canvas while hovering rows in the field map. */
  onHoverSteps?: (stepIds: string[]) => void
  /** Round-6: open AI assistant focused on this step (Stage 2 / details). */
  onOpenAIForStep?: (sCode: string) => void
  /** Mobile-only: callback to return to the tree view. */
  onBackToTree?: () => void
}

export default memo(function StepDetailPanel({
  step, priorSteps, allSteps, helpers, formTemplates, profiles,
  stepCode,
  onUpdate, onRemove, onCreateForm, onHoverSteps, onOpenAIForStep, onBackToTree,
}: Props) {
  const setTitle       = useCallback((v: string) => onUpdate(step.id, { title: v }), [step.id, onUpdate])
  const setDescription = useCallback((v: string) => onUpdate(step.id, { description: v }), [step.id, onUpdate])

  // Round-5b: show_when uses the new CondShape; legacy fields untouched.
  const setShowWhen = useCallback((next: CondShape | null) => {
    onUpdate(step.id, {
      show_when: next as ShowWhen | null,
      // Mirror to legacy fields for backwards-compat with the runtime that
      // hasn't been ported yet (gotcha #54). Only equality-ish outcome
      // conditions can be expressed in the legacy shape.
      condition_step_id: next?.source_step_id ?? null,
      condition_value:   (next && next.source_kind === 'outcome' && next.operator === '=') ? next.value : null,
    })
  }, [step.id, onUpdate])

  // Branch config helpers
  const setBranchConfig = useCallback((next: BranchConfig | null) => {
    onUpdate(step.id, {
      branch_config: next,
      // Mirror to legacy branch_options for runtime back-compat.
      branch_options: (next?.cases ?? []).map(c => c.label).filter(Boolean),
    })
  }, [step.id, onUpdate])

  // Title inline-edit state. Re-armed whenever a different step is selected.
  const [editingTitle, setEditingTitle] = useState(false)
  useEffect(() => { setEditingTitle(false) }, [step.id])

  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <div className="flex flex-col h-full bg-neutral-25 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-neutral-100 bg-white sticky top-0 z-10">
        {onBackToTree && (
          <button
            type="button"
            onClick={onBackToTree}
            className="md:hidden text-neutral-400 hover:text-neutral-700"
            aria-label="Quay lại danh sách bước"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 inline-flex items-center gap-1.5">
          {stepCode && (
            <span className="font-mono text-[10px] px-1 py-0 bg-neutral-100 text-neutral-700 border border-neutral-200 rounded">
              {stepCode}
            </span>
          )}
          <span>Chi tiết bước</span>
        </span>
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="ml-auto text-[11px] text-neutral-500 hover:text-primary-700 hover:bg-primary-50 inline-flex items-center gap-1 px-2 py-0.5 border border-neutral-200 hover:border-primary-300 rounded transition-colors"
          title="Xem thử người chạy sẽ thấy gì ở bước này"
        >
          <Eye size={11} /> Preview
        </button>
        {onOpenAIForStep && stepCode && (
          <button
            type="button"
            onClick={() => onOpenAIForStep(stepCode)}
            className="text-[11px] text-primary-600 hover:text-primary-800 hover:bg-primary-50 inline-flex items-center gap-1 px-2 py-0.5 border border-primary-200 hover:border-primary-300 rounded transition-colors"
            title="Hỏi AI về bước này"
          >
            <Sparkles size={11} /> AI
          </button>
        )}
        <button
          type="button"
          onClick={() => { if (confirm(`Xoá bước "${step.title || '(chưa đặt tên)'}"?`)) onRemove(step.id) }}
          className="text-[11px] text-neutral-400 hover:text-red-500 inline-flex items-center gap-1"
        >
          <Trash2 size={11} /> Xoá
        </button>
      </div>

      <div className="p-4 sm:p-5 space-y-4 max-w-3xl">
        {/* ── Title (display + hover-pencil → inline edit) ── */}
        <section className="group">
          {!editingTitle ? (
            <div className="flex items-baseline gap-2">
              <h2
                className="text-base sm:text-lg font-serif font-semibold text-neutral-800 leading-snug truncate cursor-text"
                onClick={() => setEditingTitle(true)}
                title="Bấm để chỉnh sửa"
              >
                {step.title || <span className="italic text-neutral-400">(chưa đặt tên)</span>}
              </h2>
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                className="text-neutral-400 opacity-30 group-hover:opacity-100 hover:text-primary-600 transition-opacity p-1"
                title="Chỉnh sửa tên"
                aria-label="Chỉnh sửa tên"
              >
                <Pencil size={13} />
              </button>
            </div>
          ) : (
            <input
              autoFocus
              defaultValue={step.title}
              placeholder="Tên bước *"
              onBlur={e => { setTitle(e.target.value); setEditingTitle(false) }}
              onKeyDown={e => {
                if (e.key === 'Enter')   { setTitle((e.target as HTMLInputElement).value); setEditingTitle(false) }
                if (e.key === 'Escape')  { setEditingTitle(false) }
              }}
              className="border border-primary-400 rounded-lg px-3 py-2 text-base sm:text-lg font-serif font-semibold bg-white w-full focus:outline-none"
            />
          )}

          {/* Short description right below title — single textarea, always editable but visually subtle */}
          <UncontrolledTextInput
            key={`desc-${step.id}`}
            initial={step.description}
            placeholder="Mô tả ngắn (tuỳ chọn)…"
            onCommit={setDescription}
            multiline
            rows={2}
            className="mt-2 border-0 border-b border-transparent focus:border-neutral-200 focus:outline-none px-0 py-1 text-xs sm:text-[13px] text-neutral-600 bg-transparent w-full resize-none placeholder:text-neutral-400"
          />
        </section>

        {/* ── Type toggle (+ duration only for simple steps) ── */}
        <section className="flex flex-wrap gap-3 items-center">
          {/* Segmented toggle: Đơn giản | Chia nhánh */}
          <div role="group" aria-label="Loại bước" className="inline-flex border border-neutral-200 rounded-lg overflow-hidden bg-white text-xs">
            {([
              { value: 'simple', label: 'Đơn giản' },
              { value: 'branch', label: 'Rẽ nhánh' },
            ] as { value: StepType; label: string }[]).map((opt, i) => {
              const active = step.step_type === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onUpdate(step.id, { step_type: opt.value })}
                  className={`px-3 py-1.5 transition-colors ${
                    active
                      ? 'bg-primary-600 text-white'
                      : 'bg-white text-neutral-600 hover:bg-neutral-50'
                  } ${i === 0 ? 'border-r border-neutral-200' : ''}`}
                >
                  {active && <Check size={11} className="inline -mt-0.5 mr-1" />}
                  {opt.label}
                </button>
              )
            })}
          </div>

          {/* Duration only for simple steps — branches are pure routers, no
              processing time of their own. */}
          {step.step_type !== 'branch' && (
            <div className="inline-flex items-center gap-1.5 ml-auto">
              <span className="text-[11px] text-neutral-500">⏱ Thời gian:</span>
              <input
                type="number"
                min="0.5"
                step="0.5"
                defaultValue={step.duration_hours}
                key={`dur-${step.id}`}
                onBlur={e => onUpdate(step.id, { duration_hours: parseFloat(e.target.value) || 3 })}
                className="border border-neutral-200 rounded px-2 py-0.5 text-xs w-16 bg-white text-center"
              />
              <span className="text-[11px] text-neutral-500">tiếng</span>
              <span
                className="text-neutral-400 hover:text-neutral-600 cursor-help"
                title="Thời gian dự kiến xử lý kể từ khi tiếp nhận đầu vào đầy đủ."
                aria-label="Giải thích thời gian"
              >
                <HelpCircle size={12} />
              </span>
            </div>
          )}
        </section>

        {/* ── Show-when (relocated to TOP per round-5b feedback) ── */}
        {priorSteps.length > 0 && (
          <section className="border border-neutral-100 rounded-lg p-3 bg-white">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-2 inline-flex items-center gap-1.5">
              Hiện khi
              <span
                className="text-neutral-400 hover:text-neutral-600 cursor-help"
                title="Bước này chỉ hiện khi điều kiện đúng. Có thể chọn outcome của bước trước, hoặc field cụ thể trong form bước trước. Để trống → luôn hiện."
                aria-label="Giải thích Hiện khi"
              >
                <HelpCircle size={11} />
              </span>
            </h4>
            <ConditionExpression
              value={step.show_when ?? null}
              onChange={setShowWhen}
              priorSteps={priorSteps}
              formTemplates={formTemplates}
              emptyLabel="(luôn hiện)"
            />
          </section>
        )}

        {/* ── Branch-specific config (router-only, no processing fields) ── */}
        {step.step_type === 'branch' && (
          <BranchRouterSection
            step={step}
            priorSteps={priorSteps}
            formTemplates={formTemplates}
            setBranchConfig={setBranchConfig}
          />
        )}

        {/* ── Sections below are SIMPLE-step only — branches don't run anything ── */}
        {step.step_type !== 'branch' && (
          <>
            {/* Approval */}
            <StepApprovalSection step={step} profiles={profiles} onUpdate={onUpdate} />

            {/* Attachments + form responsibility map */}
            <StepFormSection
              step={step}
              helpers={helpers}
              formTemplates={formTemplates}
              allSteps={allSteps}
              onUpdate={onUpdate}
              onCreateForm={onCreateForm}
              onHoverSteps={onHoverSteps}
            />
          </>
        )}
      </div>

      {/* Preview modal — opened from header */}
      <StepPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        step={step}
        helpers={helpers}
        formTemplates={formTemplates}
        profiles={profiles}
      />
    </div>
  )
})

/**
 * BranchRouterSection — branch-only detail section (round-5b).
 *
 * Lets the user configure a router from a previous step's outcome OR field
 * value. The source step + source kind (+ field id when relevant) is shared
 * across all cases of the branch — every case is "compare same data with
 * different operator/value". Cases drive the outgoing edges in the canvas.
 */
function BranchRouterSection({
  step, priorSteps, formTemplates, setBranchConfig,
}: {
  step: StepDraft
  priorSteps: StepDraft[]
  formTemplates: FormTemplate[]
  setBranchConfig: (next: BranchConfig | null) => void
}) {
  const cfg: BranchConfig = step.branch_config ?? {
    source_kind: 'outcome',
    source_step_id: null,
    source_field_id: null,
    cases: [],
  }

  const sourceStep = priorSteps.find(s => s.id === cfg.source_step_id) ?? null
  const sourceForm = sourceStep?.form_template_id
    ? formTemplates.find(f => f.id === sourceStep.form_template_id) ?? null
    : null
  const sourceField = sourceForm && cfg.source_field_id
    ? sourceForm.fields.find(f => f.id === cfg.source_field_id) ?? null
    : null

  const kindOutcomeAvailable = !!sourceStep && sourceStep.branch_options.length > 0
  const kindFieldAvailable   = !!sourceForm

  function update(patch: Partial<BranchConfig>) {
    setBranchConfig({ ...cfg, ...patch })
  }
  function updateCase(id: string, patch: Partial<ConditionCase>) {
    setBranchConfig({ ...cfg, cases: cfg.cases.map(c => c.id === id ? { ...c, ...patch } : c) })
  }
  function addCase() {
    const newCase: ConditionCase = {
      id: crypto.randomUUID(),
      label: cfg.source_kind === 'outcome' ? '' : 'Nhánh mới',
      operator: '=',
      value: '',
    }
    setBranchConfig({ ...cfg, cases: [...cfg.cases, newCase] })
  }
  function removeCase(id: string) {
    setBranchConfig({ ...cfg, cases: cfg.cases.filter(c => c.id !== id) })
  }

  return (
    <section className="border border-amber-200 bg-amber-50/40 rounded-lg p-3 space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-800 inline-flex items-center gap-1.5">
        Rẽ nhánh — cấu hình router
        <span
          className="text-amber-500 hover:text-amber-700 cursor-help"
          title="Branch là router, không phải bước xử lý. Chọn nguồn dữ liệu (outcome của bước trước, hoặc field trong form của bước trước) rồi định nghĩa từng case + nhãn xuất hiện trên cạnh nối."
          aria-label="Giải thích Rẽ nhánh"
        >
          <HelpCircle size={11} />
        </span>
      </h4>

      {/* Source-step + source-kind + (optional) field picker */}
      <div className="space-y-1.5">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500">
          Đọc dữ liệu từ
        </label>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <select
            value={cfg.source_step_id ?? ''}
            onChange={e => {
              const id = e.target.value || null
              const s = priorSteps.find(p => p.id === id) ?? null
              const newKind: 'outcome' | 'field' =
                s?.branch_options?.length ? 'outcome'
                : s?.form_template_id    ? 'field'
                : 'outcome'
              update({ source_step_id: id, source_field_id: null, source_kind: newKind })
            }}
            className="border border-neutral-200 rounded px-2 py-1 bg-white"
          >
            <option value="">— chọn bước nguồn —</option>
            {priorSteps.map(s => (
              <option key={s.id} value={s.id}>{s.title || '(chưa đặt tên)'}</option>
            ))}
          </select>

          {sourceStep && (kindOutcomeAvailable || kindFieldAvailable) && (
            <div className="inline-flex border border-neutral-200 rounded overflow-hidden">
              {kindOutcomeAvailable && (
                <button
                  type="button"
                  onClick={() => update({ source_kind: 'outcome', source_field_id: null })}
                  className={`px-2 py-1 text-[10px] ${cfg.source_kind === 'outcome' ? 'bg-primary-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
                >
                  Outcome
                </button>
              )}
              {kindFieldAvailable && (
                <button
                  type="button"
                  onClick={() => update({ source_kind: 'field' })}
                  className={`px-2 py-1 text-[10px] ${cfg.source_kind === 'field' ? 'bg-primary-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
                >
                  Field
                </button>
              )}
            </div>
          )}

          {cfg.source_kind === 'field' && sourceForm && (
            <select
              value={cfg.source_field_id ?? ''}
              onChange={e => update({ source_field_id: e.target.value || null })}
              className="border border-neutral-200 rounded px-2 py-1 bg-white"
            >
              <option value="">— chọn field —</option>
              {sourceForm.fields.map(f => (
                <option key={f.id} value={f.id}>{f.label || '(chưa đặt tên)'}</option>
              ))}
            </select>
          )}

          {sourceStep && !kindOutcomeAvailable && !kindFieldAvailable && (
            <span className="italic text-amber-700/70 text-[10px]">
              Bước này chưa có outcome (branch_options) hoặc form để rẽ.
            </span>
          )}
        </div>
      </div>

      {/* Cases list */}
      {cfg.source_step_id && (cfg.source_kind === 'outcome' || cfg.source_field_id) && (
        <div className="space-y-1.5">
          <label className="block text-[10px] uppercase tracking-wider text-neutral-500">
            Các nhánh ({cfg.cases.length})
          </label>
          <ul className="space-y-1.5">
            {cfg.cases.map(c => (
              <li key={c.id} className="flex flex-wrap items-center gap-1.5 text-[11px] bg-white rounded px-2 py-1 border border-amber-100">
                <input
                  type="text"
                  value={c.label}
                  onChange={e => updateCase(c.id, { label: e.target.value })}
                  placeholder="Nhãn nhánh"
                  className="border border-neutral-200 rounded px-1.5 py-0.5 bg-white w-28"
                />
                <ConditionExpression
                  value={{
                    source_kind: cfg.source_kind,
                    source_step_id: cfg.source_step_id,
                    source_field_id: cfg.source_field_id,
                    operator: c.operator,
                    value: c.value,
                  }}
                  onChange={next => {
                    if (!next) return
                    updateCase(c.id, { operator: next.operator, value: next.value })
                  }}
                  priorSteps={priorSteps}
                  formTemplates={formTemplates}
                  hideKindToggle
                  pinnedSource={{
                    step_id: cfg.source_step_id,
                    field_id: cfg.source_field_id,
                    kind: cfg.source_kind,
                  }}
                />
                <button
                  type="button"
                  onClick={() => removeCase(c.id)}
                  className="ml-auto text-neutral-400 hover:text-red-600 p-0.5"
                  title="Xoá nhánh"
                  aria-label="Xoá nhánh"
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addCase}
            className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 border border-dashed border-amber-300 text-amber-700 rounded hover:bg-amber-100"
          >
            <Plus size={10} /> Thêm nhánh
          </button>
          <p className="text-[10px] text-amber-700/80">
            Nhãn của mỗi nhánh xuất hiện trên cạnh trong sơ đồ và là handle bạn kéo từ branch sang bước con.
            {cfg.source_kind === 'field' && sourceField && (
              <> · Field nguồn: <span className="font-mono">{sourceField.label}</span></>
            )}
          </p>
        </div>
      )}
    </section>
  )
}

function UncontrolledTextInput({
  initial, onCommit, placeholder, className, multiline, rows,
}: {
  initial: string
  onCommit: (v: string) => void
  placeholder?: string
  className?: string
  multiline?: boolean
  rows?: number
}) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (ref.current && ref.current.value !== initial) ref.current.value = initial
  }, [initial])
  if (multiline) {
    return (
      <textarea
        ref={el => { ref.current = el }}
        defaultValue={initial}
        placeholder={placeholder}
        rows={rows}
        onBlur={e => onCommit(e.target.value)}
        className={className}
      />
    )
  }
  return (
    <input
      ref={el => { ref.current = el }}
      type="text"
      defaultValue={initial}
      placeholder={placeholder}
      onBlur={e => onCommit(e.target.value)}
      className={className}
    />
  )
}
