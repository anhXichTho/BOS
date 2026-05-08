/**
 * BranchNode — diamond-shaped React Flow node for branch (decision) steps.
 *
 * Round-5 Phase B. Visual convention: diamond per BPMN/flowchart standard.
 * Implementation note: we use an outer rotated 45° div for the diamond
 * border + fill (cheaper than SVG, plays nicely with Tailwind hover/select
 * states) and an inner unrotated absolutely-positioned wrapper for the
 * actual content + handles.
 *
 * Handles:
 *  • Single target handle at the top point of the diamond.
 *  • One source handle per `branch_option`, distributed along the bottom-left
 *    and bottom-right slanted sides. Each handle's `id` = the option label.
 *
 * Selected ring + amber tint match the simple-step convention so users can
 * still tell which node is currently selected.
 */
import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { GitBranch, ShieldCheck } from 'lucide-react'
import type { StepDraft } from './types'

export interface BranchNodeData extends Record<string, unknown> {
  step: StepDraft
  selected: boolean
  /** Pre-derived short code (e.g. "S2"). */
  stepCode?: string
}

/** Diamond bounding box. Width slightly larger than height for prose readability. */
const D_WIDTH = 180
const D_HEIGHT = 120

export { D_WIDTH as BRANCH_WIDTH, D_HEIGHT as BRANCH_HEIGHT }

export default memo(function BranchNode({ data }: NodeProps) {
  const { step, selected, stepCode } = data as BranchNodeData

  // Round-5b: prefer the new branch_config.cases (one handle per case
  // labelled by `case.label`). Fall back to legacy branch_options when
  // branch_config is absent.
  const cases = step.branch_config?.cases ?? null
  const opts = cases && cases.length > 0
    ? cases.map(c => c.label || '?')
    : (step.branch_options.length > 0 ? step.branch_options : ['?'])
  // Distribute source handles along the bottom edge of the bounding box.
  // Visually they sit on the two slanted lower diamond sides because the
  // rotated background's edges pass through these x positions.
  function handleLeft(i: number, total: number): string {
    return `${((i + 1) / (total + 1)) * 100}%`
  }

  return (
    <div
      className="relative cursor-pointer"
      style={{ width: D_WIDTH, height: D_HEIGHT }}
    >
      {/* Diamond background — rotated 45° */}
      <div
        className="absolute transition-colors"
        style={{
          // Square sized so its diagonal == the bounding-box diagonal.
          // We approximate with min(width, height) to stay compact.
          width: D_HEIGHT,
          height: D_HEIGHT,
          left: (D_WIDTH - D_HEIGHT) / 2,
          top: 0,
          transform: 'rotate(45deg)',
          background: '#FFFBEB',
          border: selected
            ? '2px solid var(--color-primary-600, #4A6AAB)'
            : '1.5px solid #FCD34D',
          boxShadow: selected
            ? '0 0 0 3px rgba(74,106,171,0.15)'
            : '0 1px 2px rgba(0,0,0,0.04)',
        }}
      />

      {/* Code chip (top-left of bounding box) */}
      {stepCode && (
        <span className="absolute z-10 top-1 left-1 text-[9px] font-mono px-1 py-0.5 bg-white/85 text-neutral-600 border border-neutral-200 rounded">
          {stepCode}
        </span>
      )}

      {/* Content — centred over the diamond */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-3 pointer-events-none">
        <div className="flex items-center gap-1 mb-0.5">
          <GitBranch size={13} className="text-amber-600" />
          {step.requires_approval && <ShieldCheck size={11} className="text-amber-600" aria-label="Cần duyệt" />}
        </div>
        <div className="text-[12px] font-medium text-amber-900 text-center leading-tight max-w-[120px] truncate">
          {step.title || <span className="italic text-amber-700/60">(rẽ nhánh)</span>}
        </div>
        <span className="mt-0.5 text-[9px] px-1 py-0 bg-amber-100 text-amber-800 border border-amber-200 rounded">
          {opts.length} nhánh
        </span>
      </div>

      {/* Target handle — top point */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ left: '50%', top: 0 }}
      />

      {/* Source handles — one per branch_option, along the bottom edge */}
      {opts.map((opt, i) => (
        <Handle
          key={opt}
          id={opt}
          type="source"
          position={Position.Bottom}
          style={{ left: handleLeft(i, opts.length), bottom: 0 }}
        >
          <span
            style={{
              position: 'absolute',
              top: 6,
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: 9,
              fontWeight: 600,
              color: '#92918D',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              background: 'rgba(255,251,235,0.95)',
              padding: '0 3px',
              borderRadius: 2,
            }}
          >
            {opt}
          </span>
        </Handle>
      ))}
    </div>
  )
})
