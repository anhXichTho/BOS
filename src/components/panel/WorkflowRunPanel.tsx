import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle, Circle, ChevronDown, FileText, MessageCircleQuestion, Bot,
  Clock, Check, X, Loader2,
} from 'lucide-react'
import Button from '../ui/Button'
import { RunStatusBadge } from '../ui/Badge'
import HelperPanelView from '../settings/HelperPanelView'
import StepFormModal from '../workflow/StepFormModal'
import RunProgressBar from '../workflow/RunProgressBar'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import { supabase } from '../../lib/supabase'
import { useSidePanel } from '../../lib/sidePanelStore'
import { buildCardSummary } from '../../lib/buildCardSummary'
import type {
  WorkflowRun, WorkflowStep, WorkflowStepResult, HelperPanel, FormTemplate, ContextType,
} from '../../types'

interface Props {
  runId: string
}

export default function WorkflowRunPanel({ runId }: Props) {
  const { user, isAdmin, isEditor } = useAuth()
  const { success, error: toastError } = useToast()
  const qc = useQueryClient()

  // Read context meta so we can post the form submission card to the originating chat thread
  const { active: panelState } = useSidePanel()
  const contextMeta = panelState?.meta as { context_type: ContextType; context_id: string } | undefined

  const [formStepId, setFormStepId] = useState<string | null>(null)
  const [approvalComment, setApprovalComment] = useState<Record<string, string>>({})

  // ── Run ────────────────────────────────────────────────────────────────────
  const { data: run, isLoading: runLoading } = useQuery({
    queryKey: ['workflow-run', runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_runs')
        .select('*, runner:profiles!run_by(full_name, id)')
        .eq('id', runId)
        .single()
      if (error) { console.warn('[WorkflowRunPanel] run fetch:', error.message); return null }
      return data as WorkflowRun & { runner: { full_name: string; id: string } | null }
    },
    retry: false,
  })

  // ── Steps (snapshot-first) ─────────────────────────────────────────────────
  const stepsQuery = useQuery({
    queryKey: ['workflow-steps', run?.id, run?.template_id],
    queryFn: async () => {
      const snapRes = await supabase
        .from('workflow_run_steps')
        .select('id, source_step_id, parent_snapshot_id, branch_condition, title, description, step_type, branch_options, order_index, helper_panel_id, form_template_id, requires_approval, approver_user_id, approver_role, show_when')
        .eq('run_id', run!.id)
        .order('order_index')

      if (snapRes.data && snapRes.data.length > 0) {
        const snapshotted = snapRes.data.map((r: any) => ({
          id: r.id as string,
          template_id:      run!.template_id ?? '',
          parent_step_id:   r.parent_snapshot_id as string | null,
          branch_condition: r.branch_condition as string | null,
          title:            r.title as string,
          description:      r.description as string | null,
          step_type:        r.step_type as 'simple' | 'branch',
          branch_options:   r.branch_options as string[] | null,
          order_index:      r.order_index as number,
          helper_panel_id:  r.helper_panel_id as string | null,
          form_template_id: r.form_template_id as string | null,
          requires_approval: r.requires_approval ?? false,
          approver_user_id: r.approver_user_id as string | null,
          approver_role:    r.approver_role as string | null,
          show_when:        (r.show_when as Record<string, unknown> | null) ?? null,
          created_at:       '',
        })) as WorkflowStep[]
        // Side-map: snapshot id → source template step id (Phase D fill rules)
        const sourceMap: Record<string, string | null> = {}
        // Inverse: template step id → snapshot step id (for show_when evaluation)
        const templateToSnapshot: Record<string, string> = {}
        for (const r of snapRes.data) {
          sourceMap[r.id as string] = (r.source_step_id as string | null) ?? null
          if (r.source_step_id) templateToSnapshot[r.source_step_id as string] = r.id as string
        }
        return { steps: snapshotted, snapshot: true, sourceMap, templateToSnapshot }
      }

      const { data, error } = await supabase
        .from('workflow_steps')
        .select('*')
        .eq('template_id', run!.template_id!)
        .order('order_index')
      if (error) return { steps: [] as WorkflowStep[], snapshot: false, sourceMap: {} as Record<string, string | null>, templateToSnapshot: {} as Record<string, string> }
      // Legacy path: step.id IS the template-level id, so no remapping needed.
      return { steps: data as WorkflowStep[], snapshot: false, sourceMap: {} as Record<string, string | null>, templateToSnapshot: {} as Record<string, string> }
    },
    enabled: !!run?.template_id,
    retry: false,
  })

  const steps              = stepsQuery.data?.steps ?? []
  const usingSnapshot      = stepsQuery.data?.snapshot ?? false
  const sourceStepMap      = stepsQuery.data?.sourceMap ?? {}
  const templateToSnapshot = stepsQuery.data?.templateToSnapshot ?? {}
  const stepsLoading       = stepsQuery.isLoading

  /** For Phase D field gating: returns the template-level workflow_step.id of a runtime step.
   *  In snapshot mode this is the snapshot's `source_step_id`; in legacy it's just `step.id`. */
  function templateStepIdOf(step: WorkflowStep): string {
    return usingSnapshot ? (sourceStepMap[step.id] ?? step.id) : step.id
  }

  // ── Step results ───────────────────────────────────────────────────────────
  const { data: results = [] } = useQuery({
    queryKey: ['step-results', runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_step_results')
        .select('*')
        .eq('run_id', runId)
      if (error) return [] as WorkflowStepResult[]
      return data as WorkflowStepResult[]
    },
    retry: false,
  })

  // ── Form submissions (for show_when field evaluation) ─────────────────────
  const { data: runSubmissions = [] } = useQuery({
    queryKey: ['run-submissions', runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, data')
        .eq('context_type', 'workflow_run')
        .eq('context_id', runId)
      if (error) { console.warn('[WorkflowRunPanel] submissions fetch:', error.message); return [] }
      return data as { id: string; data: Record<string, unknown> }[]
    },
    retry: false,
  })
  const submissionDataById = Object.fromEntries(runSubmissions.map(s => [s.id, s.data]))

  // ── Helper panels ──────────────────────────────────────────────────────────
  const helperIds = [...new Set(steps.map(s => s.helper_panel_id).filter(Boolean) as string[])]
  const { data: helpers = [] } = useQuery({
    queryKey: ['helpers-for-run', helperIds.sort().join(',')],
    queryFn: async () => {
      if (helperIds.length === 0) return [] as HelperPanel[]
      const { data, error } = await supabase.from('helper_panels').select('*').in('id', helperIds)
      if (error) return [] as HelperPanel[]
      return data as HelperPanel[]
    },
    enabled: helperIds.length > 0,
  })

  // ── Form templates ─────────────────────────────────────────────────────────
  const formIds = [...new Set(steps.map(s => s.form_template_id).filter(Boolean) as string[])]
  const { data: forms = [] } = useQuery({
    queryKey: ['forms-for-run', formIds.sort().join(',')],
    queryFn: async () => {
      if (formIds.length === 0) return [] as FormTemplate[]
      const { data, error } = await supabase.from('form_templates').select('*').in('id', formIds)
      if (error) return [] as FormTemplate[]
      return data as FormTemplate[]
    },
    enabled: formIds.length > 0,
  })

  // ── Approver profile lookup (for "🛡 Người duyệt" labels) ─────────────────
  const approverIds = [...new Set(
    steps.filter(s => s.requires_approval && s.approver_user_id).map(s => s.approver_user_id!) as string[],
  )]
  const { data: approverProfiles = [] } = useQuery({
    queryKey: ['approvers-for-run', approverIds.sort().join(',')],
    queryFn: async () => {
      if (approverIds.length === 0) return [] as { id: string; full_name: string }[]
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', approverIds)
      if (error) return []
      return data as { id: string; full_name: string }[]
    },
    enabled: approverIds.length > 0,
  })
  const approverNameById = Object.fromEntries(approverProfiles.map(p => [p.id, p.full_name]))

  /** Resolve display name for a step's approver. */
  function resolveApproverName(step: WorkflowStep): string {
    if (step.approver_role === 'admin')  return 'Tất cả Admin'
    if (step.approver_role === 'editor') return 'Tất cả Editor'
    if (step.approver_user_id) return approverNameById[step.approver_user_id] ?? '—'
    return '—'
  }

  const helperById = Object.fromEntries(helpers.map(h => [h.id, h]))
  const formById   = Object.fromEntries(forms.map(f => [f.id, f]))

  // ── Ownership / read-only ──────────────────────────────────────────────────
  const isOwner    = run?.run_by === user?.id
  const isReadOnly = !isOwner || run?.status !== 'in_progress'

  // ── Result map: keyed by snapshot_id (new) or step_id (legacy) ────────────
  const resultMap = Object.fromEntries(
    results.map(r => [(usingSnapshot ? r.snapshot_id : r.step_id) ?? '', r] as const),
  )

  // ── Visibility (branch filtering + show_when conditions) ─────────────────
  type CondOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains'
  function evalOp(actual: unknown, op: CondOp, expected: string): boolean {
    if (actual === null || actual === undefined || actual === '') return false
    const a = String(actual)
    switch (op) {
      case '=':        return a === expected
      case '!=':       return a !== expected
      case '>':        return parseFloat(a) > parseFloat(expected)
      case '<':        return parseFloat(a) < parseFloat(expected)
      case '>=':       return parseFloat(a) >= parseFloat(expected)
      case '<=':       return parseFloat(a) <= parseFloat(expected)
      case 'contains': return a.toLowerCase().includes(expected.toLowerCase())
      default:         return false
    }
  }

  function showWhenPasses(step: WorkflowStep): boolean {
    const sw = step.show_when as {
      source_kind: 'outcome' | 'field'
      source_step_id: string | null
      source_field_id: string | null
      operator: CondOp
      value: string
    } | null | undefined

    if (!sw || !sw.source_step_id) return true  // no condition → always visible

    // In snapshot mode, show_when.source_step_id is a template-level DB id.
    // Map it to the runtime snapshot id so we can look up the result.
    const runtimeKey = usingSnapshot
      ? (templateToSnapshot[sw.source_step_id] ?? sw.source_step_id)
      : sw.source_step_id

    const sourceResult = resultMap[runtimeKey]

    if (sw.source_kind === 'outcome') {
      // Condition on whether the source step chose a particular branch
      if (!sourceResult?.branch_selected) return false
      return evalOp(sourceResult.branch_selected, sw.operator, sw.value)
    }

    // Condition on a form field value
    if (!sourceResult?.form_submission_id) return false
    const submData = submissionDataById[sourceResult.form_submission_id]
    if (!submData || !sw.source_field_id) return false
    return evalOp(submData[sw.source_field_id], sw.operator, sw.value)
  }

  function isStepVisible(step: WorkflowStep): boolean {
    if (!showWhenPasses(step)) return false
    if (!step.parent_step_id) return true
    const parent = steps.find(s => s.id === step.parent_step_id)
    if (!parent) return true
    if (parent.step_type !== 'branch') return isStepVisible(parent)
    const parentResult = resultMap[parent.id]
    if (!parentResult?.branch_selected) return false
    return parentResult.branch_selected === step.branch_condition && isStepVisible(parent)
  }

  const visibleSteps = steps.filter(isStepVisible)

  function stepEffectivelyDone(step: WorkflowStep): boolean {
    const result = resultMap[step.id]
    if (!result?.is_done) return false
    if (step.requires_approval) {
      return result.approval_status === 'approved'
    }
    return true
  }

  /**
   * Phase D — approval gate. Before approver clicks Duyệt, verify that any
   * `fill_by_role='approver' && required` fields on this step's form are filled.
   * If not, show toast + open form modal so the approver can complete them.
   * Returns true when approval is BLOCKED (caller should not proceed).
   */
  async function gateApproveOnApproverFields(step: WorkflowStep): Promise<boolean> {
    if (!step.form_template_id || !run) return false
    const template = formById[step.form_template_id]
    if (!template) return false

    // Find any approver-only required fields on this template.
    const approverFields = template.fields.filter(
      f => f.fill_by_role === 'approver' && f.required,
    )
    if (approverFields.length === 0) return false

    // Look up the run-scoped submission. If absent, all approver fields are empty.
    const { data: submission } = await supabase
      .from('form_submissions')
      .select('id, data')
      .eq('context_type', 'workflow_run')
      .eq('context_id', run.id)
      .eq('template_id', template.id)
      .maybeSingle()

    const filled = (submission?.data ?? {}) as Record<string, unknown>
    const missing = approverFields.filter(f => {
      const v = filled[f.id]
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
    })
    if (missing.length === 0) return false

    toastError(
      `Cần điền các trường duyệt: ${missing.map(f => f.label).join(', ')}`,
    )
    setFormStepId(step.id)  // open form modal in approver-edit mode
    return true
  }

  const doneCount  = visibleSteps.filter(stepEffectivelyDone).length
  const totalCount = visibleSteps.length
  const progress   = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const allDone    = totalCount > 0 && visibleSteps.every(stepEffectivelyDone)

  // (Removed auto-init effect that pre-inserted empty step_result rows for
  //  every visible step — it raced with `updateResult` and produced duplicate
  //  rows for the same (run, snapshot), which then UPDATE'd in lock-step on
  //  approval submission, firing fan_out_approvals twice. Rows are now created
  //  on demand inside `updateResult.mutationFn` via a SELECT-then-INSERT path.)

  // ── Update a step result ───────────────────────────────────────────────────
  // Race-safe: read fresh state from the DB before deciding INSERT vs UPDATE
  // (do NOT trust resultMap, which can be stale right after auto-init's INSERT
  // round-trips back). Without this, a quick checkbox click after panel mount
  // can re-INSERT a duplicate row, which then UPDATEs in lock-step with the
  // first row → fan_out_approvals fires twice → duplicate notifications.
  const updateResult = useMutation({
    mutationFn: async ({ stepId, patch }: { stepId: string; patch: Partial<WorkflowStepResult> }) => {
      const keyCol = usingSnapshot ? 'snapshot_id' : 'step_id'
      const { data: existing, error: lookupErr } = await supabase
        .from('workflow_step_results')
        .select('id')
        .eq('run_id', runId)
        .eq(keyCol, stepId)
        .limit(1)
        .maybeSingle()
      if (lookupErr) throw lookupErr
      if (existing) {
        const { error } = await supabase
          .from('workflow_step_results')
          .update(patch)
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const row = usingSnapshot
          ? { run_id: runId, snapshot_id: stepId, ...patch }
          : { run_id: runId, step_id:     stepId, ...patch }
        const { error } = await supabase.from('workflow_step_results').insert(row)
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['step-results', runId] }),
    onError: () => toastError('Không thể cập nhật bước'),
  })

  // ── Complete the entire run ────────────────────────────────────────────────
  const completeRun = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('workflow_runs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', runId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow-run', runId] })
      qc.invalidateQueries({ queryKey: ['running-workflow-channels'] })
      success('Nghiệp vụ đã hoàn thành! 🎉')
    },
    onError: () => toastError('Không thể hoàn thành nghiệp vụ'),
  })

  // ── Post form submission rich card to chat context ─────────────────────────
  async function postFormCard(submissionId: string, template: FormTemplate) {
    if (!contextMeta || !user?.id) return
    try {
      const { data: sub } = await supabase
        .from('form_submissions')
        .select('data')
        .eq('id', submissionId)
        .single()
      const summary = sub?.data ? buildCardSummary(template, sub.data) : []
      await supabase.from('chat_messages').insert({
        context_type: contextMeta.context_type,
        context_id:   contextMeta.context_id,
        author_id:    user.id,
        message_type: 'rich_card',
        payload: {
          kind:          'form_submission_link',
          submission_id: submissionId,
          template_name: template.name,
          summary,
        },
      })
      qc.invalidateQueries({ queryKey: ['messages', contextMeta.context_id] })
    } catch (err) {
      console.warn('[WorkflowRunPanel] postFormCard error:', err)
    }
  }

  // ── Step tree renderer ─────────────────────────────────────────────────────
  // Build a flat DFS-ordered list for sequential rendering (no nesting)
  function flatDFS(parentId: string | null): typeof visibleSteps {
    const result: typeof visibleSteps = []
    const children = visibleSteps
      .filter(s => s.parent_step_id === parentId)
      .sort((a, b) => a.order_index - b.order_index)
    for (const child of children) {
      result.push(child)
      result.push(...flatDFS(child.id))
    }
    return result
  }
  const orderedSteps = flatDFS(null)

  function renderStepList(): React.ReactNode {
    return orderedSteps.map((step, idx) => {
      const result         = resultMap[step.id]
      const isDone         = result?.is_done ?? false
      const effectiveDone  = stepEffectivelyDone(step)
      const selected       = result?.branch_selected ?? ''
      const note           = result?.note ?? ''
      const isBranch       = step.step_type === 'branch'
      const helper         = step.helper_panel_id  ? helperById[step.helper_panel_id]  : null
      const formTpl        = step.form_template_id ? formById[step.form_template_id]   : null
      const approvalStatus = result?.approval_status ?? null

      // Check if current user can approve this step
      const isApprover = run?.status === 'in_progress' && step.requires_approval && (
        step.approver_user_id === user?.id ||
        (step.approver_role === 'admin' && isAdmin) ||
        (step.approver_role === 'editor' && (isEditor || isAdmin))
      )

      const stepBorderColor = effectiveDone
        ? 'border-green-200 bg-green-50/40'
        : approvalStatus === 'pending'
        ? 'border-amber-300 bg-amber-50/60'
        : approvalStatus === 'rejected'
        ? 'border-red-200 bg-red-50/30'
        : 'border-neutral-100 bg-white'

      return (
        <div key={step.id}>
          {/* Arrow connector between steps */}
          {idx > 0 && (
            <div className="flex flex-col items-center my-1">
              <div className="w-px h-3 bg-neutral-200" />
              <ChevronDown size={12} className="text-neutral-300 -mt-0.5" />
            </div>
          )}
          {/* Branch condition label */}
          {step.branch_condition && (
            <div className="flex justify-center mb-1.5">
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                → {step.branch_condition}
              </span>
            </div>
          )}
          <div className={`border rounded-lg p-3 ${stepBorderColor}`}>
          <div className="flex items-start gap-3">
            {/* Checkbox / form trigger */}
            {formTpl ? (
              <button
                // Always allow click on a done step (opens read-only view).
                // Block only when the step has no submission yet AND user
                // can't modify the run.
                disabled={!isDone && isReadOnly}
                onClick={() => setFormStepId(step.id)}
                className="mt-0.5 shrink-0 disabled:cursor-default"
                title={isDone ? 'Xem submission' : 'Điền form để hoàn thành'}
              >
                {effectiveDone
                  ? <CheckCircle size={18} className="text-green-500" />
                  : <Circle size={18} className="text-primary-400" />}
              </button>
            ) : (
              <button
                disabled={isReadOnly || approvalStatus === 'pending' || approvalStatus === 'approved'}
                onClick={() => {
                  const now = new Date().toISOString()
                  if (step.requires_approval && !isDone) {
                    // Submit for approval
                    updateResult.mutate({ stepId: step.id, patch: {
                      is_done: true,
                      done_at: now,
                      approval_status: 'pending',
                    }})
                  } else if (!step.requires_approval) {
                    updateResult.mutate({ stepId: step.id, patch: { is_done: !isDone, done_at: !isDone ? now : null } })
                  }
                }}
                className="mt-0.5 shrink-0 disabled:cursor-default"
              >
                {effectiveDone
                  ? <CheckCircle size={18} className="text-green-500" />
                  : approvalStatus === 'pending'
                  ? <Clock size={18} className="text-amber-500" />
                  : <Circle size={18} className="text-neutral-300" />}
              </button>
            )}

            <div className="flex-1 space-y-2 min-w-0">
              <p className={`text-sm font-medium ${effectiveDone ? 'line-through text-neutral-400' : 'text-neutral-800'}`}>
                {step.title}
              </p>
              {step.description && (
                <p className="text-xs text-neutral-500">{step.description}</p>
              )}

              {/* Responsibility lines: who runs this step + who approves (if any) */}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
                <span className="inline-flex items-center gap-1">
                  <span className="text-neutral-400">👤 Người chạy:</span>
                  <span className="text-neutral-700">{run?.runner?.full_name ?? '—'}</span>
                </span>
                {step.requires_approval && (
                  <span className="inline-flex items-center gap-1">
                    <span className="text-neutral-400">🛡 Người duyệt:</span>
                    <span className="text-neutral-700">{resolveApproverName(step)}</span>
                  </span>
                )}
              </div>

              {/* Form attachment */}
              {formTpl && (
                <button
                  type="button"
                  // Allow viewing once a submission exists, even while pending or read-only.
                  disabled={!isDone && isReadOnly}
                  onClick={() => setFormStepId(step.id)}
                  className="inline-flex items-center gap-1.5 text-xs text-primary-700 bg-primary-50 hover:bg-primary-100 disabled:opacity-60 px-2 py-1 rounded-lg border border-primary-200"
                >
                  <FileText size={12} />
                  {isDone ? `Xem: ${formTpl.name}` : `Điền form: ${formTpl.name}`}
                </button>
              )}

              {/* Approval status badge */}
              {step.requires_approval && isDone && (
                <div className="space-y-1.5">
                  {approvalStatus === 'pending' && (
                    <div className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                      <Clock size={11} /> Chờ duyệt{step.approver_user_id ? '' : ' (vai trò approver)'}
                    </div>
                  )}
                  {approvalStatus === 'approved' && (
                    <div className="inline-flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-lg">
                      <Check size={11} /> Đã duyệt
                      {result?.approval_at && <> lúc {new Date(result.approval_at).toLocaleString('vi')}</>}
                    </div>
                  )}
                  {approvalStatus === 'rejected' && (
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-lg">
                        <X size={11} /> Từ chối
                      </div>
                      {result?.approval_comment && (
                        <p className="text-[11px] text-red-600 pl-1">"{result.approval_comment}"</p>
                      )}
                    </div>
                  )}

                  {/* Approve/Reject buttons for the approver */}
                  {isApprover && approvalStatus === 'pending' && (
                    <div className="border border-amber-200 rounded-lg p-2 bg-white space-y-2">
                      <p className="text-[11px] text-neutral-600 font-medium">Bạn là người duyệt bước này:</p>
                      <textarea
                        rows={2}
                        placeholder="Nhận xét (tuỳ chọn)"
                        value={approvalComment[step.id] ?? ''}
                        onChange={e => setApprovalComment(prev => ({ ...prev, [step.id]: e.target.value }))}
                        className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded px-2 py-1 text-xs w-full resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            // Phase D approval gate: if this step has a form, check that all
                            // approver-required fields are filled. If not, open form modal.
                            const blocked = await gateApproveOnApproverFields(step)
                            if (blocked) return
                            updateResult.mutate({ stepId: step.id, patch: {
                              approval_status: 'approved',
                              approved_by: user?.id ?? null,
                              approval_comment: approvalComment[step.id] ?? null,
                              approval_at: new Date().toISOString(),
                              is_done: true,
                            }})
                          }}
                          disabled={updateResult.isPending}
                          className="flex items-center gap-1 text-xs text-white bg-green-600 hover:bg-green-700 px-3 py-1 rounded disabled:opacity-50"
                        >
                          {updateResult.isPending ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          Duyệt
                        </button>
                        <button
                          type="button"
                          onClick={() => updateResult.mutate({ stepId: step.id, patch: {
                            approval_status: 'rejected',
                            approved_by: user?.id ?? null,
                            approval_comment: approvalComment[step.id] ?? null,
                            approval_at: new Date().toISOString(),
                          }})}
                          disabled={updateResult.isPending}
                          className="flex items-center gap-1 text-xs text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded disabled:opacity-50"
                        >
                          <X size={11} /> Từ chối
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Branch selector */}
              {isBranch && isDone && !isReadOnly && (
                <div className="relative w-44">
                  <select
                    value={selected}
                    onChange={e => updateResult.mutate({ stepId: step.id, patch: { branch_selected: e.target.value } })}
                    className="appearance-none border border-neutral-200 rounded-lg px-2 py-1 text-xs bg-white w-full pr-6"
                  >
                    <option value="">— Chọn nhánh —</option>
                    {(step.branch_options ?? []).map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                </div>
              )}
              {isBranch && isReadOnly && selected && (
                <span className="text-xs text-amber-700 font-medium">→ Đã chọn: {selected}</span>
              )}

              {/* Note */}
              {!isReadOnly ? (
                <textarea
                  rows={1}
                  placeholder="Ghi chú (tuỳ chọn)"
                  defaultValue={note}
                  onBlur={e => {
                    if (e.target.value !== note) {
                      updateResult.mutate({ stepId: step.id, patch: { note: e.target.value } })
                    }
                  }}
                  className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-2 py-1 text-xs font-serif bg-white w-full resize-none"
                />
              ) : note ? (
                <p className="text-xs text-neutral-500 italic">📝 {note}</p>
              ) : null}

              {result?.done_at && !step.requires_approval && (
                <p className="text-[10px] text-neutral-400">
                  ✓ {new Date(result.done_at).toLocaleString('vi')}
                </p>
              )}

              {/* Helper panel */}
              {helper && (
                <details className="rounded-lg border border-neutral-100 bg-neutral-50 mt-2 group" open={!isDone}>
                  <summary className="cursor-pointer list-none px-3 py-1.5 flex items-center gap-2 text-xs text-neutral-700 hover:bg-neutral-100">
                    {helper.type === 'faq'
                      ? <MessageCircleQuestion size={12} className="text-primary-600" />
                      : <Bot size={12} className="text-violet-600" />}
                    <span className="font-medium">
                      {helper.type === 'faq' ? 'FAQ' : 'AI'}: {helper.name}
                    </span>
                    <span className="ml-auto text-neutral-300 group-open:rotate-180 transition-transform">▾</span>
                  </summary>
                  <div className="border-t border-neutral-100 max-h-[320px] overflow-hidden">
                    <HelperPanelView panelId={helper.id} />
                  </div>
                </details>
              )}
            </div>
          </div>

        </div>
        </div>
      )
    })
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (runLoading || stepsLoading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-12 bg-neutral-100 animate-pulse rounded-lg" />
        ))}
      </div>
    )
  }

  if (!run) {
    return (
      <div className="p-6 text-center text-sm text-neutral-400">
        Không tìm thấy workflow run.
      </div>
    )
  }

  const formStep         = formStepId ? steps.find(s => s.id === formStepId) ?? null : null
  const formStepTemplate = formStep?.form_template_id ? formById[formStep.form_template_id] ?? null : null
  // Derive read-only for the form modal:
  //   • blanket isReadOnly applies (viewer / non-runner)
  //   • once a step is done, default to view-only — except when the current
  //     user is the approver and approval is still pending (they may need to
  //     fill approver-owned fields before deciding).
  const formStepResult   = formStep ? resultMap[formStep.id] ?? null : null
  const formStepIsDone   = !!formStepResult?.is_done
  const formStepApproval = formStepResult?.approval_status ?? null
  const isApproverForFormStep =
    !!formStep?.requires_approval && (
      formStep.approver_user_id === user?.id ||
      (formStep.approver_role === 'admin'  && isAdmin) ||
      (formStep.approver_role === 'editor' && (isEditor || isAdmin))
    )
  const formReadOnly =
    isReadOnly ||
    (formStepIsDone && !(formStepApproval === 'pending' && isApproverForFormStep))

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Run meta header ────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50 shrink-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <RunStatusBadge status={run.status} />
          <span className="text-xs text-neutral-500">
            <span className="text-neutral-400">Chạy bởi: </span>
            <span className="text-neutral-700">{run.runner?.full_name ?? '—'}</span>
          </span>
          <span className="text-neutral-300">·</span>
          <span className="text-xs text-neutral-400">
            Bắt đầu: {new Date(run.started_at).toLocaleString('vi')}
          </span>
        </div>
        {(() => {
          // "Bước hiện tại": first not-effectively-done visible step
          const current = visibleSteps.find(s => !stepEffectivelyDone(s))
          if (!current || run.status !== 'in_progress') return null
          return (
            <p className="text-[11px] text-neutral-500">
              <span className="text-neutral-400">Bước hiện tại: </span>
              <strong className="text-neutral-700 font-medium">{current.title}</strong>
            </p>
          )
        })()}
        {totalCount > 0 && steps.length > 0 && (
          <RunProgressBar
            steps={steps.map(s => ({
              id: s.id,
              parent_step_id: s.parent_step_id,
              order_index: s.order_index,
              duration_hours: s.duration_hours ?? null,
              requires_approval: s.requires_approval,
            }))}
            results={results.map(r => ({
              snapshot_id: (r as any).snapshot_id ?? null,
              step_id: (r as any).step_id ?? null,
              is_done: !!r.is_done,
              approval_status: r.approval_status ?? null,
            }))}
            runStatus={run.status}
          />
        )}
        {totalCount > 0 && (
          <p className="text-[10px] text-neutral-400 tabular-nums">
            {doneCount}/{totalCount} bước · {progress}%
          </p>
        )}
      </div>

      {/* ── Steps ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3">
        {steps.length === 0 && (
          run.template_id === null
            ? (
              <div className="mx-3 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p className="font-medium">Mẫu nghiệp vụ đã bị xóa</p>
                <p className="text-xs mt-0.5 text-amber-700">Lượt chạy này vẫn được lưu lại nhưng mẫu gốc không còn tồn tại.</p>
              </div>
            )
            : <p className="text-sm text-neutral-400 text-center py-8">Không có bước nào.</p>
        )}
        {renderStepList()}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-3 border-t border-neutral-100 bg-white space-y-2">
        {run.status === 'completed' && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-800">
            ✅ Hoàn thành lúc {run.completed_at ? new Date(run.completed_at).toLocaleString('vi') : '—'}
          </div>
        )}

        {!isReadOnly && allDone && (
          <Button
            onClick={() => completeRun.mutate()}
            disabled={completeRun.isPending}
            className="w-full justify-center"
          >
            {completeRun.isPending ? 'Đang hoàn thành…' : '🎉 Hoàn thành Workflow'}
          </Button>
        )}

        {isReadOnly && run.status === 'in_progress' && !visibleSteps.some(s => s.requires_approval && resultMap[s.id]?.approval_status === 'pending' && (s.approver_user_id === user?.id || (s.approver_role === 'admin' && isAdmin) || (s.approver_role === 'editor' && (isEditor || isAdmin)))) && (
          <p className="text-[11px] text-neutral-400 text-center">
            Chỉ người chạy workflow mới có thể cập nhật bước.
          </p>
        )}
      </div>

      {/* ── Step form modal ────────────────────────────────────────────────── */}
      {formStep && formStepTemplate && (
        <StepFormModal
          open={!!formStep}
          template={formStepTemplate}
          existingSubmissionId={resultMap[formStep.id]?.form_submission_id ?? null}
          projectId={run.project_id ?? null}
          // ── Phase D — workflow run context for UPSERT + field gating ──
          runId={run.id}
          runStepId={formStep.id}
          runContext={user ? {
            currentStepTemplateId: templateStepIdOf(formStep),
            currentUserId: user.id,
            isApprover:
              !!formStep.requires_approval && (
                formStep.approver_user_id === user.id ||
                (formStep.approver_role === 'admin'  && isAdmin) ||
                (formStep.approver_role === 'editor' && (isEditor || isAdmin))
              ),
          } : undefined}
          onClose={() => setFormStepId(null)}
          onSubmitted={async submissionId => {
            const patch: Partial<WorkflowStepResult> = {
              is_done: true,
              done_at: new Date().toISOString(),
              form_submission_id: submissionId,
            }
            if (formStep.requires_approval) {
              patch.approval_status = 'pending'
            }
            await updateResult.mutateAsync({ stepId: formStep.id, patch })
            await qc.invalidateQueries({ queryKey: ['run-submissions', runId] })
            await postFormCard(submissionId, formStepTemplate)
            setFormStepId(null)
          }}
          readOnly={formReadOnly}
        />
      )}
    </div>
  )
}
