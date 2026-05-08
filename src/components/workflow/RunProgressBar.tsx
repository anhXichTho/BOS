/**
 * RunProgressBar — segmented status-coloured bar for a workflow run.
 *
 * Visually similar to `StepDurationBar` (sized by each step's duration_hours),
 * but each segment is coloured by its run status:
 *
 *   - approval_status='approved' OR (done && !requires_approval) → green
 *   - approval_status='pending' OR (current step in progress)     → orange
 *   - approval_status='rejected' OR run paused                    → red
 *   - future (not started yet)                                    → neutral
 *
 * Only root steps (parent_step_id == null) are considered — branch children
 * collapse into their parent for the high-level progress view.
 */
import { memo } from 'react'

interface RunStep {
  id: string
  parent_step_id: string | null
  order_index: number
  duration_hours: number | null
  step_type?: 'simple' | 'branch' | string | null
  requires_approval?: boolean | null
}

interface StepResult {
  snapshot_id?: string | null
  step_id?: string | null
  is_done: boolean
  approval_status: 'pending' | 'approved' | 'rejected' | null
}

interface Props {
  steps: RunStep[]
  results: StepResult[]
  /** Run-level status — when 'cancelled' or 'failed', incomplete segments turn red. */
  runStatus?: 'in_progress' | 'completed' | 'cancelled' | 'failed' | string
  className?: string
}

type SegStatus = 'done' | 'pending' | 'rejected' | 'future'

const COLORS: Record<SegStatus, string> = {
  done:     'var(--color-success, #5A8C5A)',
  pending:  'var(--color-warning, #C8954A)',
  rejected: 'var(--color-danger, #C9534B)',
  future:   '#E4E4E3',                       // neutral-150
}

export default memo(function RunProgressBar({
  steps, results, runStatus, className = '',
}: Props) {
  // A step counts as a "high-level root" for the progress bar when it's the
  // head of the linear chain OR a child of a non-branch (simple) parent.
  // Branch children are excluded so the bar shows the skeleton path, not fan-out.
  const byId = new Map<string, RunStep>(steps.map(s => [s.id, s]))
  const roots = steps
    .filter(s => {
      if (!s.parent_step_id) return true
      const parent = byId.get(s.parent_step_id)
      return parent?.step_type !== 'branch'
    })
    .sort((a, b) => a.order_index - b.order_index)

  if (roots.length === 0) return null

  const total = roots.reduce((s, r) => s + (r.duration_hours ?? 3), 0)
  if (total === 0) return null

  // Build a snapshot_id → result lookup (snapshot_id when available, fallback step_id)
  const resultBy = new Map<string, StepResult>()
  for (const r of results) {
    const key = (r.snapshot_id ?? r.step_id) ?? ''
    if (key) resultBy.set(key, r)
  }

  // Determine which root step is the "current" one — first non-done root.
  let currentIdx = -1
  for (let i = 0; i < roots.length; i++) {
    const r = resultBy.get(roots[i].id)
    const effectivelyDone =
      r?.is_done && (!roots[i].requires_approval || r.approval_status === 'approved')
    if (!effectivelyDone) { currentIdx = i; break }
  }

  function statusOf(idx: number, step: RunStep): SegStatus {
    const r = resultBy.get(step.id)
    if (r?.approval_status === 'rejected') return 'rejected'
    if (r?.is_done && (r.approval_status === 'approved' || !step.requires_approval)) return 'done'
    if (r?.approval_status === 'pending') return 'pending'
    if (idx === currentIdx) return 'pending'
    if (runStatus === 'cancelled' || runStatus === 'failed') {
      return idx < currentIdx ? 'done' : 'rejected'
    }
    return 'future'
  }

  const counts = { done: 0, pending: 0, rejected: 0, future: 0 }
  for (let i = 0; i < roots.length; i++) counts[statusOf(i, roots[i])]++

  return (
    <div className={className}>
      <p className="text-[10px] text-neutral-500 mb-1 flex items-center gap-1.5 flex-wrap">
        <span>Tiến độ:</span>
        {counts.done > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: COLORS.done }} />
            {counts.done} done
          </span>
        )}
        {counts.pending > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: COLORS.pending }} />
            {counts.pending} đang xử lý
          </span>
        )}
        {counts.rejected > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: COLORS.rejected }} />
            {counts.rejected} từ chối
          </span>
        )}
        {counts.future > 0 && (
          <span className="text-neutral-400">+{counts.future} chưa tới</span>
        )}
      </p>
      <div className="flex h-2 w-full rounded-full overflow-hidden bg-neutral-100 gap-px" title="Tiến độ thực hiện workflow">
        {roots.map((step, idx) => {
          const status = statusOf(idx, step)
          const widthPct = ((step.duration_hours ?? 3) / total) * 100
          // First-only / last-only round corners at the ends so the bar stays pill-shaped
          const isFirst = idx === 0
          const isLast  = idx === roots.length - 1
          return (
            <div
              key={step.id}
              style={{ width: `${widthPct}%`, background: COLORS[status] }}
              className={`transition-colors ${isFirst ? 'rounded-l-full' : ''} ${isLast ? 'rounded-r-full' : ''}`}
              title={`Bước ${idx + 1}: ${step.duration_hours ?? 3}h — ${
                status === 'done'     ? 'đã xong' :
                status === 'pending'  ? 'đang xử lý' :
                status === 'rejected' ? 'từ chối' :
                'chưa tới'
              }`}
            />
          )
        })}
      </div>
    </div>
  )
})
