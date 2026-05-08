/**
 * Shared local types for the WorkflowEditPage dual-panel refactor.
 * StepDraft mirrors the row shape in `workflow_steps` plus a client-side `id`,
 * `db_id` (for existing rows), and `isNew` marker.
 */
import type { StepType } from '../../types'

/**
 * Operator for field-source conditions. When `source_kind = 'outcome'` the
 * operator is implicitly '=' (the case matches a discrete branch_options
 * label of the source step) and the field is `null`.
 */
export type ConditionOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains'

/**
 * A single condition expression. Used for `show_when` and as the case shape
 * inside a branch's `branch_config`.
 */
export interface ConditionCase {
  id: string                                    // ui-stable id (NOT a db row)
  label: string                                 // edge label / chip
  operator: ConditionOperator
  value: string                                 // compared against source data
}

/**
 * Branch-only config (round-5 commit B). Replaces the legacy
 * branch_options + branch_condition pattern for new templates. Stored as
 * `workflow_steps.branch_config` jsonb (migration #26).
 */
export interface BranchConfig {
  /** Where the data being switched-on comes from. */
  source_kind: 'outcome' | 'field'
  /** Template-level workflow_steps.id of the source step (NOT a draft id).
   *  May be null while the user is still wiring the branch. */
  source_step_id: string | null
  /** When source_kind='field', the form-field id within the source step's
   *  attached form. */
  source_field_id: string | null
  /** Cases that fan out from this branch. Each case becomes one outgoing
   *  edge whose `branch_condition` = case.label. */
  cases: ConditionCase[]
}

/**
 * Step-level conditional show. When set, the step is only displayed during
 * a run if the expression evaluates true; null/undefined ⇒ always show.
 * Stored in `workflow_steps.show_when` jsonb. NOT yet evaluated at runtime
 * (design-time storage only in v1).
 */
export interface ShowWhen {
  source_kind: 'outcome' | 'field'
  source_step_id: string | null
  source_field_id: string | null
  operator: ConditionOperator
  value: string
}

export interface StepDraft {
  id: string
  db_id?: string
  parent_step_id: string | null
  branch_condition: string | null
  title: string
  description: string
  step_type: StepType
  branch_options: string[]
  order_index: number
  helper_panel_id: string | null
  form_template_id: string | null
  requires_approval: boolean
  approver_user_id: string | null
  approver_role: 'admin' | 'editor' | 'specific_user' | null
  duration_hours: number
  condition_step_id: string | null
  condition_value: string | null
  isNew: boolean

  /**
   * Ephemeral canvas coordinates. Tracked while the user drags/places nodes
   * during the editing session. Not persisted to the DB — on next page load
   * the auto-layout repositions everything in DFS order. The graph itself
   * (parent_step_id + branch_condition) is the source of truth.
   */
  position_x?: number
  position_y?: number

  /** Round-5b: branch-only config — replaces branch_options/branch_condition
   *  for newly-edited branches. Persisted via migration #26. */
  branch_config?: BranchConfig | null
  /** Round-5b: per-step conditional show. Replaces condition_step_id +
   *  condition_value for newly-edited steps. Persisted via migration #26.
   *  null/undefined ⇒ always show. */
  show_when?: ShowWhen | null
}

export function blankStep(parentId: string | null, orderIndex: number, branchCondition?: string): StepDraft {
  return {
    id: crypto.randomUUID(),
    parent_step_id: parentId,
    branch_condition: branchCondition ?? null,
    title: '',
    description: '',
    step_type: 'simple',
    branch_options: [],
    order_index: orderIndex,
    helper_panel_id: null,
    form_template_id: null,
    requires_approval: false,
    approver_user_id: null,
    approver_role: null,
    duration_hours: 3,
    condition_step_id: null,
    condition_value: null,
    isNew: true,
  }
}

/** New-style: blank simple step, parentless, default branch_options empty. */
export function blankSimpleStep(orderIndex: number): StepDraft {
  return blankStep(null, orderIndex)
}

/** Blank decision (branch) node — pre-fills two common options. */
export function blankBranchStep(orderIndex: number): StepDraft {
  return {
    ...blankStep(null, orderIndex),
    step_type: 'branch',
    branch_options: ['Đồng ý', 'Từ chối'],
    title: '',
  }
}
