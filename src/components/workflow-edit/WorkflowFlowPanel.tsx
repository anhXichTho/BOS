/**
 * Workflow flow visualization powered by React Flow.
 *
 * Round-5 Phase A/B updates on top of the round-4 interactive builder:
 *  • Two node types: simple (StepNode pill) + branch (BranchNode diamond).
 *  • Step + form short codes (S1, S2, …, F1, F2, …) derived per render and
 *    passed into each node's `data` for display.
 *  • onEdgeContextMenu shows EdgeContextMenu (right-click → Xoá kết nối).
 *
 * Edit-mode toggle from round-4d still gates draggable / connectable / add /
 * remove. Codes + node-type dispatch run in BOTH modes so the canvas reads
 * cleanly regardless.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow, Background, Controls, useNodesState, useEdgesState, MarkerType,
} from '@xyflow/react'
import type {
  Node, Edge, NodeMouseHandler, Connection, NodeChange, EdgeChange,
} from '@xyflow/react'
import { Plus, Trash2, ChevronUp, ChevronDown, GitBranch, Pencil, Eye } from 'lucide-react'
import StepNode, { NODE_HEIGHT } from './StepNode'
import BranchNode from './BranchNode'
import EdgeContextMenu from './EdgeContextMenu'
import { dfsOrdered } from './stepTree'
import { deriveCodes } from './codes'
import type { StepDraft } from './types'
import type { FormTemplate } from '../../types'

import '@xyflow/react/dist/style.css'

interface Props {
  steps: StepDraft[]
  selectedStepId: string | null
  onSelect: (id: string) => void
  /** Spawn a new disconnected simple step. */
  onAddSimple: () => void
  /** Spawn a new disconnected branch step. */
  onAddBranch: () => void
  /** Legacy: add a child under a parent with a specific branch_condition. */
  onAddChild: (parentId: string, branchCondition?: string) => void
  /** Connect two nodes (sourceId → targetId). When source is branch, sourceHandle = branch_option. */
  onConnect: (sourceId: string, targetId: string, sourceHandle?: string | null) => void
  /** Disconnect a child from its parent (sets parent_step_id = null). */
  onDisconnect: (targetId: string) => void
  /** Persist a node's dragged position into the StepDraft. */
  onMoveNode: (stepId: string, x: number, y: number) => void
  onRemove: (id: string) => void
  /** Form templates list — used to look up form names for the node subtitle. */
  formTemplates?: FormTemplate[]
  /** Step ids to outline (driven externally — e.g. hovering form-fill rows). */
  highlightedStepIds?: string[]
  /** When true, only the toolbar (header strip) renders; canvas hidden. */
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const NODE_TYPES = { simple: StepNode, branch: BranchNode }

const ROW_HEIGHT = NODE_HEIGHT + 28
const DEPTH_INDENT = 28
const X_BASE = 24

/**
 * Fallback positioning: DFS-ordered vertical chain. Used only when a step
 * has no `position_x/y` yet (fresh load of an existing template).
 */
function fallbackPosition(steps: StepDraft[]): Record<string, { x: number; y: number }> {
  const depthOf: Record<string, number> = {}
  function computeDepth(s: StepDraft): number {
    if (depthOf[s.id] != null) return depthOf[s.id]
    if (!s.parent_step_id) return (depthOf[s.id] = 0)
    const parent = steps.find(p => p.id === s.parent_step_id)
    if (!parent) return (depthOf[s.id] = 0)
    return (depthOf[s.id] = computeDepth(parent) + 1)
  }
  for (const s of steps) computeDepth(s)
  const ordered = dfsOrdered(steps)
  const out: Record<string, { x: number; y: number }> = {}
  ordered.forEach((s, idx) => {
    out[s.id] = {
      x: X_BASE + (depthOf[s.id] ?? 0) * DEPTH_INDENT,
      y: 16 + idx * ROW_HEIGHT,
    }
  })
  return out
}

export default memo(function WorkflowFlowPanel({
  steps, selectedStepId, onSelect,
  onAddSimple, onAddBranch, onAddChild,
  onConnect, onDisconnect, onMoveNode, onRemove,
  formTemplates,
  highlightedStepIds,
  collapsed = false, onToggleCollapse,
}: Props) {
  // Right-click edge context menu state.
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; targetStepId: string } | null>(null)

  // Pre-derive per-render lookups: codes + form names.
  const codes = useMemo(() => deriveCodes(steps), [steps])
  const formNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const f of (formTemplates ?? [])) m[f.id] = f.name
    return m
  }, [formTemplates])
  const highlightSet = useMemo(() => new Set(highlightedStepIds ?? []), [highlightedStepIds])
  /**
   * Edit mode — when off (default), the canvas is purely a viewer: cleaner
   * for skimming, no add buttons, no draggable handles, edges read-only.
   * When on, all interaction (drag, connect, delete, add) is enabled.
   * Persists per-user via localStorage.
   */
  const [editMode, setEditMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('bos_workflow_edit_flow_edit_mode') === '1'
  })
  useEffect(() => {
    try { localStorage.setItem('bos_workflow_edit_flow_edit_mode', editMode ? '1' : '0') } catch {}
  }, [editMode])
  // Build initial nodes + edges from steps[]
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const fallbacks = fallbackPosition(steps)
    const ns: Node[] = steps.map(step => {
      const fb = fallbacks[step.id] ?? { x: 24, y: 24 }
      const isHighlighted = highlightSet.has(step.id)
      return {
        id: step.id,
        type: step.step_type === 'branch' ? 'branch' : 'simple',
        position: {
          x: step.position_x ?? fb.x,
          y: step.position_y ?? fb.y,
        },
        data: {
          step,
          selected: step.id === selectedStepId,
          stepCode: codes.stepCode[step.id],
          formCode: step.form_template_id ? codes.formCode[step.form_template_id] : undefined,
          formName: step.form_template_id ? formNameById[step.form_template_id] : undefined,
        },
        className: isHighlighted ? 'bos-flow-highlighted' : undefined,
        draggable: editMode,
        connectable: editMode,
        selectable: true,
      }
    })
    const es: Edge[] = steps
      .filter(s => s.parent_step_id)
      .map(s => {
        const parent = steps.find(p => p.id === s.parent_step_id)
        const showLabel = parent?.step_type === 'branch' && !!s.branch_condition
        return {
          id: `${s.parent_step_id}->${s.id}`,
          source: s.parent_step_id!,
          target: s.id,
          // When source is a branch, anchor the edge to the per-option handle.
          sourceHandle: parent?.step_type === 'branch' && s.branch_condition
            ? s.branch_condition
            : undefined,
          type: 'smoothstep',
          animated: false,
          label: showLabel ? s.branch_condition! : undefined,
          labelStyle: showLabel
            ? { fontSize: 10, fontWeight: 600, fill: '#92918D' }
            : undefined,
          labelBgStyle: showLabel
            ? { fill: '#FEF3C7', fillOpacity: 1, stroke: '#FCD34D', strokeWidth: 0.5 }
            : undefined,
          labelBgPadding: [6, 4] as [number, number],
          labelBgBorderRadius: 4,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#6F6F6E' },
          style: { stroke: '#6F6F6E', strokeWidth: 2 },
        }
      })
    return { nodes: ns, edges: es }
  }, [steps, selectedStepId, editMode, codes, formNameById, highlightSet])

  const [nodes, setNodes, onNodesChangeRf] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChangeRf] = useEdgesState(initialEdges)
  useEffect(() => { setNodes(initialNodes); setEdges(initialEdges) }, [initialNodes, initialEdges, setNodes, setEdges])

  // ─── Interaction handlers ───────────────────────────────────────────────

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChangeRf(changes)
    // Persist drag-stop positions into StepDraft so they survive selection re-renders.
    for (const c of changes) {
      if (c.type === 'position' && c.dragging === false && c.position) {
        onMoveNode(c.id, c.position.x, c.position.y)
      }
    }
  }, [onNodesChangeRf, onMoveNode])

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    onEdgesChangeRf(changes)
  }, [onEdgesChangeRf])

  const handleConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return
    onConnect(conn.source, conn.target, conn.sourceHandle)
  }, [onConnect])

  const handleEdgesDelete = useCallback((deleted: Edge[]) => {
    for (const e of deleted) {
      onDisconnect(e.target)
    }
  }, [onDisconnect])

  const handleNodeClick: NodeMouseHandler = (_e, node) => onSelect(node.id)

  /** Right-click on an edge — open the small context menu (edit mode only). */
  const handleEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    if (!editMode) return
    e.preventDefault()
    setEdgeMenu({ x: e.clientX, y: e.clientY, targetStepId: edge.target })
  }, [editMode])

  // ─── Toolbar derived state ──────────────────────────────────────────────

  const selectedStep = steps.find(s => s.id === selectedStepId)
  const showBranchAdd = !!selectedStep && selectedStep.step_type === 'branch' && selectedStep.branch_options.length > 0

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-1.5 bg-white shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Sơ đồ ({steps.length} bước)
        </span>
        {!collapsed && editMode && (
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-primary-50 text-primary-700 rounded">
            Đang sửa
          </span>
        )}
        <div className="flex-1" />

        {!collapsed && editMode && selectedStep && (
          <button
            type="button"
            onClick={() => { if (confirm(`Xoá bước "${selectedStep.title || '(chưa đặt tên)'}"?`)) onRemove(selectedStep.id) }}
            className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 border border-neutral-200 rounded text-neutral-500 hover:text-red-600 hover:border-red-300"
            title="Xoá bước đang chọn"
          >
            <Trash2 size={10} /> Xoá
          </button>
        )}

        {!collapsed && editMode && (
          <>
            <button
              type="button"
              onClick={onAddBranch}
              className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 border border-amber-300 rounded text-amber-700 hover:bg-amber-50"
              title="Thêm điểm rẽ nhánh (decision)"
            >
              <GitBranch size={10} /> Rẽ nhánh
            </button>
            <button
              type="button"
              onClick={onAddSimple}
              className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 border border-neutral-200 rounded hover:bg-neutral-50"
              title="Thêm bước"
            >
              <Plus size={10} /> Bước
            </button>
          </>
        )}

        {!collapsed && (
          <button
            type="button"
            onClick={() => setEditMode(v => !v)}
            className={`text-[11px] inline-flex items-center gap-1 px-2 py-0.5 border rounded transition-colors ${
              editMode
                ? 'border-primary-400 text-primary-700 bg-primary-50 hover:bg-primary-100'
                : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
            }`}
            title={editMode ? 'Tắt chế độ sửa (xem gọn)' : 'Bật chế độ sửa (kéo / nối / thêm)'}
          >
            {editMode ? <><Eye size={10} /> Xem</> : <><Pencil size={10} /> Sửa</>}
          </button>
        )}

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="text-neutral-400 hover:text-neutral-700 p-1 rounded hover:bg-neutral-50 transition-colors"
            title={collapsed ? 'Hiện sơ đồ' : 'Ẩn sơ đồ'}
            aria-label={collapsed ? 'Hiện sơ đồ' : 'Ẩn sơ đồ'}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        )}
      </div>

      {/* Branch-add popover (only when expanded + edit-mode + selected step is branch) */}
      {!collapsed && editMode && showBranchAdd && (
        <div className="flex flex-wrap gap-1 px-3 py-1.5 bg-amber-50/50 border-b border-amber-100 shrink-0">
          <span className="text-[10px] text-amber-700 mr-1">Thêm con cho "{selectedStep!.title || 'nhánh'}":</span>
          {selectedStep!.branch_options.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => onAddChild(selectedStep!.id, opt)}
              className="text-[10px] px-1.5 py-0.5 border border-dashed border-amber-300 text-amber-700 rounded hover:bg-amber-100"
            >
              + {opt}
            </button>
          ))}
        </div>
      )}

      {/* Canvas */}
      {!collapsed && (
      <div className={`flex-1 min-h-0 bg-neutral-25 ${editMode ? '' : 'bos-flow-view-mode'}`}>
        {steps.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[11px] text-neutral-400 px-4 text-center">
            <div>
              Chưa có bước nào. Bấm <strong className="mx-1">+ Bước</strong> hoặc <strong className="mx-1">+ Rẽ nhánh</strong> để bắt đầu.
              <br />
              Sau đó kéo từ đầu dưới của bước này sang đầu trên của bước kia để nối.
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            defaultEdgeOptions={{
              type: 'smoothstep',
              style: { stroke: '#6F6F6E', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#6F6F6E' },
            }}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={editMode ? handleConnect : undefined}
            onEdgesDelete={editMode ? handleEdgesDelete : undefined}
            onEdgeContextMenu={handleEdgeContextMenu}
            onNodeClick={handleNodeClick}
            nodesDraggable={editMode}
            nodesConnectable={editMode}
            elementsSelectable
            edgesFocusable={editMode}
            edgesReconnectable={false}
            panOnDrag
            zoomOnScroll
            zoomOnDoubleClick={false}
            minZoom={0.4}
            maxZoom={1.6}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1.0 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} color="#E0E0E0" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        )}
      </div>
      )}

      {/* Right-click → context menu (rendered as portal-like overlay via fixed positioning) */}
      {edgeMenu && (
        <EdgeContextMenu
          x={edgeMenu.x}
          y={edgeMenu.y}
          onDelete={() => onDisconnect(edgeMenu.targetStepId)}
          onClose={() => setEdgeMenu(null)}
        />
      )}
    </div>
  )
})
