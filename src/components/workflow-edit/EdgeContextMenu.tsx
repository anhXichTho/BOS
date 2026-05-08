/**
 * EdgeContextMenu — small floating popover anchored at the right-click point.
 *
 * Phase A of round 5. Triggered by `onEdgeContextMenu` in WorkflowFlowPanel
 * (only when editMode = true). Keeps Backspace/Delete available as a
 * keyboard shortcut on selected edges — this menu is just for discoverability.
 */
import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'

interface Props {
  /** Pixel coordinates (clientX/clientY) of the click. */
  x: number
  y: number
  onDelete: () => void
  onClose: () => void
}

export default function EdgeContextMenu({ x, y, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Click-outside + Escape handlers.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    // Use capture phase so we beat React Flow's own pane-click handler.
    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-[1000] bg-white border border-neutral-200 rounded-md shadow-lg py-1 min-w-[160px]"
      style={{ left: x, top: y }}
      role="menu"
    >
      <button
        type="button"
        onClick={() => { onDelete(); onClose() }}
        className="w-full text-left px-3 py-1.5 text-xs text-neutral-700 hover:bg-red-50 hover:text-red-700 inline-flex items-center gap-2"
        role="menuitem"
      >
        <Trash2 size={12} />
        Xoá kết nối
      </button>
    </div>
  )
}
