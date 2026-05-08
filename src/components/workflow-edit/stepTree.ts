/**
 * Pure helpers for the workflow editor tree.
 *
 * `dfsOrdered` — depth-first traversal of steps using parent_step_id (preserves
 * sibling order via order_index). Used for "earlier-step" pickers and for the
 * orchestrator's prior-steps "show when" logic.
 *
 * (Note: the previous `buildTree()` helper that produced rail/elbow metadata
 * for the text-tree was removed when WorkflowTreePanel was replaced by the
 * React Flow canvas in WorkflowFlowPanel.tsx — Phase B refactor.)
 */
import type { StepDraft } from './types'

export function dfsOrdered(steps: StepDraft[]): StepDraft[] {
  const result: StepDraft[] = []
  function visit(parentId: string | null) {
    const children = steps
      .filter(s => s.parent_step_id === parentId)
      .sort((a, b) => a.order_index - b.order_index)
    for (const c of children) {
      result.push(c)
      visit(c.id)
    }
  }
  visit(null)
  return result
}
