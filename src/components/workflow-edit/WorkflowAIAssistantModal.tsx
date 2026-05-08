/**
 * WorkflowAIAssistantModal v3 — conversational split-panel wizard (Round-7).
 *
 * Layout (desktop): two columns inside the modal.
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Stage breadcrumb: ●Khung → ○S1 → ○S2 → ○Review              │
 *   ├──────────────────────────────┬──────────────────────────────┤
 *   │ CHAT (chat thread + input)   │ DRAFT preview (list + diff) │
 *   │                              │                              │
 *   │ [user]  ...                   │ S1 ✓ "Tiếp nhận đơn"        │
 *   │ [AI ✓]  ...                   │ S2 ✓ "Duyệt sơ bộ"          │
 *   │                              │ S3 + "Phê duyệt"   (added)  │
 *   │ ...                           │                              │
 *   │ [Input ...] [Send →]          │ ↶ Undo (3/3)  [Lưu khung] │
 *   └──────────────────────────────┴──────────────────────────────┘
 *
 * Sandbox model — all AI patches mutate a LOCAL draft. Editor's main
 * steps[] only updates when user clicks "Lưu". Up to 3 undo levels per
 * stage; cleared when stage is saved. Form CRUD is queued in
 * `pendingFormOps` and flushed on save via commitDraftToEditor.
 *
 * Stages auto-advance: Skeleton → S1 details → S2 details → … → Review.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Sparkles, Loader2, History, ChevronDown, ChevronRight, Send, Undo2,
  Check, Plus, Minus, Edit3, ArrowRight, FilePlus2,
} from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { useToast } from '../ui/Toast'
import { supabase } from '../../lib/supabase'
import { deriveCodes } from './codes'
import { dfsOrdered } from './stepTree'
import {
  applyPatchToDraft, mergeFormOps, commitDraftToEditor, emptyFormOps,
  type PendingFormOps,
} from './applyAIPatchToDraft'
import { validateAIWorkflowPatch } from '../../lib/workflowAISchema'
import type { AIWorkflowPatch } from '../../lib/workflowAISchema'
import type { StepDraft } from './types'
import type { FormTemplate } from '../../types'

// ─── Types ──────────────────────────────────────────────────────────────────

type Stage =
  | { kind: 'skeleton' }
  | { kind: 'detail'; stepIndex: number }
  | { kind: 'review' }
  | { kind: 'done' }

/**
 * Per-turn proposal state — Round-7c.
 *
 * Auto-apply was confusing: AI sometimes produces a patch with no
 * operations (just rationale), so the right preview didn't change and
 * users assumed the assistant was broken. New flow:
 *
 *   AI proposes → status='pending' (NOT applied yet)
 *      └─ user clicks Accept → status='accepted', patch applied,
 *         snapshot stored on this turn for Undo.
 *      └─ user clicks Bỏ qua → status='rejected', patch discarded.
 *      └─ on accepted bubble user clicks Undo → status='undone',
 *         snapshot restored. Only the LATEST 3 accepted turns can undo
 *         (older turns disable their Undo).
 *
 * Empty patches: status='advice' — bubble shows rationale only, no
 * Accept/Reject buttons (nothing to do).
 *
 * Errors / non-patch responses (review summary): status='info' or 'error'.
 */
type TurnStatus =
  | 'pending'        // assistant patch awaiting user consent
  | 'accepted'       // patch applied; possibly undoable
  | 'rejected'       // patch discarded
  | 'undone'         // patch was accepted then reverted
  | 'advice'         // assistant returned a non-empty rationale but no operations
  | 'info'           // generic informational (review summary, undo confirmation)
  | 'error'          // AI / network / validation error

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string                       // user prompt OR AI rationale (for assistant)
  status?: TurnStatus
  patch?: AIWorkflowPatch | null
  /** Snapshot of the draft + form-op queue captured BEFORE this patch was
   *  applied. Used by Undo to revert just this turn. */
  preApplyDraft?: StepDraft[]
  preApplyFormOps?: PendingFormOps
  warnings?: string[]
  ts: number
}

interface DBConversationTurn {
  role: 'user' | 'assistant'
  stage: string
  content: string
  focus_s_code?: string | null
  created_at?: string
}

interface Props {
  open: boolean
  onClose: () => void
  steps: StepDraft[]
  templateId: string | null
  templateName: string
  templateDescription: string
  templateGuidance: string
  formTemplates: FormTemplate[]
  /** When set, modal opens directly in detail stage focused on that S{N}. */
  initialFocusSCode?: string | null
  /**
   * Replace the editor's steps[] with the given list (used by per-stage Save).
   * The page handles applyInitialLayout internally.
   */
  /** May be async — round-7g: the page now persists the full workflow
   *  (workflow_templates + workflow_steps) on each AI stage save, so the
   *  modal must await this to know whether persistence succeeded. */
  onCommitDraft: (next: StepDraft[]) => Promise<void> | void
}

// ─── Stage helpers ──────────────────────────────────────────────────────────

function stageLabel(s: Stage, draftSteps: StepDraft[]): string {
  if (s.kind === 'skeleton') return 'Khung cơ bản'
  if (s.kind === 'review')   return 'Review tổng'
  if (s.kind === 'done')     return 'Hoàn tất'
  // detail
  const ordered = dfsOrdered(draftSteps)
  const target = ordered[s.stepIndex]
  if (!target) return 'Chi tiết bước'
  const codes = deriveCodes(draftSteps)
  return `Chi tiết ${codes.stepCode[target.id] ?? `S${s.stepIndex + 1}`}`
}

function stageStageKey(s: Stage): 'skeleton' | 'details' | 'review' {
  if (s.kind === 'skeleton') return 'skeleton'
  if (s.kind === 'review')   return 'review'
  return 'details'
}

function stageFocusSCode(s: Stage, draftSteps: StepDraft[]): string | undefined {
  if (s.kind !== 'detail') return undefined
  const ordered = dfsOrdered(draftSteps)
  const target = ordered[s.stepIndex]
  if (!target) return undefined
  return deriveCodes(draftSteps).stepCode[target.id]
}

function nextStage(curr: Stage, draftSteps: StepDraft[]): Stage {
  const ordered = dfsOrdered(draftSteps)
  if (curr.kind === 'skeleton') {
    return ordered.length > 0 ? { kind: 'detail', stepIndex: 0 } : { kind: 'review' }
  }
  if (curr.kind === 'detail') {
    if (curr.stepIndex + 1 < ordered.length) return { kind: 'detail', stepIndex: curr.stepIndex + 1 }
    return { kind: 'review' }
  }
  if (curr.kind === 'review') return { kind: 'done' }
  return { kind: 'done' }
}

function inferInitialStage(steps: StepDraft[], focusSCode?: string | null): Stage {
  if (focusSCode) {
    const ordered = dfsOrdered(steps)
    const codes = deriveCodes(steps)
    const idx = ordered.findIndex(s => codes.stepCode[s.id] === focusSCode)
    if (idx >= 0) return { kind: 'detail', stepIndex: idx }
  }
  if (steps.length === 0) return { kind: 'skeleton' }
  const hasIncomplete = steps.some(s => !s.description || !s.duration_hours || s.duration_hours <= 0)
  if (hasIncomplete) {
    const ordered = dfsOrdered(steps)
    const firstIncompleteIdx = ordered.findIndex(s => !s.description || !s.duration_hours)
    return { kind: 'detail', stepIndex: Math.max(0, firstIncompleteIdx) }
  }
  return { kind: 'review' }
}

// ─── Component ──────────────────────────────────────────────────────────────

const MAX_UNDO = 3

const QUICK_FILLS: Record<'skeleton' | 'details' | 'review', string[]> = {
  skeleton: [
    'Tạo nghiệp vụ duyệt hợp đồng đơn giản 4 bước',
    'Thêm rẽ nhánh sau bước cuối',
    'Bớt 1 bước cuối đi',
  ],
  details: [
    'Mô tả chi tiết bước này',
    'Đề xuất form phù hợp (ưu tiên dùng lại form sẵn có)',
    'Set duration realistic',
    'Có cần bước duyệt không?',
  ],
  review: [
    'Tổng kết workflow và chỉ ra điểm còn thiếu',
  ],
}

export default memo(function WorkflowAIAssistantModal({
  open, onClose, steps, templateId,
  templateName, templateDescription, templateGuidance,
  formTemplates, initialFocusSCode, onCommitDraft,
}: Props) {
  const qc = useQueryClient()
  const { success: toastSuccess } = useToast()

  // Initial draft = current editor steps (deep copy so mutations don't leak).
  const initialStage = useMemo(() => inferInitialStage(steps, initialFocusSCode), [steps, initialFocusSCode])

  const [stage, setStage] = useState<Stage>(initialStage)
  const [draft, setDraft] = useState<StepDraft[]>([])
  const [entryDraft, setEntryDraft] = useState<StepDraft[]>([])
  const [pendingFormOps, setPendingFormOps] = useState<PendingFormOps>(emptyFormOps)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [committing, setCommitting] = useState(false)

  // Conversation history loaded once per open (persistent, separate from
  // the current-stage `turns` which reset on stage advance).
  const [history, setHistory] = useState<DBConversationTurn[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  // Round-7d: detected localStorage draft, surfaced as a banner the user
  // can choose to restore or discard.
  const [pendingRestore, setPendingRestore] = useState<{
    draft: StepDraft[]
    pendingFormOps: PendingFormOps
    turns: ChatTurn[]
    stage: Stage
    savedAt: number
  } | null>(null)

  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  /** localStorage key for this modal's autosaved draft. */
  const draftKey = templateId ? `bos_ai_draft_${templateId}` : null

  // ─── Reset on open ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const fresh = steps.map(s => ({ ...s }))
    setDraft(fresh)
    setEntryDraft(fresh)
    setPendingFormOps(emptyFormOps)
    setTurns([])
    setInput('')
    setStage(inferInitialStage(steps, initialFocusSCode))
    setHistoryLoaded(false)
    setHistoryOpen(false)

    // Check for localStorage autosave from a previous session.
    if (draftKey) {
      try {
        const raw = localStorage.getItem(draftKey)
        if (raw) {
          const parsed = JSON.parse(raw) as {
            draft: StepDraft[]
            pendingFormOps: PendingFormOps
            turns: ChatTurn[]
            stage: Stage
            savedAt: number
          }
          // Only surface restore if it's recent (< 7 days) and contains
          // anything substantive.
          const ageDays = (Date.now() - (parsed.savedAt ?? 0)) / 86_400_000
          const hasSomething = (parsed.turns?.length ?? 0) > 0 || (parsed.draft?.length ?? 0) !== fresh.length
          if (ageDays < 7 && hasSomething) {
            setPendingRestore(parsed)
          } else {
            localStorage.removeItem(draftKey)
          }
        }
      } catch (err) {
        console.warn('[AI modal] failed to read autosave:', err)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFocusSCode])

  // ─── Auto-save to localStorage (debounced 500ms) ─────────────────────────
  useEffect(() => {
    if (!open || !draftKey || pendingRestore) return  // don't autosave while a restore prompt is up
    const t = setTimeout(() => {
      try {
        const payload = {
          draft, pendingFormOps, turns, stage,
          savedAt: Date.now(),
        }
        localStorage.setItem(draftKey, JSON.stringify(payload))
      } catch (err) {
        console.warn('[AI modal] autosave failed:', err)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [open, draftKey, draft, pendingFormOps, turns, stage, pendingRestore])

  function clearAutosave() {
    if (draftKey) {
      try { localStorage.removeItem(draftKey) } catch {}
    }
  }

  function applyRestore() {
    if (!pendingRestore) return
    setDraft(pendingRestore.draft)
    setPendingFormOps(pendingRestore.pendingFormOps)
    setTurns(pendingRestore.turns)
    setStage(pendingRestore.stage)
    setPendingRestore(null)
  }

  function discardRestore() {
    clearAutosave()
    setPendingRestore(null)
  }

  // ─── Load DB conversation history ─────────────────────────────────────────
  useEffect(() => {
    if (!open || historyLoaded || !templateId) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('workflow_ai_conversations')
        .select('messages')
        .eq('template_id', templateId)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        console.warn('[AI modal] history load failed (migration #27 pending?):', error.message)
      } else if (data?.messages && Array.isArray(data.messages)) {
        setHistory(data.messages as DBConversationTurn[])
      } else {
        setHistory([])
      }
      setHistoryLoaded(true)
    })()
    return () => { cancelled = true }
  }, [open, templateId, historyLoaded])

  // ─── Auto-scroll chat to bottom on new turns ──────────────────────────────
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [turns.length])

  /**
   * Detect whether a user prompt is asking for a CHANGE vs just a review.
   * Round-7c: when the user is in Review stage but asks to actually
   * modify the workflow (e.g. "bỏ bớt bước S3", "thêm bước duyệt"),
   * we override the stage to 'details' so the edge function returns a
   * patch instead of a text-only summary.
   */
  function looksLikeModificationRequest(text: string): boolean {
    return /\b(xo[áa]|b[ỏo]|b[ớo]t|th[êe]m|s[ửu]a|đ[ổo]i|b[ổo] sung|thay|gh[ée]p|t[áa]ch|chia|d[ờo]i|chuy[ểe]n|r[úu]t|đ[ưa]a|nh[âa]n|đ[ổo]i t[êe]n|đ[ổo]i tr[ậa]ng)\b/i.test(text)
  }

  // ─── Build payload for the edge function ──────────────────────────────────
  function buildPayload(prompt: string) {
    const codes = deriveCodes(draft)
    const stepsWithCodes = draft.map(s => ({
      s_code: codes.stepCode[s.id],
      title: s.title,
      step_type: s.step_type,
      branch_options: s.branch_options.length > 0 ? s.branch_options : undefined,
      parent_s_code: s.parent_step_id ? codes.stepCode[s.parent_step_id] ?? null : null,
      branch_condition: s.branch_condition,
      requires_approval: s.requires_approval,
      approver_role: s.approver_role,
      duration_hours: s.duration_hours,
      description: s.description || null,
      attached_form_code: s.form_template_id ? codes.formCode[s.form_template_id] ?? null : null,
    }))

    const formsInUse: Array<{ f_code: string; name: string; description?: string; fields: { id: string; label: string; type: string; required?: boolean; options?: string[] }[] }> = []
    const seenForms = new Set<string>()
    for (const s of draft) {
      if (!s.form_template_id || seenForms.has(s.form_template_id)) continue
      seenForms.add(s.form_template_id)
      const tmpl = formTemplates.find(f => f.id === s.form_template_id)
      if (!tmpl) continue
      formsInUse.push({
        f_code: codes.formCode[s.form_template_id] ?? '?',
        name: tmpl.name,
        description: tmpl.description ?? undefined,
        fields: tmpl.fields.map(f => ({
          id: f.id, label: f.label, type: f.type,
          required: f.required, options: f.options,
        })),
      })
    }

    // Round-7c: Review-stage prompts that look like modification requests
    // get auto-routed as 'details' so the edge function returns a patch.
    const baseStage = stageStageKey(stage)
    const effectiveStage = baseStage === 'review' && looksLikeModificationRequest(prompt)
      ? 'details'
      : baseStage

    return {
      user_prompt: prompt,
      stage: effectiveStage,
      focus_step_s_code: stageFocusSCode(stage, draft),
      template_id: templateId ?? undefined,
      current_template: {
        name: templateName,
        description: templateDescription,
        guidance_html: templateGuidance,
      },
      current_steps_with_codes: stepsWithCodes,
      current_forms_with_codes_full: formsInUse,
      conversation_history: [
        ...history.slice(-6).map(t => ({ role: t.role, stage: t.stage, content: t.content.slice(0, 300) })),
        ...turns.slice(-8).map(t => ({
          role: t.role,
          stage: stageStageKey(stage),
          content: t.content.slice(0, 300),
        })),
      ],
    }
  }

  // ─── Send a chat turn ─────────────────────────────────────────────────────
  async function send(prompt?: string) {
    const text = (prompt ?? input).trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)

    const userTurn: ChatTurn = { role: 'user', content: text, ts: Date.now() }
    setTurns(prev => [...prev, userTurn])

    try {
      const { data, error } = await supabase.functions.invoke('workflow-ai', {
        body: buildPayload(text),
      })

      if (error) {
        const msg = String(error.message ?? '')
        const looksMissing = /not\s*found|404|edge function not/i.test(msg) ||
          (error as { context?: { status?: number } }).context?.status === 404
        const errMsg = looksMissing
          ? 'Edge function `workflow-ai` chưa deploy hoặc cần update. Mở Dashboard → Edge Functions → workflow-ai → paste code mới → Deploy.'
          : `Edge function lỗi: ${msg}`
        setTurns(prev => [...prev, { role: 'assistant', status: 'error', content: errMsg, ts: Date.now() }])
        setBusy(false)
        return
      }

      const body = data as { patch?: unknown; summary?: { rationale: string; suggestions: string[] }; error?: string }

      if (body.error) {
        setTurns(prev => [...prev, { role: 'assistant', status: 'error', content: body.error!, ts: Date.now() }])
        setBusy(false)
        return
      }

      // If the edge function returned a review summary (regardless of stage),
      // render as info bubble. The auto-stage-override above means a Review
      // stage prompt asking for changes will fall through to the patch
      // branch instead of hitting this.
      if (body.summary && Array.isArray(body.summary.suggestions)) {
        const lines = [body.summary.rationale, '', '**Đề xuất:**', ...body.summary.suggestions.map(s => `• ${s}`)]
        setTurns(prev => [...prev, { role: 'assistant', status: 'info', content: lines.join('\n'), ts: Date.now() }])
        setBusy(false)
        return
      }

      const v = validateAIWorkflowPatch(body.patch)
      if ('error' in v) {
        const m = `Patch không hợp lệ: ${v.error}`
        setTurns(prev => [...prev, { role: 'assistant', status: 'error', content: m, ts: Date.now() }])
        setBusy(false)
        return
      }

      const patch = v.ok

      // Round-7c: do NOT auto-apply. If the patch has zero operations,
      // mark the bubble as 'advice' (no Accept button — nothing to do).
      // Otherwise mark as 'pending' awaiting user's Accept.
      const hasOps =
        (patch.add_steps?.length ?? 0) +
        (patch.modify_steps?.length ?? 0) +
        (patch.remove_step_codes?.length ?? 0) +
        (patch.add_forms?.length ?? 0) +
        (patch.modify_forms?.length ?? 0) > 0

      setTurns(prev => [...prev, {
        role: 'assistant',
        status: hasOps ? 'pending' : 'advice',
        content: patch.rationale,
        patch,
        ts: Date.now(),
      }])
    } catch (err) {
      const m = (err as Error).message
      setTurns(prev => [...prev, { role: 'assistant', status: 'error', content: m, ts: Date.now() }])
    } finally {
      setBusy(false)
      // Refresh DB history (best-effort).
      if (templateId) {
        setHistoryLoaded(false)
      }
    }
  }

  // ─── Per-turn Accept / Reject / Undo ─────────────────────────────────────

  /** Apply this turn's patch to the draft and snapshot the pre-state for Undo. */
  function acceptTurn(idx: number) {
    setTurns(prev => {
      const turn = prev[idx]
      if (!turn || turn.status !== 'pending' || !turn.patch) return prev

      // Snapshot BEFORE apply.
      const snapshotDraft = draft.map(s => ({ ...s }))
      const snapshotOps   = pendingFormOps

      const result = applyPatchToDraft(draft, turn.patch)
      setDraft(result.draft)
      setPendingFormOps(p => mergeFormOps(p, result.formOps))

      const next = [...prev]
      next[idx] = {
        ...turn,
        status: 'accepted',
        preApplyDraft: snapshotDraft,
        preApplyFormOps: snapshotOps,
        warnings: result.warnings,
      }
      return next
    })
  }

  function rejectTurn(idx: number) {
    setTurns(prev => {
      const turn = prev[idx]
      if (!turn || turn.status !== 'pending') return prev
      const next = [...prev]
      next[idx] = { ...turn, status: 'rejected' }
      return next
    })
  }

  function undoTurn(idx: number) {
    setTurns(prev => {
      const turn = prev[idx]
      if (!turn || turn.status !== 'accepted' || !turn.preApplyDraft) return prev

      // Restore the snapshot taken before this turn was accepted.
      setDraft(turn.preApplyDraft.map(s => ({ ...s })))
      setPendingFormOps(turn.preApplyFormOps ?? emptyFormOps)

      const next = [...prev]
      next[idx] = { ...turn, status: 'undone' }
      return next
    })
  }

  /** Index the latest 3 'accepted' turns — only those have an active Undo. */
  const undoableIdx = useMemo(() => {
    const accepted: number[] = []
    for (let i = turns.length - 1; i >= 0 && accepted.length < MAX_UNDO; i--) {
      if (turns[i].status === 'accepted') accepted.push(i)
    }
    return new Set(accepted)
  }, [turns])

  // ─── Save current stage → commit draft + advance ──────────────────────────
  async function saveStage() {
    if (committing) return
    setCommitting(true)
    try {
      // Round-7g: must use DRAFT codes here, NOT editor codes. The AI patch
      // references F{N} via draft's perspective (form attachments accepted
      // earlier in the modal session), so editor's current `steps` may have
      // a different / stale F-code map. Using editor codes caused
      // `currentCodes.formIdByCode[m.f_code]` to fail silently when the
      // user attached a new form earlier in the same chat.
      const currentCodes = deriveCodes(draft)
      const result = await commitDraftToEditor(draft, pendingFormOps, supabase, qc, currentCodes)
      // Round-7g: await onCommitDraft so we know whether the page-level
      // persist succeeded before advancing the stage. If it fails, the
      // catch block surfaces the error in the chat and we stay in the
      // current stage so the user can retry.
      await onCommitDraft(result.steps)

      // Advance to next stage with fresh entry baseline.
      const prevStage = stage
      const next = nextStage(prevStage, result.steps)
      setStage(next)
      setEntryDraft(result.steps.map(s => ({ ...s })))
      setDraft(result.steps.map(s => ({ ...s })))
      setPendingFormOps(emptyFormOps)
      // Clear chat — committed turns are baked in for this stage; new
      // stage starts fresh.
      setTurns([])
      setInput('')
      // Clear localStorage autosave — the previous stage is now committed
      // to DB; no need to keep its draft around.
      clearAutosave()

      // Round-7e: surface the stage transition explicitly so user knows
      // we're now in S1 detail / S2 detail / Review / etc. — without this,
      // the chat clears and users think the modal "disappeared".
      if (next.kind === 'detail') {
        const ordered = dfsOrdered(result.steps)
        const code = deriveCodes(result.steps).stepCode[ordered[next.stepIndex]?.id] ?? `S${next.stepIndex + 1}`
        toastSuccess(`✓ Đã lưu. Tiếp theo: chi tiết ${code}.`)
      } else if (next.kind === 'review') {
        toastSuccess('✓ Đã lưu. Tiếp theo: review tổng.')
      } else if (next.kind === 'done') {
        toastSuccess('✓ Hoàn tất. Đóng modal…')
        // Auto-close on done.
        setTimeout(() => onClose(), 600)
      }
    } catch (err) {
      setTurns(prev => [...prev, {
        role: 'assistant',
        status: 'error',
        content: `Lỗi khi lưu: ${(err as Error).message}`,
        ts: Date.now(),
      }])
    } finally {
      setCommitting(false)
    }
  }

  /** Jump directly to a target stage from the breadcrumb. Skips any
   *  in-flight commit; just changes the local stage state and clears
   *  the chat. Used for non-linear navigation. */
  function jumpToStage(target: Stage) {
    setStage(target)
    setTurns([])
    setInput('')
  }

  // ─── Skip stage (no commit, just advance) ─────────────────────────────────
  function skipStage() {
    const next = nextStage(stage, draft)
    setStage(next)
    setTurns([])
    setInput('')
    if (next.kind === 'done') setTimeout(() => onClose(), 300)
  }

  // ─── Diff between entryDraft and current draft (for highlight) ────────────
  const diffMap = useMemo(() => computeDiff(entryDraft, draft), [entryDraft, draft])

  // ─── Code maps for current draft ──────────────────────────────────────────
  const codes = useMemo(() => deriveCodes(draft), [draft])

  const stageKey = stageStageKey(stage)
  const quickFills = QUICK_FILLS[stageKey]
  const orderedDraft = useMemo(() => dfsOrdered(draft), [draft])
  const focusedStep = stage.kind === 'detail' ? orderedDraft[stage.stepIndex] : null

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Modal open={open} onClose={onClose} size="full" title="Trợ lý AI — xây nghiệp vụ">
      {/*
        Round-7e: explicit flex column with bounded height so the inner
        2-panel grid (chat + draft) gets flex-1 of the remaining space.
        Without this, the modal body scrolls and the bottom action bar /
        chat input fall below the fold.

        The height calc accounts for: viewport (100vh) - modal max-h gap
        (10vh ≈ space around modal) - header (~48px) - body padding
        (~32px) - footer hint (~24px) ≈ 75vh of usable inner room.
      */}
      <div className="flex flex-col gap-2 min-h-0 relative" style={{ height: 'calc(90vh - 110px)' }}>

      {/* Stage breadcrumb */}
      <StageBreadcrumb
        stage={stage}
        draft={draft}
        onJump={jumpToStage}
        historyCount={history.length}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen(v => !v)}
      />

      {/* Round-7d: localStorage restore banner */}
      {pendingRestore && (
        <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <History size={14} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 text-[12px] text-amber-900">
            Phát hiện bản nháp chưa lưu lúc{' '}
            <strong>
              {new Date(pendingRestore.savedAt).toLocaleString('vi', {
                hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
              })}
            </strong>{' '}
            ({pendingRestore.turns.length} lượt chat, {pendingRestore.draft.length} bước).
          </div>
          <button
            type="button"
            onClick={applyRestore}
            className="text-[11px] px-2 py-0.5 bg-primary-600 text-white rounded hover:bg-primary-700 shrink-0"
          >
            Khôi phục
          </button>
          <button
            type="button"
            onClick={discardRestore}
            className="text-[11px] px-2 py-0.5 border border-amber-300 text-amber-800 rounded hover:bg-amber-100 shrink-0"
          >
            Bỏ
          </button>
        </div>
      )}

      {/* Round-7i: history collapsed into a tiny floating popover triggered
           by the History icon button above (placed inside StageBreadcrumb).
           No more row-eating banner. */}
      {history.length > 0 && historyOpen && (
        <div className="absolute z-30 mt-1 right-4 w-[420px] max-h-[260px] overflow-y-auto bg-white border border-neutral-200 rounded-lg shadow-lg p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
            Lịch sử với AI · {history.length} lượt
          </p>
          <ul className="space-y-1 text-[10px]">
            {history.slice(-12).map((t, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className={`shrink-0 px-1 rounded text-[9px] font-mono ${
                  t.role === 'user' ? 'bg-primary-100 text-primary-700' : 'bg-amber-100 text-amber-700'
                }`}>{t.stage}</span>
                <span className="text-neutral-600 line-clamp-2">{t.content.slice(0, 200)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Two-panel body — flex-1 of the parent column so the action bar at
           the bottom of each panel stays pinned in view (no modal scroll). */}
      <div className="grid md:grid-cols-[1fr_1fr] gap-3 flex-1 min-h-0">
        {/* ─── CHAT PANEL ─── */}
        <div className="flex flex-col border border-neutral-200 rounded-lg bg-white min-h-0 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-neutral-100 bg-neutral-25 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            Hội thoại — {stageLabel(stage, draft)}
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {turns.length === 0 && (
              <div className="text-[11px] text-neutral-500 space-y-2">
                {stage.kind === 'skeleton' && (
                  <p className="italic text-neutral-400">Mô tả nghiệp vụ bạn muốn tạo (hoặc nhập "tiếp tục" để AI gợi ý).</p>
                )}
                {stage.kind === 'detail' && focusedStep && (
                  <DetailStageContext
                    step={focusedStep}
                    codes={codes}
                    formTemplates={formTemplates}
                  />
                )}
                {stage.kind === 'review' && (
                  <p className="italic text-neutral-400">AI sẽ tổng kết workflow + chỉ ra điểm thiếu khi bạn gửi prompt.</p>
                )}
                {stage.kind === 'done' && (
                  <p className="italic text-neutral-400">Đã hoàn tất.</p>
                )}
              </div>
            )}

            {turns.map((t, i) => (
              <ChatBubble
                key={i}
                turn={t}
                codes={codes}
                draftSteps={draft}
                undoable={undoableIdx.has(i)}
                onAccept={() => acceptTurn(i)}
                onReject={() => rejectTurn(i)}
                onUndo={() => undoTurn(i)}
              />
            ))}

            {busy && (
              <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                <Loader2 size={11} className="animate-spin text-primary-600" />
                AI đang phản hồi…
              </div>
            )}
          </div>

          {/* Quick-fill chips */}
          <div className="px-2 pt-1 flex flex-wrap gap-1 border-t border-neutral-100">
            {quickFills.map(q => (
              <button
                key={q}
                type="button"
                onClick={() => setInput(q)}
                disabled={busy}
                className="text-[10px] px-1.5 py-0.5 border border-neutral-200 rounded text-neutral-600 hover:bg-primary-50 hover:border-primary-300 disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="px-2 pb-2 pt-1 flex gap-1.5 border-t border-neutral-100">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder={
                stage.kind === 'skeleton' ? 'Ví dụ: Tạo workflow duyệt hợp đồng 4 bước…' :
                stage.kind === 'detail'   ? 'Ví dụ: Bước này thu thập thông tin khách hàng — đề xuất form.' :
                                             'Ví dụ: Workflow này có thiếu gì không?'
              }
              rows={2}
              disabled={busy || stage.kind === 'done'}
              className="flex-1 border border-neutral-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:border-primary-400 resize-none disabled:bg-neutral-50"
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={busy || !input.trim() || stage.kind === 'done'}
              className="self-end px-2 py-1.5 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:bg-neutral-300 transition-colors"
              title="Gửi (Ctrl/Cmd + Enter)"
            >
              <Send size={12} />
            </button>
          </div>
        </div>

        {/* ─── DRAFT PREVIEW PANEL ─── */}
        <div className="flex flex-col border border-neutral-200 rounded-lg bg-white min-h-0 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-neutral-100 bg-neutral-25 text-[10px] font-semibold uppercase tracking-wider text-neutral-600 flex items-center gap-2">
            <span>Bản nháp ({draft.length} bước)</span>
            {pendingFormOps.add.length + pendingFormOps.modify.length > 0 && (
              <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700 normal-case tracking-normal">
                {pendingFormOps.add.length > 0 && `+${pendingFormOps.add.length} form mới `}
                {pendingFormOps.modify.length > 0 && `${pendingFormOps.modify.length} form sửa`}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            <DraftListView
              draft={draft}
              codes={codes}
              diff={diffMap}
              focusedStepId={focusedStep?.id}
              formTemplates={formTemplates}
              pendingFormOps={pendingFormOps}
            />
          </div>

          {/* Action bar — round-7c: undo moved to per-turn (in chat bubble) */}
          <div className="px-2 py-2 border-t border-neutral-100 bg-neutral-25 flex items-center gap-2">
            <span className="text-[10px] text-neutral-400 italic">
              Undo nằm trên từng bubble accept ↑
            </span>
            <div className="flex-1" />
            {stage.kind !== 'done' && (
              <button
                type="button"
                onClick={skipStage}
                disabled={busy || committing}
                className="text-[11px] text-neutral-500 hover:text-neutral-800 px-2 py-1"
              >
                Bỏ qua
              </button>
            )}
            <Button
              size="sm"
              onClick={saveStage}
              disabled={busy || committing || stage.kind === 'done'}
            >
              {committing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {stage.kind === 'review' ? 'Hoàn tất' : `Lưu ${stageLabel(stage, draft).toLowerCase()}`}
              {stage.kind !== 'review' && <ArrowRight size={12} />}
            </Button>
          </div>
        </div>
      </div>

      {/* Footer hint */}
      <p className="text-[10px] text-neutral-500 italic shrink-0">
        AI chỉ sửa <strong>bản nháp</strong> bên phải. Canvas chính chỉ cập nhật khi bạn bấm "Lưu". Form mới được tạo trong DB ngay khi lưu stage.
      </p>
      </div>
    </Modal>
  )
})

// ─── Sub-components ─────────────────────────────────────────────────────────

function StageBreadcrumb({
  stage, draft, onJump,
  historyCount, historyOpen, onToggleHistory,
}: {
  stage: Stage
  draft: StepDraft[]
  onJump: (target: Stage) => void
  historyCount: number
  historyOpen: boolean
  onToggleHistory: () => void
}) {
  const ordered = dfsOrdered(draft)
  const codes = deriveCodes(draft)

  type Item = { key: string; label: string; current: boolean; done: boolean; target: Stage }
  const items: Item[] = [
    { key: 'skeleton', label: 'Khung', current: stage.kind === 'skeleton', done: stage.kind !== 'skeleton', target: { kind: 'skeleton' } },
  ]
  for (let i = 0; i < ordered.length; i++) {
    const code = codes.stepCode[ordered[i].id] ?? `S${i + 1}`
    items.push({
      key: `step-${i}`,
      label: code,
      current: stage.kind === 'detail' && stage.stepIndex === i,
      done: stage.kind === 'review' || stage.kind === 'done' || (stage.kind === 'detail' && stage.stepIndex > i),
      target: { kind: 'detail', stepIndex: i },
    })
  }
  items.push({ key: 'review', label: 'Review', current: stage.kind === 'review', done: stage.kind === 'done', target: { kind: 'review' } })

  // Friendly title for the CURRENT stage shown above the chips.
  const currentLabel =
    stage.kind === 'skeleton' ? 'Đang xây khung tổng thể'
    : stage.kind === 'detail'
      ? `Đang chi tiết hoá ${codes.stepCode[ordered[stage.stepIndex]?.id] ?? `S${stage.stepIndex + 1}`} — "${ordered[stage.stepIndex]?.title || '(chưa đặt tên)'}"`
    : stage.kind === 'review' ? 'Đang review tổng thể'
    : 'Hoàn tất'

  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-neutral-800 mb-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
        <span className="flex-1">{currentLabel}</span>
        {historyCount > 0 && (
          <button
            type="button"
            onClick={onToggleHistory}
            title={`Lịch sử với AI (${historyCount} lượt)`}
            className={`text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 border rounded transition-colors ${
              historyOpen
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-neutral-200 text-neutral-500 hover:bg-neutral-50'
            }`}
          >
            <History size={10} />
            <span className="font-mono">{historyCount}</span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-1 flex-wrap text-[10px]">
        {items.map((it, i) => (
          <span key={it.key} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { if (!it.current) onJump(it.target) }}
              disabled={it.current}
              className={`px-1.5 py-0.5 rounded font-mono transition-colors ${
                it.current
                  ? 'bg-primary-600 text-white cursor-default'
                  : it.done
                    ? 'bg-green-100 text-green-700 border border-green-200 hover:bg-green-200'
                    : 'bg-neutral-100 text-neutral-500 border border-neutral-200 hover:bg-neutral-200'
              }`}
              title={it.current ? 'Đang ở đây' : 'Bấm để chuyển stage'}
            >
              {it.done && !it.current && <Check size={9} className="inline -mt-0.5 mr-0.5" />}
              {it.label}
            </button>
            {i < items.length - 1 && <span className="text-neutral-300">→</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Round-7e: when user lands in a detail stage, surface the step's CURRENT
 * state so they can see what's already been built vs. what AI will fill.
 * This makes the inheritance contract obvious — "AI will build on top of
 * what's here, not overwrite it."
 */
function DetailStageContext({
  step, codes, formTemplates,
}: {
  step: StepDraft
  codes: ReturnType<typeof deriveCodes>
  formTemplates: FormTemplate[]
}) {
  const formCode = step.form_template_id ? codes.formCode[step.form_template_id] : null
  const formName = step.form_template_id
    ? formTemplates.find(f => f.id === step.form_template_id)?.name
    : null

  const filled: { label: string; value: string }[] = []
  if (step.title)            filled.push({ label: 'Tên',      value: step.title })
  if (step.description)      filled.push({ label: 'Mô tả',    value: step.description })
  if (step.duration_hours)   filled.push({ label: 'Thời gian',value: `${step.duration_hours} tiếng` })
  if (step.requires_approval) filled.push({ label: 'Duyệt',    value: step.approver_role ?? 'có' })
  if (step.step_type === 'branch') filled.push({ label: 'Loại', value: `rẽ nhánh (${step.branch_options.join(' / ')})` })
  if (formName)              filled.push({ label: 'Form',     value: `${formCode ?? 'F?'} · ${formName}` })

  const missing: string[] = []
  if (!step.description)     missing.push('mô tả')
  if (!step.duration_hours)  missing.push('thời gian')
  if (!step.form_template_id && step.step_type !== 'branch') missing.push('form (tuỳ chọn)')

  return (
    <div className="space-y-2">
      <p className="font-semibold text-neutral-700">
        Đang chỉnh {codes.stepCode[step.id]} — "{step.title || '(chưa đặt tên)'}"
      </p>
      {filled.length > 0 && (
        <div className="bg-green-50/50 border border-green-200 rounded px-2 py-1.5">
          <p className="text-[10px] font-semibold text-green-800 mb-1">✓ Đã có sẵn (AI sẽ giữ):</p>
          <ul className="space-y-0.5">
            {filled.map((f, i) => (
              <li key={i} className="text-[11px] text-neutral-700">
                <span className="text-neutral-500">{f.label}:</span> {f.value}
              </li>
            ))}
          </ul>
        </div>
      )}
      {missing.length > 0 && (
        <div className="bg-amber-50/40 border border-amber-200 rounded px-2 py-1.5">
          <p className="text-[10px] font-semibold text-amber-800 mb-1">○ Còn thiếu:</p>
          <p className="text-[11px] text-neutral-700">{missing.join(', ')}</p>
        </div>
      )}
      <p className="text-[10px] italic text-neutral-500">
        Yêu cầu AI giúp điền nốt phần còn thiếu, hoặc đề xuất form phù hợp.
      </p>
    </div>
  )
}

function ChatBubble({
  turn, codes, draftSteps, undoable,
  onAccept, onReject, onUndo,
}: {
  turn: ChatTurn
  codes: ReturnType<typeof deriveCodes>
  draftSteps: StepDraft[]
  undoable: boolean
  onAccept: () => void
  onReject: () => void
  onUndo: () => void
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary-600 text-white text-xs rounded-lg px-2 py-1 leading-snug">
          {turn.content}
        </div>
      </div>
    )
  }

  // ─── Assistant turn ───
  const tone = bubbleTone(turn.status)

  return (
    <div className="flex justify-start">
      <div className={`max-w-[92%] text-xs rounded-lg px-2 py-1.5 leading-snug whitespace-pre-wrap ${tone.bg}`}>
        {/* Header */}
        <div className="flex items-center gap-1 mb-1">
          <Sparkles size={10} className={tone.icon} />
          <span className="text-[9px] font-mono uppercase tracking-wider opacity-60">
            {statusLabel(turn.status)}
          </span>
        </div>

        {/* Rationale / error message */}
        <div className={turn.status === 'rejected' || turn.status === 'undone' ? 'opacity-60 line-through' : ''}>
          {turn.content}
        </div>

        {/* Patch detail panel — only for patches that have something to show */}
        {turn.patch && turn.status !== 'error' && (
          <PatchDetail patch={turn.patch} codes={codes} draftSteps={draftSteps} />
        )}

        {/* Warnings */}
        {turn.warnings && turn.warnings.length > 0 && (
          <ul className="mt-1 text-[10px] text-amber-700 space-y-0.5">
            {turn.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
          </ul>
        )}

        {/* Action buttons */}
        {turn.status === 'pending' && (
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={onAccept}
              className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 bg-primary-600 text-white rounded hover:bg-primary-700"
            >
              <Check size={10} /> Accept
            </button>
            <button
              type="button"
              onClick={onReject}
              className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 border border-neutral-300 text-neutral-600 rounded hover:bg-neutral-50"
            >
              Bỏ qua
            </button>
          </div>
        )}

        {turn.status === 'accepted' && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[10px] text-green-700 font-semibold">✓ Đã áp dụng</span>
            <button
              type="button"
              onClick={onUndo}
              disabled={!undoable}
              title={undoable ? 'Hoàn tác patch này' : 'Chỉ có thể hoàn tác 3 patch mới nhất'}
              className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 border border-neutral-300 text-neutral-600 rounded hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Undo2 size={10} /> Undo
            </button>
          </div>
        )}

        {turn.status === 'rejected' && (
          <p className="mt-1 text-[10px] text-neutral-500 italic">Đã bỏ qua.</p>
        )}
        {turn.status === 'undone' && (
          <p className="mt-1 text-[10px] text-neutral-500 italic">Đã hoàn tác.</p>
        )}
        {turn.status === 'advice' && (
          <p className="mt-1 text-[10px] text-neutral-500 italic">
            (AI chỉ đưa lời khuyên — không có thay đổi để áp dụng)
          </p>
        )}
      </div>
    </div>
  )
}

function bubbleTone(status: TurnStatus | undefined) {
  switch (status) {
    case 'error':    return { bg: 'bg-red-50 border border-red-200 text-red-700',     icon: 'text-red-500' }
    case 'pending':  return { bg: 'bg-primary-50/50 border border-primary-200 text-neutral-800', icon: 'text-primary-600' }
    case 'accepted': return { bg: 'bg-green-50/60 border border-green-200 text-neutral-800',    icon: 'text-green-600' }
    case 'rejected': return { bg: 'bg-neutral-50 border border-neutral-200 text-neutral-700',   icon: 'text-neutral-400' }
    case 'undone':   return { bg: 'bg-neutral-50 border border-neutral-200 text-neutral-700',   icon: 'text-neutral-400' }
    case 'advice':   return { bg: 'bg-amber-50/60 border border-amber-200 text-neutral-800',    icon: 'text-amber-600' }
    case 'info':     return { bg: 'bg-primary-50/40 border border-primary-100 text-neutral-800', icon: 'text-primary-600' }
    default:         return { bg: 'bg-neutral-100 text-neutral-800', icon: 'text-primary-600' }
  }
}

function statusLabel(status: TurnStatus | undefined): string {
  switch (status) {
    case 'error':    return 'AI · lỗi'
    case 'pending':  return 'AI · đề xuất'
    case 'accepted': return 'AI · đã áp dụng'
    case 'rejected': return 'AI · đã bỏ qua'
    case 'undone':   return 'AI · đã hoàn tác'
    case 'advice':   return 'AI · gợi ý'
    case 'info':     return 'AI · tổng kết'
    default:         return 'AI'
  }
}

/** PatchDetail — surface every operation in the patch so the user knows
 *  exactly what Accept will do. Renders compactly with colour-coded sections. */
function PatchDetail({
  patch, codes, draftSteps,
}: {
  patch: AIWorkflowPatch
  codes: ReturnType<typeof deriveCodes>
  draftSteps: StepDraft[]
}) {
  const adds      = patch.add_steps ?? []
  const mods      = patch.modify_steps ?? []
  const rms       = patch.remove_step_codes ?? []
  const addForms  = patch.add_forms ?? []
  const modForms  = patch.modify_forms ?? []

  const total = adds.length + mods.length + rms.length + addForms.length + modForms.length
  if (total === 0) return null

  return (
    <div className="mt-1.5 text-[10px] space-y-0.5 border-l-2 border-neutral-300 pl-1.5">
      {adds.map(s => (
        <div key={`add-${s.code}`} className="text-green-700">
          + Thêm <span className="font-mono">{s.code}</span> "{s.title}"
          {s.step_type === 'branch' && <> (rẽ nhánh: {(s.branch_options ?? []).join('/')})</>}
        </div>
      ))}
      {mods.map(m => {
        const stepId = codes.stepIdByCode[m.s_code]
        const orig   = stepId ? draftSteps.find(s => s.id === stepId) : null
        const fields = Object.keys(m.patch).join(', ')
        return (
          <div key={`mod-${m.s_code}`} className="text-amber-700">
            ↻ Sửa <span className="font-mono">{m.s_code}</span>
            {orig && <> "{orig.title}"</>} ({fields})
          </div>
        )
      })}
      {rms.map(c => {
        const stepId = codes.stepIdByCode[c]
        const orig   = stepId ? draftSteps.find(s => s.id === stepId) : null
        return (
          <div key={`rm-${c}`} className="text-red-700">
            − Xoá <span className="font-mono">{c}</span>{orig && <> "{orig.title}"</>}
          </div>
        )
      })}
      {addForms.map(f => (
        <div key={`addf-${f.code}`} className="text-green-700">
          + Form mới <span className="font-mono">{f.code}</span> "{f.name}" ({f.fields.length} fields)
        </div>
      ))}
      {modForms.map(m => (
        <div key={`modf-${m.f_code}`} className="text-amber-700">
          ↻ Sửa form <span className="font-mono">{m.f_code}</span>:{' '}
          +{m.add_fields?.length ?? 0}/↻{m.modify_fields?.length ?? 0}/−{m.remove_field_ids?.length ?? 0} fields
        </div>
      ))}
    </div>
  )
}

// ─── Diff computation ───────────────────────────────────────────────────────

interface StepDiffEntry {
  status: 'added' | 'removed' | 'modified' | 'unchanged'
  changedFields?: string[]
}

function computeDiff(entry: StepDraft[], current: StepDraft[]): {
  byId: Record<string, StepDiffEntry>
  removedIds: string[]
} {
  const byId: Record<string, StepDiffEntry> = {}
  const entryById = new Map(entry.map(s => [s.id, s]))
  const currentIds = new Set(current.map(s => s.id))

  for (const s of current) {
    const before = entryById.get(s.id)
    if (!before) {
      byId[s.id] = { status: 'added' }
    } else {
      const changed: string[] = []
      const keys: (keyof StepDraft)[] = [
        'title', 'description', 'duration_hours', 'requires_approval',
        'approver_role', 'parent_step_id', 'branch_condition',
        'form_template_id', 'helper_panel_id', 'step_type',
      ]
      for (const k of keys) {
        if (s[k] !== before[k]) changed.push(k as string)
      }
      // branch_options array compare
      const a = before.branch_options.join('|')
      const b = s.branch_options.join('|')
      if (a !== b) changed.push('branch_options')
      byId[s.id] = changed.length > 0 ? { status: 'modified', changedFields: changed } : { status: 'unchanged' }
    }
  }

  const removedIds: string[] = []
  for (const s of entry) {
    if (!currentIds.has(s.id)) removedIds.push(s.id)
  }
  return { byId, removedIds }
}

function DraftListView({
  draft, codes, diff, focusedStepId, formTemplates, pendingFormOps,
}: {
  draft: StepDraft[]
  codes: ReturnType<typeof deriveCodes>
  diff: { byId: Record<string, StepDiffEntry>; removedIds: string[] }
  focusedStepId?: string
  formTemplates: FormTemplate[]
  pendingFormOps: PendingFormOps
}) {
  const ordered = dfsOrdered(draft)
  const focusedStep = focusedStepId ? draft.find(s => s.id === focusedStepId) : null

  if (ordered.length === 0 && diff.removedIds.length === 0 && pendingFormOps.add.length === 0) {
    return (
      <p className="text-[11px] italic text-neutral-400 text-center py-6">
        Chưa có bước nào. Hãy gõ prompt để AI tạo khung.
      </p>
    )
  }

  // Round-7i: in detail stage, render the focused step as a large card
  // with inline form preview, then a compact minimap of other steps below.
  if (focusedStep) {
    const otherSteps = ordered.filter(s => s.id !== focusedStep.id)
    return (
      <div className="space-y-2">
        <FocusedStepCard
          step={focusedStep}
          codes={codes}
          formTemplates={formTemplates}
          diff={diff.byId[focusedStep.id]}
        />
        {otherSteps.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1 mt-3">
              Các bước khác trong nháp
            </p>
            <ul className="space-y-1">
              {otherSteps.map(s => (
                <MiniStepRow
                  key={s.id}
                  step={s}
                  codes={codes}
                  formTemplates={formTemplates}
                  diff={diff.byId[s.id]}
                />
              ))}
            </ul>
          </div>
        )}
        {/* Pending form ops still shown */}
        {(pendingFormOps.add.length > 0 || pendingFormOps.modify.length > 0) && (
          <div className="mt-3 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Form ops chờ commit
            </p>
            {pendingFormOps.add.map(f => (
              <div key={`addform-${f.code}`} className="text-xs px-2 py-1 border border-green-300 bg-green-50/70 rounded">
                <Plus size={10} className="inline text-green-700 mr-1" />
                <span className="font-mono text-[9px] text-neutral-500 mr-1">{f.code}</span>
                "{f.name}" — form mới ({f.fields.length} fields)
              </div>
            ))}
            {pendingFormOps.modify.map(m => (
              <div key={`modform-${m.f_code}`} className="text-xs px-2 py-1 border border-amber-300 bg-amber-50/60 rounded">
                <Edit3 size={10} className="inline text-amber-700 mr-1" />
                <span className="font-mono text-[9px] text-neutral-500 mr-1">{m.f_code}</span>
                +{m.add_fields?.length ?? 0}/↻{m.modify_fields?.length ?? 0}/−{m.remove_field_ids?.length ?? 0} fields
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <ul className="space-y-1">
      {/* Removed-since-entry steps shown at top with strikethrough */}
      {diff.removedIds.length > 0 && (
        <li className="text-[10px] text-red-700 mb-1">
          {diff.removedIds.length} bước bị xoá khỏi bản nháp
        </li>
      )}

      {ordered.map(s => {
        const entry = diff.byId[s.id]
        const status = entry?.status ?? 'unchanged'
        const isFocused = focusedStepId === s.id
        const code = codes.stepCode[s.id]
        const formCode = s.form_template_id ? codes.formCode[s.form_template_id] : null
        const formName = s.form_template_id
          ? (formTemplates.find(f => f.id === s.form_template_id)?.name
             ?? (typeof s.form_template_id === 'string' && s.form_template_id.startsWith('__NEW_F_CODE__')
                  ? `(form mới ${s.form_template_id.slice('__NEW_F_CODE__'.length)})`
                  : null))
          : null

        const tone =
          status === 'added'    ? { bg: 'bg-green-50/70',  border: 'border-green-300',  icon: <Plus size={10} className="text-green-700"/> } :
          status === 'modified' ? { bg: 'bg-amber-50/60',  border: 'border-amber-300',  icon: <Edit3 size={10} className="text-amber-700"/> } :
                                   { bg: 'bg-white',         border: 'border-neutral-200', icon: null }

        return (
          <li
            key={s.id}
            className={`text-xs px-2 py-1 border rounded ${tone.bg} ${tone.border} ${
              isFocused ? 'ring-2 ring-primary-300' : ''
            }`}
          >
            <div className="flex items-baseline gap-1.5">
              {tone.icon}
              <span className="font-mono text-[9px] text-neutral-500">{code}</span>
              <span className={`flex-1 truncate ${s.title ? 'text-neutral-800' : 'italic text-neutral-400'}`}>
                {s.title || '(chưa đặt tên)'}
              </span>
              {s.step_type === 'branch' && (
                <span className="text-[9px] px-1 bg-amber-100 text-amber-700 rounded">
                  rẽ nhánh ({s.branch_options.length})
                </span>
              )}
              {s.requires_approval && <span className="text-[9px] text-amber-600">duyệt</span>}
              {s.duration_hours != null && <span className="text-[9px] text-neutral-500">{s.duration_hours}h</span>}
            </div>
            {(s.description || formName) && (
              <div className="text-[10px] text-neutral-500 mt-0.5 ml-3 space-y-0.5">
                {s.description && <p className="truncate">— {s.description}</p>}
                {formName && (
                  <p>
                    <span className="font-mono">{formCode ?? 'F?'}</span> · {formName}
                  </p>
                )}
              </div>
            )}
            {entry?.changedFields?.length && (
              <p className="text-[9px] text-amber-700 mt-0.5 ml-3 italic">
                ↻ Đã đổi: {entry.changedFields.join(', ')}
              </p>
            )}
          </li>
        )
      })}

      {/* Pending form ops summary */}
      {pendingFormOps.add.map(f => (
        <li key={`addform-${f.code}`} className="text-xs px-2 py-1 border border-green-300 bg-green-50/70 rounded">
          <div className="flex items-baseline gap-1.5">
            <Plus size={10} className="text-green-700" />
            <span className="font-mono text-[9px] text-neutral-500">{f.code}</span>
            <span className="text-neutral-800 flex-1">"{f.name}" — form mới ({f.fields.length} fields)</span>
          </div>
        </li>
      ))}
      {pendingFormOps.modify.map(m => (
        <li key={`modform-${m.f_code}`} className="text-xs px-2 py-1 border border-amber-300 bg-amber-50/60 rounded">
          <div className="flex items-baseline gap-1.5">
            <Edit3 size={10} className="text-amber-700" />
            <span className="font-mono text-[9px] text-neutral-500">{m.f_code}</span>
            <span className="text-neutral-800 flex-1">
              sửa: +{m.add_fields?.length ?? 0} / ↻{m.modify_fields?.length ?? 0} / −{m.remove_field_ids?.length ?? 0} fields
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

// (round-7c) `formatPatchSummary` was used while patches were auto-applied;
// the per-turn PatchDetail panel renders the full diff inline now, so the
// short summary helper is no longer needed.

// Re-export to silence unused-warning; useful if other modules want it.
export { Minus }

// ─── Focused step card (detail stage right panel) ───────────────────────────

/**
 * Round-7i: when the modal is in a detail stage, the right panel renders
 * the focused step as a large card with inline form preview, instead of
 * the compact step list. Lets the user see the step's full state +
 * attached form's field structure without leaving the modal.
 */
function FocusedStepCard({
  step, codes, formTemplates, diff,
}: {
  step: StepDraft
  codes: ReturnType<typeof deriveCodes>
  formTemplates: FormTemplate[]
  diff?: StepDiffEntry
}) {
  const [formOpen, setFormOpen] = useState(true)
  const code = codes.stepCode[step.id]
  const formCode = step.form_template_id ? codes.formCode[step.form_template_id] : null
  const formTemplate: FormTemplate | null =
    step.form_template_id && !String(step.form_template_id).startsWith('__NEW_F_CODE__')
      ? formTemplates.find(f => f.id === step.form_template_id) ?? null
      : null
  // Pending NEW_F sentinel — extract the human code (e.g. NEW_F1)
  const pendingFormCode = typeof step.form_template_id === 'string' && step.form_template_id.startsWith('__NEW_F_CODE__')
    ? step.form_template_id.slice('__NEW_F_CODE__'.length)
    : null

  const tone =
    diff?.status === 'added'    ? 'border-green-300 bg-green-50/40' :
    diff?.status === 'modified' ? 'border-amber-300 bg-amber-50/30' :
                                   'border-primary-200 bg-primary-50/20'

  return (
    <div className={`border-2 rounded-lg p-3 ${tone}`}>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[11px] font-mono px-1.5 py-0.5 bg-primary-600 text-white rounded">
          {code}
        </span>
        <span className="text-sm font-semibold text-neutral-800 flex-1">
          {step.title || <span className="italic text-neutral-400">(chưa đặt tên)</span>}
        </span>
        {step.step_type === 'branch' && (
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">
            rẽ nhánh
          </span>
        )}
      </div>

      {/* Meta grid */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] mb-2">
        <div>
          <dt className="text-neutral-500">Mô tả</dt>
          <dd className="text-neutral-800">
            {step.description || <span className="italic text-neutral-400">— (chưa có)</span>}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Thời gian</dt>
          <dd className="text-neutral-800">
            {step.duration_hours != null ? `${step.duration_hours} tiếng` : <span className="italic text-neutral-400">— (chưa có)</span>}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Cần duyệt</dt>
          <dd className="text-neutral-800">
            {step.requires_approval
              ? `Có${step.approver_role ? ` · ${step.approver_role}` : ''}`
              : <span className="italic text-neutral-400">không</span>}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Form</dt>
          <dd className="text-neutral-800">
            {formTemplate
              ? <span className="font-mono">{formCode}</span>
              : pendingFormCode
                ? <span className="text-amber-700">(form mới {pendingFormCode})</span>
                : <span className="italic text-neutral-400">— chưa gắn</span>}
          </dd>
        </div>
      </dl>

      {step.step_type === 'branch' && step.branch_options.length > 0 && (
        <div className="text-[11px] mb-2">
          <span className="text-neutral-500">Nhánh:</span>{' '}
          {step.branch_options.map(o => (
            <span key={o} className="inline-block ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">
              {o}
            </span>
          ))}
        </div>
      )}

      {/* Form preview — collapsible inline panel */}
      {formTemplate && (
        <div className="mt-2 border-t border-neutral-200 pt-2">
          <button
            type="button"
            onClick={() => setFormOpen(v => !v)}
            className="w-full flex items-center gap-1.5 text-[11px] text-neutral-700 hover:bg-white/50 px-1 py-0.5 rounded"
          >
            {formOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <FilePlus2 size={11} className="text-primary-600" />
            <span className="font-semibold">{formCode}</span>
            <span className="text-neutral-600">· {formTemplate.name}</span>
            <span className="ml-auto text-[10px] text-neutral-500">
              {formTemplate.fields.length} fields
            </span>
          </button>
          {formOpen && (
            <ul className="mt-1.5 space-y-0.5 ml-3 text-[10.5px]">
              {formTemplate.fields.map(f => (
                <li key={f.id} className="text-neutral-700">
                  • <span className="font-medium">{f.label}</span>
                  <span className="text-neutral-500 ml-1">({f.type}{f.required ? ' • required' : ''})</span>
                  {f.options && f.options.length > 0 && (
                    <span className="text-neutral-400 ml-1">[{f.options.slice(0, 3).join(' / ')}{f.options.length > 3 ? '…' : ''}]</span>
                  )}
                </li>
              ))}
              {formTemplate.fields.length === 0 && (
                <li className="italic text-neutral-400">(chưa có field)</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Diff hint if modified */}
      {diff?.changedFields?.length && (
        <p className="mt-2 text-[10px] text-amber-700 italic border-t border-amber-200 pt-1">
          ↻ Vừa đổi: {diff.changedFields.join(', ')}
        </p>
      )}
    </div>
  )
}

/**
 * Round-7i: minimap row for non-focused steps in a detail stage.
 */
function MiniStepRow({
  step, codes, formTemplates, diff,
}: {
  step: StepDraft
  codes: ReturnType<typeof deriveCodes>
  formTemplates: FormTemplate[]
  diff?: StepDiffEntry
}) {
  const code = codes.stepCode[step.id]
  const formCode = step.form_template_id ? codes.formCode[step.form_template_id] : null
  const formName = step.form_template_id
    ? (formTemplates.find(f => f.id === step.form_template_id)?.name
       ?? (typeof step.form_template_id === 'string' && step.form_template_id.startsWith('__NEW_F_CODE__')
            ? `(form mới)`
            : null))
    : null

  const tone =
    diff?.status === 'added'    ? 'bg-green-50/40 border-green-200' :
    diff?.status === 'modified' ? 'bg-amber-50/40 border-amber-200' :
                                   'bg-white border-neutral-100'

  return (
    <li className={`text-[11px] px-2 py-1 border rounded ${tone}`}>
      <span className="font-mono text-[9px] text-neutral-500 mr-1">{code}</span>
      <span className={step.title ? 'text-neutral-700' : 'italic text-neutral-400'}>
        {step.title || '(chưa đặt tên)'}
      </span>
      {formName && (
        <span className="ml-1 text-[10px] text-neutral-500">
          · <span className="font-mono">{formCode}</span>
        </span>
      )}
      {step.duration_hours != null && (
        <span className="ml-1 text-[10px] text-neutral-400">· {step.duration_hours}h</span>
      )}
    </li>
  )
}
