/**
 * WorkflowEditPage — orchestrator for the workflow editor.
 *
 * Layout (Round-4 redesign — 3 columns horizontal):
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ Header: [back] title                              [Save btn]       │
 *   ├──────────────┬────────────────────────┬──────────────────────────┤
 *   │ INFO ~20%    │ SƠ ĐỒ ~35%             │ DETAIL ~45%              │
 *   │ • Meta       │ • React Flow canvas    │ • Step title (edit-on-  │
 *   │ • Quyền chạy │   (vertical chain;     │   hover pencil)          │
 *   │ • Hướng dẫn  │   read-only preview)   │ • Description           │
 *   │              │                        │ • Type toggle           │
 *   │              │                        │ • Approval / Form / etc │
 *   └──────────────┴────────────────────────┴──────────────────────────┘
 *
 * Mobile (<md): single column; detail in foreground; info + flow open via
 * the slide-over button in the header.
 *
 * State (`steps`, `name`, `description`, `guidanceHtml`, `selectedStepId`)
 * + CRUD operations live here. Panels are dumb.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, PanelLeft, GitBranch, Sparkles } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import TemplateEditor from '../components/forms/TemplateEditor'
import WorkflowMetaPanel from '../components/workflow-edit/WorkflowMetaPanel'
import WorkflowAccessSection from '../components/workflow-edit/WorkflowAccessSection'
import WorkflowGuidanceEditor from '../components/workflow-edit/WorkflowGuidanceEditor'
import WorkflowFlowPanel from '../components/workflow-edit/WorkflowFlowPanel'
import StepDetailPanel from '../components/workflow-edit/StepDetailPanel'
import InheritFormModal from '../components/workflow-edit/InheritFormModal'
import WorkflowAIAssistantModal from '../components/workflow-edit/WorkflowAIAssistantModal'
import { AI_WORKFLOW_ASSISTANT_ENABLED } from '../lib/featureFlags'
import { dfsOrdered } from '../components/workflow-edit/stepTree'
import {
  blankStep, blankSimpleStep, blankBranchStep, type StepDraft,
} from '../components/workflow-edit/types'
import { deriveCodes } from '../components/workflow-edit/codes'

/**
 * Auto-layout via dagre — top-down hierarchical placement that respects
 * parent_step_id chains + branch fan-outs. Replaces the old primitive
 * "DFS y-stack with depth-indent" approach (which produced overlapping
 * diamonds + cards on branched workflows — round-8 issue #1).
 *
 * Behaviour:
 *  - Always re-positions every node based on the current topology.
 *  - Does NOT preserve user-drag positions — caller decides whether to
 *    invoke. Default: on hydration, on AI commit, on add/remove/connect.
 *  - Branch nodes fan their children left/right via dagre's natural ranking.
 */
import dagre from '@dagrejs/dagre'

// Layout dimensions slightly inflated past actual node sizes (200×56 for
// simple, 180×120 for branch) so dagre leaves room for edge labels (the
// "Dưới 10 triệu" / "Trên 50 triệu" pills on branch outgoing edges).
const SIMPLE_W = 220
const SIMPLE_H = 70
const BRANCH_W = 260   // wider so 3-way fan-out spreads enough horizontally
const BRANCH_H = 140   // taller so branch labels don't bleed into next rank
const RANK_SEP = 80    // vertical gap between ranks (clears edge labels)
const NODE_SEP = 60    // horizontal gap between siblings on the same rank
const EDGE_SEP = 24    // gap between parallel edges (branch fan-out)

function applyInitialLayout(list: StepDraft[]): StepDraft[] {
  if (list.length === 0) return list

  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'TB',
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    edgesep: EDGE_SEP,
    marginx: 40,
    marginy: 20,
  })
  g.setDefaultEdgeLabel(() => ({}))

  // Branch diamonds get wider/taller buffer so dagre keeps their children apart
  for (const s of list) {
    const isBranch = s.step_type === 'branch'
    g.setNode(s.id, {
      width:  isBranch ? BRANCH_W : SIMPLE_W,
      height: isBranch ? BRANCH_H : SIMPLE_H,
    })
  }

  // Edge minlen: branch → child gets longer rank gap (more vertical room
  // for the colored "Đạt yêu cầu" / "Trên 50 triệu" labels)
  for (const s of list) {
    if (s.parent_step_id && list.some(p => p.id === s.parent_step_id)) {
      const parent = list.find(p => p.id === s.parent_step_id)
      const isBranchEdge = parent?.step_type === 'branch'
      g.setEdge(s.parent_step_id, s.id, {
        minlen: isBranchEdge ? 2 : 1,   // double rank for branch edges
        weight: isBranchEdge ? 1 : 2,   // tighter for linear chains
      })
    }
  }

  dagre.layout(g)

  return list.map(s => {
    const n = g.node(s.id)
    if (!n) return s
    // dagre returns center coords; React Flow uses top-left
    return {
      ...s,
      position_x: Math.round(n.x - n.width / 2),
      position_y: Math.round(n.y - n.height / 2),
    }
  })
}
import { useToast } from '../components/ui/Toast'
import { supabase } from '../lib/supabase'
import type {
  WorkflowTemplate, WorkflowStep,
  HelperPanel, FormTemplate, Profile, UserGroup, FormField,
} from '../types'

export default function WorkflowEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { success, error: toastError } = useToast()
  const qc = useQueryClient()
  const isNew = id === 'new'

  // ── State ──
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [guidanceHtml, setGuidanceHtml] = useState('')
  const [steps, setSteps] = useState<StepDraft[]>([blankStep(null, 0)])
  const [selectedStepId, setSelectedStepId] = useState<string | null>(steps[0]?.id ?? null)
  const [saving, setSaving] = useState(false)
  const [leftPanelOpen, setLeftPanelOpen] = useState(false)   // mobile slide-over for meta/guidance
  const [flowPanelOpen, setFlowPanelOpen] = useState(false)   // mobile slide-over for sơ đồ
  /** Step ids currently outlined on the canvas (driven by hovers in the
   *  form responsibility map). Empty array = no outline. */
  const [highlightedStepIds, setHighlightedStepIds] = useState<string[]>([])
  const [aiOpen, setAiOpen] = useState(false)
  /** When set, modal opens directly in details stage focused on this S{N}. */
  const [aiInitialFocus, setAiInitialFocus] = useState<string | null>(null)
  /** "inherit" stage — choosing blank vs inherit before opening TemplateEditor. */
  const [inheritModalForStepId, setInheritModalForStepId] = useState<string | null>(null)
  /** Step id we're creating a form for + the pre-cloned fields when inheriting. */
  const [creatingFormForStepId, setCreatingFormForStepId] = useState<string | null>(null)
  const [inheritedSeed, setInheritedSeed] = useState<{ fields: FormField[]; sourceName: string } | null>(null)
  /** Mobile: which panel is visible. Desktop ignores this and shows both. */

  // ── Queries ──
  const { data: helpers = [] } = useQuery({
    queryKey: ['helper-panels'],
    queryFn: async () => {
      const { data, error } = await supabase.from('helper_panels').select('*').order('name')
      if (error) throw error
      return data as HelperPanel[]
    },
  })

  const { data: formTemplates = [] } = useQuery({
    queryKey: ['form-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('form_templates')
        .select('id, name, description, fields, summary_field_ids, is_active, created_by, created_at, updated_at')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data as FormTemplate[]
    },
  })

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, role').order('full_name')
      if (error) throw error
      return data as Profile[]
    },
  })

  const { data: userGroups = [] } = useQuery({
    queryKey: ['user-groups'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_groups').select('id, name, color, description, created_by, created_at, updated_at').order('name')
      if (error) {
        console.warn('[WorkflowEditPage] user_groups query failed:', error.message)
        return []
      }
      return data as UserGroup[]
    },
    retry: false,
  })

  const { data: templateAccessGroups = [], refetch: refetchAccess } = useQuery({
    queryKey: ['workflow-template-access', id],
    queryFn: async () => {
      if (!id || isNew) return []
      const { data, error } = await supabase
        .from('workflow_template_access')
        .select('group_id')
        .eq('template_id', id)
      if (error) {
        console.warn('[WorkflowEditPage] template_access query failed:', error.message)
        return []
      }
      return (data ?? []).map((r: { group_id: string }) => r.group_id)
    },
    enabled: !isNew && !!id,
    retry: false,
  })

  const { data: template } = useQuery({
    queryKey: ['workflow-template', id],
    queryFn: async () => {
      const [tmplRes, stepsRes] = await Promise.all([
        supabase.from('workflow_templates').select('*').eq('id', id!).single(),
        supabase.from('workflow_steps').select('*').eq('template_id', id!).order('order_index'),
      ])
      return { template: tmplRes.data as WorkflowTemplate, steps: stepsRes.data as WorkflowStep[] }
    },
    enabled: !isNew && !!id,
  })

  // ── Hydrate from DB ──
  useEffect(() => {
    if (!template) return
    setName(template.template.name)
    setDescription(template.template.description ?? '')
    setGuidanceHtml((template.template as WorkflowTemplate).guidance_html ?? '')

    // Build a stable mapping from db_id → client id so children can resolve their parent.
    const clientIds: Record<string, string> = {}
    for (const s of template.steps) clientIds[s.id] = crypto.randomUUID()

    const hydrated: StepDraft[] = template.steps.map(s => ({
      id: clientIds[s.id],
      db_id: s.id,
      parent_step_id: s.parent_step_id ? clientIds[s.parent_step_id] ?? null : null,
      branch_condition: s.branch_condition,
      title: s.title,
      description: s.description ?? '',
      step_type: s.step_type,
      branch_options: s.branch_options ?? [],
      order_index: s.order_index,
      helper_panel_id: s.helper_panel_id ?? null,
      form_template_id: s.form_template_id ?? null,
      requires_approval: s.requires_approval ?? false,
      approver_user_id: s.approver_user_id ?? null,
      approver_role: s.approver_role ?? null,
      duration_hours: (s as { duration_hours?: number }).duration_hours ?? 3,
      condition_step_id: null,
      condition_value: null,
      // Round-5b: new fields (migration #26). Null when migration not run yet.
      branch_config: (s as { branch_config?: unknown }).branch_config as StepDraft['branch_config'] ?? null,
      show_when: (() => {
        const sw = (s as { show_when?: unknown }).show_when as StepDraft['show_when'] ?? null
        if (!sw?.source_step_id) return sw
        // Translate stored DB step-id → current session's draft id so
        // ConditionExpression can match it via s.id comparison.
        return { ...sw, source_step_id: clientIds[sw.source_step_id] ?? sw.source_step_id }
      })(),
      isNew: false,
    }))

    setSteps(applyInitialLayout(hydrated))
    setSelectedStepId(hydrated[0]?.id ?? null)
  }, [template])

  // ── Step CRUD ──
  const updateStep = useCallback((stepId: string, patch: Partial<StepDraft>) => {
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, ...patch } : s))
  }, [])

  const removeStep = useCallback((stepId: string) => {
    setSteps(prev => {
      const toRemove = new Set<string>()
      function collect(sid: string) {
        toRemove.add(sid)
        prev.filter(s => s.parent_step_id === sid).forEach(s => collect(s.id))
      }
      collect(stepId)
      return applyInitialLayout(prev.filter(s => !toRemove.has(s.id)))
    })
    setSelectedStepId(curr => (curr === stepId ? null : curr))
  }, [])

  /** Spawn a new simple node — dagre auto-arrange placement. */
  const addSimpleNode = useCallback(() => {
    setSteps(prev => {
      const next = blankSimpleStep(prev.length)
      // position_x/y will be set by applyInitialLayout below
      next.position_x = 0
      next.position_y = 0
      setSelectedStepId(next.id)
      return applyInitialLayout([...prev, next])
    })
  }, [])

  /** Spawn a new branch (decision) node — dagre auto-arrange placement. */
  const addBranchNode = useCallback(() => {
    setSteps(prev => {
      const next = blankBranchStep(prev.length)
      next.position_x = 0
      next.position_y = 0
      setSelectedStepId(next.id)
      return applyInitialLayout([...prev, next])
    })
  }, [])

  /**
   * Add a child below a parent — used by the branch popover ("+ Đồng ý" /
   * "+ Từ chối"). Dagre handles all positioning automatically.
   */
  const addChildStep = useCallback((parentId: string, branchCondition?: string) => {
    setSteps(prev => {
      const siblings = prev.filter(s => s.parent_step_id === parentId)
      const next = blankStep(parentId, siblings.length, branchCondition)
      next.position_x = 0
      next.position_y = 0
      setSelectedStepId(next.id)
      return applyInitialLayout([...prev, next])
    })
  }, [])

  /**
   * Connect node A → node B. Sets B.parent_step_id = A.
   * If A is a branch, sourceHandle (= the option name) becomes B.branch_condition.
   *
   * Round-5 rule: simple steps may have at most ONE outgoing edge — branches are
   * the only fan-out node. If a simple step already has an outgoing edge, the
   * connect attempt is rejected with a toast.
   */
  const connectSteps = useCallback((sourceId: string, targetId: string, sourceHandle?: string | null) => {
    if (sourceId === targetId) return
    setSteps(prev => {
      const sourceStep = prev.find(p => p.id === sourceId)
      if (!sourceStep) return prev

      // 1-outgoing rule for simple steps.
      if (sourceStep.step_type === 'simple') {
        const existingOutgoing = prev.find(s => s.parent_step_id === sourceId)
        if (existingOutgoing && existingOutgoing.id !== targetId) {
          toastError('Bước đơn giản chỉ được nối tới 1 đích — xoá kết nối hiện tại trước.')
          return prev
        }
      }

      // Prevent cycles: walk ancestors of source; if target appears, abort.
      let cur: string | null = sourceId
      while (cur) {
        if (cur === targetId) return prev
        const s = prev.find(p => p.id === cur)
        cur = s?.parent_step_id ?? null
      }
      const updated = prev.map(s => {
        if (s.id !== targetId) return s
        const branchCondition = sourceStep.step_type === 'branch'
          ? (sourceHandle ?? sourceStep.branch_options[0] ?? null)
          : null
        return { ...s, parent_step_id: sourceId, branch_condition: branchCondition }
      })
      return applyInitialLayout(updated)
    })
  }, [toastError])

  /** Disconnect: set parent_step_id = null for the target + re-layout. */
  const disconnectStep = useCallback((targetId: string) => {
    setSteps(prev => applyInitialLayout(prev.map(s =>
      s.id === targetId ? { ...s, parent_step_id: null, branch_condition: null } : s,
    )))
  }, [])

  /** User drags a node — keep its position in component state. */
  const moveStep = useCallback((stepId: string, x: number, y: number) => {
    setSteps(prev => prev.map(s =>
      s.id === stepId ? { ...s, position_x: x, position_y: y } : s,
    ))
  }, [])

  /**
   * Round-7: the page used to own `applyAIPatch` that mutated steps[] from
   * a one-shot AI modal. That logic now lives inside the AI modal as a
   * sandbox draft + form-op queue, then gets committed via the
   * `commitDraftToEditor` helper (see `applyAIPatchToDraft.ts`). The page
   * just receives the final committed steps via the modal's
   * `onCommitDraft` prop — see the modal mount below.
   */

  const handleSelectStep = useCallback((stepId: string) => {
    setSelectedStepId(stepId)
  }, [])

  const handleOpenCreateForm = useCallback((stepId: string) => {
    // Step 1: open the inherit-vs-blank chooser. Caller's onPick* drives next step.
    setInheritModalForStepId(stepId)
  }, [])

  /**
   * Round-7g (hardened in -h): shared persistence — runs the
   * workflow_templates upsert + workflow_steps wipe-and-replace using
   * the GIVEN steps array (avoids stale closure trap).
   *
   * Two safety rails added in round-7h:
   *  • Explicit .error checks on EVERY supabase call (the client doesn't
   *    throw — it returns { data, error }; missing checks let DELETE fail
   *    silently when FK refs blocked the cascade).
   *  • Null-out workflow_step_results.step_id + workflow_run_steps.source_step_id
   *    BEFORE deleting workflow_steps. This is a graceful fallback for
   *    instances where migration #29 hasn't been applied yet — the FK
   *    isn't ON DELETE SET NULL there, so we manually do it.
   */
  async function persistWorkflow(stepsToSave: StepDraft[]): Promise<string> {
    if (!name.trim()) {
      toastError('Nhập tên template')
      throw new Error('name required')
    }
    let templateId = isNew ? null : id!

    if (isNew) {
      const { data, error } = await supabase
        .from('workflow_templates')
        .insert({
          name,
          description: description || null,
          guidance_html: guidanceHtml || null,
        })
        .select()
        .single()
      if (error) throw new Error(`Tạo template lỗi: ${error.message}`)
      templateId = data.id
    } else {
      const { error: updErr } = await supabase.from('workflow_templates').update({
        name,
        description: description || null,
        guidance_html: guidanceHtml || null,
        updated_at: new Date().toISOString(),
      }).eq('id', templateId!)
      if (updErr) throw new Error(`Cập nhật template lỗi: ${updErr.message}`)

      // Round-7h: defensively null-out run-result step refs BEFORE the
      // DELETE so the FK doesn't block. Without migration #29 the FK is
      // NO ACTION and the DELETE silently fails on workflows that have
      // been run. With migration #29 applied this becomes a no-op (FK
      // is ON DELETE SET NULL and would auto-handle anyway).
      const { data: oldSteps, error: oldErr } = await supabase
        .from('workflow_steps')
        .select('id')
        .eq('template_id', templateId!)
      if (oldErr) throw new Error(`Đọc steps cũ lỗi: ${oldErr.message}`)
      const oldStepIds = (oldSteps ?? []).map(s => s.id as string)
      if (oldStepIds.length > 0) {
        // Null out workflow_step_results.step_id (run history references)
        const { error: srErr } = await supabase
          .from('workflow_step_results')
          .update({ step_id: null })
          .in('step_id', oldStepIds)
        if (srErr) {
          console.warn('[persistWorkflow] null-out step_results.step_id failed (RLS or migration #29 missing?):', srErr.message)
          // Don't throw — if migration #29 applied this is unnecessary.
        }
        // Same for workflow_run_steps.source_step_id (snapshot references)
        const { error: rsErr } = await supabase
          .from('workflow_run_steps')
          .update({ source_step_id: null })
          .in('source_step_id', oldStepIds)
        if (rsErr) {
          console.warn('[persistWorkflow] null-out run_steps.source_step_id failed:', rsErr.message)
        }
      }

      const { error: delErr } = await supabase
        .from('workflow_steps')
        .delete()
        .eq('template_id', templateId!)
      if (delErr) {
        // This is the smoking gun for the "can't save" bug. Surface clearly.
        throw new Error(
          `Xoá steps cũ lỗi: ${delErr.message}. ` +
          `Hãy chạy migration #29 (migration_phase_workflow_steps_fk_fix.sql).`,
        )
      }
    }

    const roots    = stepsToSave.filter(s => !s.parent_step_id)
    const children = stepsToSave.filter(s => s.parent_step_id)
    const idMap: Record<string, string> = {}

    for (const s of roots) {
      const { data, error } = await supabase.from('workflow_steps').insert({
        template_id:      templateId,
        parent_step_id:   null,
        branch_condition: s.branch_condition,
        title:            s.title || '(chưa đặt tên)',
        description:      s.description || null,
        step_type:        s.step_type,
        branch_options:   s.branch_options.length ? s.branch_options : null,
        order_index:      s.order_index,
        helper_panel_id:  s.helper_panel_id,
        form_template_id: s.form_template_id,
        requires_approval: s.requires_approval,
        approver_user_id: s.approver_user_id,
        approver_role:    s.approver_role,
        duration_hours:   s.duration_hours ?? 3,
        ...(s.branch_config != null ? { branch_config: s.branch_config } : {}),
        ...(s.show_when     != null ? { show_when:     s.show_when     } : {}),
      }).select().single()
      if (error) throw error
      idMap[s.id] = data.id
    }

    for (const s of children) {
      const dbParentId = idMap[s.parent_step_id!] ?? s.parent_step_id
      const { data, error } = await supabase.from('workflow_steps').insert({
        template_id:      templateId,
        parent_step_id:   dbParentId,
        branch_condition: s.branch_condition,
        title:            s.title || '(chưa đặt tên)',
        description:      s.description || null,
        step_type:        s.step_type,
        branch_options:   s.branch_options.length ? s.branch_options : null,
        order_index:      s.order_index,
        helper_panel_id:  s.helper_panel_id,
        form_template_id: s.form_template_id,
        requires_approval: s.requires_approval,
        approver_user_id: s.approver_user_id,
        approver_role:    s.approver_role,
        duration_hours:   s.duration_hours ?? 3,
        ...(s.branch_config != null ? { branch_config: s.branch_config } : {}),
        ...(s.show_when     != null ? { show_when:     s.show_when     } : {}),
      }).select().single()
      if (error) throw error
      idMap[s.id] = data.id
    }

    // Post-insert: update show_when.source_step_id from draft UUID → real DB id.
    // This must run AFTER all steps are inserted so idMap is fully populated.
    for (const s of stepsToSave) {
      const sw = s.show_when
      if (!sw?.source_step_id) continue
      const translatedSourceId = idMap[sw.source_step_id]
      if (!translatedSourceId) continue   // source_step_id was already a DB id (shouldn't happen)
      const newDbId = idMap[s.id]
      if (!newDbId) continue
      const { error: swErr } = await supabase
        .from('workflow_steps')
        .update({ show_when: { ...sw, source_step_id: translatedSourceId } })
        .eq('id', newDbId)
      if (swErr) console.warn('[persistWorkflow] show_when id fix failed:', swErr.message)
    }

    qc.invalidateQueries({ queryKey: ['workflow-templates'] })
    qc.invalidateQueries({ queryKey: ['workflow-template', id] })
    return templateId!
  }

  // ── Save ── (page-level save button in header)
  async function save() {
    setSaving(true)
    try {
      await persistWorkflow(steps)
      success('Đã lưu workflow template')
      navigate('/workflows')
    } catch (err) {
      if ((err as Error).message !== 'name required') {
        console.error(err)
        toastError('Không thể lưu template')
      }
    } finally {
      setSaving(false)
    }
  }

  /**
   * Called by the AI modal after each stage save. Persists the entire
   * workflow (steps + meta) using the given `next` array — bypasses the
   * stale-closure trap from setState. Doesn't navigate.
   */
  async function persistFromAI(next: StepDraft[]) {
    try {
      const layouted = applyInitialLayout(next)
      setSteps(layouted)
      // Only persist if the workflow already has a real id; for /workflows/new
      // we want the user to set name first via the page header.
      if (!isNew) {
        await persistWorkflow(layouted)
        success(`Đã lưu vào DB (${layouted.length} bước).`)
      } else {
        success(`Đã cập nhật bản nháp (${layouted.length} bước). Bấm "Lưu nghiệp vụ" để ghi lần đầu.`)
      }
    } catch (err) {
      console.error('[persistFromAI] failed:', err)
      toastError('Không thể lưu workflow vào DB: ' + (err as Error).message)
      throw err
    }
  }

  async function toggleGroupAccess(groupId: string, currentlyOn: boolean) {
    if (!id || isNew) return
    if (currentlyOn) {
      await supabase.from('workflow_template_access')
        .delete()
        .eq('template_id', id)
        .eq('group_id', groupId)
    } else {
      await supabase.from('workflow_template_access')
        .insert({ template_id: id, group_id: groupId })
    }
    refetchAccess()
  }

  // ── Render derived ──
  const selectedStep = useMemo(
    () => steps.find(s => s.id === selectedStepId) ?? null,
    [steps, selectedStepId],
  )
  const codes = useMemo(() => deriveCodes(steps), [steps])
  const selectedStepCode = selectedStep ? codes.stepCode[selectedStep.id] : undefined
  const orderedSteps = useMemo(() => dfsOrdered(steps), [steps])
  const priorSteps = useMemo(() => {
    if (!selectedStepId) return []
    const idx = orderedSteps.findIndex(s => s.id === selectedStepId)
    return idx === -1 ? [] : orderedSteps.slice(0, idx).filter(s => s.title.trim().length > 0)
  }, [orderedSteps, selectedStepId])

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-neutral-100 bg-white">
        <button onClick={() => navigate('/workflows')} className="text-neutral-400 hover:text-neutral-700">
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-base font-serif font-medium text-neutral-800 flex-1 truncate">
          {isNew ? 'Nghiệp vụ mới' : (name || 'Chỉnh sửa Nghiệp vụ')}
        </h1>
        {/* Mobile: open Info / Sơ đồ as slide-overs */}
        <button
          type="button"
          className="md:hidden text-neutral-500 hover:text-neutral-800 p-1.5 rounded hover:bg-neutral-50"
          onClick={() => setLeftPanelOpen(true)}
          title="Thông tin nghiệp vụ"
          aria-label="Thông tin nghiệp vụ"
        >
          <PanelLeft size={16} />
        </button>
        <button
          type="button"
          className="md:hidden text-neutral-500 hover:text-neutral-800 p-1.5 rounded hover:bg-neutral-50"
          onClick={() => setFlowPanelOpen(true)}
          title="Sơ đồ nghiệp vụ"
          aria-label="Sơ đồ nghiệp vụ"
        >
          <GitBranch size={16} />
        </button>
        {AI_WORKFLOW_ASSISTANT_ENABLED && (
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-primary-300 text-primary-700 rounded hover:bg-primary-50 transition-colors"
            title="Trợ lý AI — xây nghiệp vụ bằng prompt"
          >
            <Sparkles size={13} /> Trợ lý AI
          </button>
        )}
        <Button onClick={save} disabled={saving}>
          {saving ? 'Đang lưu…' : 'Lưu nghiệp vụ'}
        </Button>
      </div>

      {/* Body — Round-4b redesign: 3 horizontal columns INFO | SƠ ĐỒ | DETAIL
          (20% / 35% / 45%). Mobile = detail full-width; info + flow open via slide-overs. */}
      <div className="md:grid md:grid-cols-[20fr_35fr_45fr] h-[calc(100vh-var(--shell-header,48px)-49px)] min-h-[500px] overflow-hidden">

        {/* ── Column 1: INFO — desktop ── */}
        <div className="hidden md:flex flex-col border-r border-neutral-100 bg-white min-h-0 min-w-0">
          <WorkflowMetaPanel
            name={name}
            description={description}
            onNameChange={setName}
            onDescriptionChange={setDescription}
          />
          <WorkflowAccessSection
            isNew={isNew}
            userGroups={userGroups}
            templateAccessGroups={templateAccessGroups}
            onToggleGroupAccess={toggleGroupAccess}
          />
          <div className="flex-1 min-h-0">
            <WorkflowGuidanceEditor
              value={guidanceHtml}
              onChange={setGuidanceHtml}
              className="h-full"
            />
          </div>
        </div>

        {/* ── INFO mobile slide-over ── */}
        {leftPanelOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 bg-black/40 z-40"
              onClick={() => setLeftPanelOpen(false)}
            />
            <div className="md:hidden fixed left-0 top-0 bottom-0 z-50 w-[88%] max-w-[368px] bg-white border-r border-neutral-100 flex flex-col shadow-lg">
              <div className="flex items-center px-3 py-2 border-b border-neutral-100">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
                  Thông tin nghiệp vụ
                </span>
                <button
                  type="button"
                  className="ml-auto text-neutral-400 hover:text-neutral-700 p-1"
                  onClick={() => setLeftPanelOpen(false)}
                  aria-label="Đóng"
                >
                  ✕
                </button>
              </div>
              <WorkflowMetaPanel
                name={name}
                description={description}
                onNameChange={setName}
                onDescriptionChange={setDescription}
              />
              <WorkflowAccessSection
                isNew={isNew}
                userGroups={userGroups}
                templateAccessGroups={templateAccessGroups}
                onToggleGroupAccess={toggleGroupAccess}
              />
              <div className="flex-1 min-h-0">
                <WorkflowGuidanceEditor
                  value={guidanceHtml}
                  onChange={setGuidanceHtml}
                  className="h-full"
                />
              </div>
            </div>
          </>
        )}

        {/* ── Column 2: SƠ ĐỒ (middle, focal — chain reads top-to-bottom) ── */}
        <div className="hidden md:flex min-w-0 min-h-0 flex-col bg-white md:border-r md:border-neutral-100">
          <WorkflowFlowPanel
            steps={steps}
            selectedStepId={selectedStepId}
            onSelect={handleSelectStep}
            onAddSimple={addSimpleNode}
            onAddBranch={addBranchNode}
            onAddChild={addChildStep}
            onConnect={connectSteps}
            onDisconnect={disconnectStep}
            onMoveNode={moveStep}
            onRemove={removeStep}
            formTemplates={formTemplates}
            highlightedStepIds={highlightedStepIds}
          />
        </div>

        {/* ── Column 3: DETAIL ── */}
        <div className="min-w-0 min-h-0 flex flex-col bg-neutral-25">
          {selectedStep ? (
            <StepDetailPanel
              step={selectedStep}
              priorSteps={priorSteps}
              allSteps={steps}
              helpers={helpers}
              formTemplates={formTemplates}
              profiles={profiles}
              stepCode={selectedStepCode}
              onUpdate={updateStep}
              onRemove={removeStep}
              onCreateForm={handleOpenCreateForm}
              onHoverSteps={setHighlightedStepIds}
              onOpenAIForStep={AI_WORKFLOW_ASSISTANT_ENABLED ? (sCode) => { setAiInitialFocus(sCode); setAiOpen(true) } : undefined}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center text-neutral-400 p-8">
              <p className="text-sm">Chọn một bước trên sơ đồ để chỉnh sửa.</p>
              <p className="text-[11px] mt-2 text-neutral-300">Hoặc bấm "+ Thêm gốc" trên panel sơ đồ để tạo bước mới.</p>
            </div>
          )}
        </div>

        {/* ── SƠ ĐỒ mobile slide-over ── */}
        {flowPanelOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 bg-black/40 z-40"
              onClick={() => setFlowPanelOpen(false)}
            />
            <div className="md:hidden fixed right-0 top-0 bottom-0 z-50 w-[92%] max-w-[420px] bg-white border-l border-neutral-100 flex flex-col shadow-lg">
              <div className="flex items-center px-3 py-2 border-b border-neutral-100">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
                  Sơ đồ
                </span>
                <button
                  type="button"
                  className="ml-auto text-neutral-400 hover:text-neutral-700 p-1"
                  onClick={() => setFlowPanelOpen(false)}
                  aria-label="Đóng"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <WorkflowFlowPanel
                  steps={steps}
                  selectedStepId={selectedStepId}
                  onSelect={(id) => { handleSelectStep(id); setFlowPanelOpen(false) }}
                  onAddSimple={addSimpleNode}
                  onAddBranch={addBranchNode}
                  onAddChild={addChildStep}
                  onConnect={connectSteps}
                  onDisconnect={disconnectStep}
                  onMoveNode={moveStep}
                  onRemove={removeStep}
                  formTemplates={formTemplates}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* AI assistant modal — round-7 conversational builder.
          ARCHIVED (round-9): gated by AI_WORKFLOW_ASSISTANT_ENABLED feature flag.
          Modal + edge function + apply helpers all kept; just unreachable from UI. */}
      {AI_WORKFLOW_ASSISTANT_ENABLED && (
        <WorkflowAIAssistantModal
          open={aiOpen}
          onClose={() => { setAiOpen(false); setAiInitialFocus(null) }}
          steps={steps}
          templateId={isNew ? null : (id ?? null)}
          templateName={name}
          templateDescription={description}
          templateGuidance={guidanceHtml}
          formTemplates={formTemplates}
          initialFocusSCode={aiInitialFocus}
          onCommitDraft={persistFromAI}
        />
      )}

      {/* Stage 1 — choose blank vs inherit */}
      <InheritFormModal
        open={inheritModalForStepId !== null}
        onClose={() => setInheritModalForStepId(null)}
        steps={steps}
        currentStepId={inheritModalForStepId ?? ''}
        formTemplates={formTemplates}
        onPickBlank={() => {
          setCreatingFormForStepId(inheritModalForStepId)
          setInheritedSeed(null)
          setInheritModalForStepId(null)
        }}
        onPickInherit={(clonedFields, sourceName) => {
          setCreatingFormForStepId(inheritModalForStepId)
          setInheritedSeed({ fields: clonedFields, sourceName })
          setInheritModalForStepId(null)
        }}
      />

      {/* Stage 2 — TemplateEditor (blank or inheritance-pre-populated) */}
      <Modal
        open={creatingFormForStepId !== null}
        onClose={() => { setCreatingFormForStepId(null); setInheritedSeed(null) }}
        title={inheritedSeed ? `Tạo form (kế thừa từ "${inheritedSeed.sourceName}")` : 'Tạo form mới'}
        size="xl"
      >
        {creatingFormForStepId !== null && (
          <TemplateEditor
            // When inheriting we synthesise a faux template (id is empty so save→insert)
            template={inheritedSeed ? {
              id: '', name: '', description: null,
              fields: inheritedSeed.fields, summary_field_ids: [],
              is_active: true, created_by: null,
              created_at: '', updated_at: '',
            } : undefined}
            workflowSteps={steps.map(s => ({
              id: s.id, title: s.title, order_index: s.order_index, requires_approval: s.requires_approval,
            }))}
            currentWorkflowStepId={creatingFormForStepId}
            workflowUsers={profiles}
            onSave={async (payload) => {
              const { data, error } = await supabase
                .from('form_templates')
                .insert(payload)
                .select()
                .single()
              if (error) throw error
              qc.invalidateQueries({ queryKey: ['form-templates'] })
              qc.invalidateQueries({ queryKey: ['form-templates-all'] })
              updateStep(creatingFormForStepId, { form_template_id: data.id })
              setCreatingFormForStepId(null)
              setInheritedSeed(null)
            }}
            onCancel={() => { setCreatingFormForStepId(null); setInheritedSeed(null) }}
          />
        )}
      </Modal>
    </AppShell>
  )
}
