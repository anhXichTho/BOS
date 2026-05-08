/**
 * StepNode — simple (non-branch) step pill.
 *
 * Round-5 Phase B: branch path moved to BranchNode (diamond). This component
 * now only renders the simple variant.
 *
 * Layout:
 *  • Top-left chip: short code (S{N}) — derived externally and passed via data.
 *  • Body line 1 — title (truncated).
 *  • Body line 2 — when a form is attached: F{N} · {form_template_name} chip.
 *  • Status dot + approval/form icons in the trailing slot.
 */
import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { ShieldCheck, FileText } from 'lucide-react'
import type { StepDraft } from './types'

export interface StepNodeData extends Record<string, unknown> {
  step: StepDraft
  selected: boolean
  /** Pre-derived short code (e.g. "S2"). */
  stepCode?: string
  /** Pre-derived form code (e.g. "F1") when step has a form. */
  formCode?: string
  /** Looked-up form template name. */
  formName?: string
}

const NODE_WIDTH = 200
const NODE_HEIGHT = 56

export { NODE_WIDTH, NODE_HEIGHT }

export default memo(function StepNode({ data }: NodeProps) {
  const { step, selected, stepCode, formCode, formName } = data as StepNodeData

  const statusColor =
    !step.title.trim() || step.isNew
      ? 'var(--color-warning, #C8954A)'
      : 'var(--color-success, #5A8C5A)'

  return (
    <div
      className="bg-white rounded-md transition-colors flex items-center gap-2 px-2.5 py-2 cursor-pointer relative"
      style={{
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        border: selected
          ? '2px solid var(--color-primary-600, #4A6AAB)'
          : '1px solid var(--color-neutral-100, #E0E0E0)',
        boxShadow: selected
          ? '0 0 0 3px rgba(74,106,171,0.15)'
          : '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />

      {/* Code chip (top-left) */}
      {stepCode && (
        <span className="absolute -top-2 left-1 text-[9px] font-mono px-1 py-0 bg-white text-neutral-600 border border-neutral-200 rounded">
          {stepCode}
        </span>
      )}

      {/* Status dot */}
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: statusColor }}
      />

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-neutral-700 truncate">
          {step.title || <span className="italic text-neutral-400">(chưa đặt tên)</span>}
        </div>
        {step.form_template_id && (
          <div className="flex items-center gap-1 mt-0.5 text-[10px] text-neutral-500 truncate">
            <FileText size={9} className="text-primary-600 shrink-0" />
            <span className="font-mono text-neutral-500 shrink-0">{formCode ?? 'F?'}</span>
            <span className="truncate">· {formName ?? '(form)'}</span>
          </div>
        )}
        {step.requires_approval && (
          <div className="absolute top-1 right-1">
            <ShieldCheck size={11} className="text-amber-600" aria-label="Cần duyệt" />
          </div>
        )}
      </div>
    </div>
  )
})
