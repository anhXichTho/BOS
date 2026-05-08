import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Minus, X, Maximize2, Minimize2 } from 'lucide-react'
import { useSidePanel, closePanel, clearPanels, togglePanelExpand } from '../../lib/sidePanelStore'
import SubmissionView from './SubmissionView'
import WorkflowRunPanel from './WorkflowRunPanel'
import TaskView from './TaskView'
// Round-10 follow-up: ThreadPanel deleted — replies render inline now.

/**
 * Global side-panel shell — only active on /chat routes.
 *
 * Layout variants by active.kind:
 *   submission_view           → 480 px right slide-in push panel.
 *   workflow_run (default)    → 480 px right slide-in push panel + Maximize button.
 *   workflow_run (expanded)   → centred modal overlay (backdrop + card, max-w-2xl).
 *
 * Minimized chips appear bottom-right.
 */
export default function SidePanel() {
  const location = useLocation()
  const isPanelEnabled = ['/chat', '/projects', '/workflows', '/tasks'].some(
    prefix => location.pathname.startsWith(prefix),
  )
  const { active, minimized, minimize, restore } = useSidePanel()

  useEffect(() => {
    if (!isPanelEnabled) clearPanels()
  }, [isPanelEnabled])

  if (!isPanelEnabled) return null

  const isOpen = !!active
  const isExpandedModal = active?.kind === 'workflow_run' && active.expanded === true
  const isPushPanel = isOpen && !isExpandedModal

  return (
    <>
      {/* ── Right slide-in panel ────────────────────────────────────────── */}
      <div
        className={`hidden md:flex fixed right-0 top-0 bottom-0 z-40 w-[480px] flex-col bg-white border-l border-neutral-200 shadow-lg transition-transform duration-200 ${
          isPushPanel ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {isPushPanel && active && (
          <PanelContent active={active} onMinimize={minimize} onClose={() => closePanel()} />
        )}
      </div>

      {/* Mobile full-screen drawer */}
      {isPushPanel && active && (
        <div
          className="md:hidden fixed inset-x-0 top-0 z-50 flex flex-col bg-white"
          style={{ bottom: '56px' }}
        >
          <PanelContent active={active} onMinimize={minimize} onClose={() => closePanel()} />
        </div>
      )}

      {/* ── Expanded workflow-run modal (centred overlay) ─────────────── */}
      {isExpandedModal && active && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 pb-6 bg-black/40">
          <div
            className="w-full max-w-2xl bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: 'calc(100dvh - 6rem)' }}
          >
            <div className="flex items-center gap-2 px-4 h-12 border-b border-neutral-200 shrink-0">
              <span className="text-sm font-semibold text-neutral-800 truncate flex-1">
                {active.title}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={togglePanelExpand}
                  title="Thu gọn về panel"
                  className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50 transition-colors rounded"
                >
                  <Minimize2 size={14} />
                </button>
                <button
                  onClick={minimize}
                  title="Thu nhỏ"
                  className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50 transition-colors rounded"
                >
                  <Minus size={14} />
                </button>
                <button
                  onClick={() => closePanel()}
                  title="Đóng"
                  className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50 transition-colors rounded"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <WorkflowRunPanel runId={active.id} />
            </div>
          </div>
        </div>
      )}

      {/* ── Minimized chips ─────────────────────────────────────────────── */}
      {minimized.length > 0 && (
        <MinimizedChips
          minimized={minimized}
          onRestore={restore}
          panelOpen={isPushPanel}
        />
      )}
    </>
  )
}

// ─── Panel content (push panel) ───────────────────────────────────────────────

function PanelContent({
  active,
  onMinimize,
  onClose,
}: {
  active: ReturnType<typeof useSidePanel>['active'] & {}
  onMinimize: () => void
  onClose: () => void
}) {
  const isWorkflow = active.kind === 'workflow_run'

  return (
    <>
      <div className="flex items-center gap-2 px-4 h-12 border-b border-neutral-200 shrink-0 bg-white">
        <span className="text-sm font-semibold text-neutral-800 truncate flex-1">
          {active.title}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {isWorkflow && (
            <button
              onClick={togglePanelExpand}
              title="Mở rộng"
              className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50 transition-colors rounded"
            >
              <Maximize2 size={14} />
            </button>
          )}
          <button
            onClick={onMinimize}
            title="Thu nhỏ"
            className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50 transition-colors rounded"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={onClose}
            title="Đóng"
            className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50 transition-colors rounded"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {active.kind === 'submission_view' && (
          <SubmissionView submissionId={active.id} />
        )}
        {active.kind === 'workflow_run' && (
          <WorkflowRunPanel runId={active.id} />
        )}
        {active.kind === 'task_view' && (
          <TaskView taskId={active.id} />
        )}
      </div>
    </>
  )
}

// ─── Minimized chips ──────────────────────────────────────────────────────────

function MinimizedChips({
  minimized,
  onRestore,
  panelOpen,
}: {
  minimized: ReturnType<typeof useSidePanel>['minimized']
  onRestore: (id: string) => void
  panelOpen: boolean
}) {
  const visible = minimized.slice(-3)
  const extra   = minimized.length - visible.length

  const positionClass = panelOpen
    ? 'bottom-4 right-4 md:right-[492px] md:bottom-4'
    : 'bottom-16 right-4 md:right-4 md:bottom-24'

  return (
    <div className={`fixed z-50 flex flex-col-reverse gap-1.5 items-end ${positionClass}`}>
      {extra > 0 && (
        <div className="bg-neutral-700 text-white text-[10px] font-semibold px-2 py-1 rounded-full">
          +{extra}
        </div>
      )}
      {visible.map(item => (
        <button
          key={item.id}
          onClick={() => onRestore(item.id)}
          className="flex items-center gap-2 bg-white border border-neutral-200 shadow-md px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 max-w-[160px] transition-colors rounded-full"
          title={item.title}
        >
          <span className="truncate">{item.title}</span>
          <button
            onClick={e => { e.stopPropagation(); closePanel(item.id) }}
            className="text-neutral-400 hover:text-neutral-700 shrink-0"
          >
            <X size={10} />
          </button>
        </button>
      ))}
    </div>
  )
}
