/**
 * ResizableVerticalSplit — two stacked panes separated by a draggable
 * horizontal handle. Top pane height is controlled (px). Caller passes
 * default + min/max plus an optional persistKey for localStorage.
 *
 * Hand-rolled: a 4px handle row with cursor-row-resize + pointer events.
 * No external dep needed for a single horizontal divider.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GripHorizontal } from 'lucide-react'

interface Props {
  top: ReactNode
  bottom: ReactNode
  /** Default top height in px. */
  defaultTopPx?: number
  minTopPx?: number
  /** Maximum top height as fraction of container (0..1). Default 0.85. */
  maxTopFrac?: number
  /** Persist key for localStorage. When provided, the height is restored on mount. */
  persistKey?: string
  className?: string
}

export default function ResizableVerticalSplit({
  top, bottom, defaultTopPx = 200, minTopPx = 100, maxTopFrac = 0.85,
  persistKey, className = '',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [topPx, setTopPx] = useState<number>(() => {
    if (persistKey && typeof window !== 'undefined') {
      const saved = localStorage.getItem(persistKey)
      if (saved) {
        const n = parseInt(saved, 10)
        if (Number.isFinite(n) && n > 0) return n
      }
    }
    return defaultTopPx
  })

  // Persist on changes (debounced via rAF)
  useEffect(() => {
    if (!persistKey) return
    const id = requestAnimationFrame(() => {
      try { localStorage.setItem(persistKey, String(topPx)) } catch {}
    })
    return () => cancelAnimationFrame(id)
  }, [topPx, persistKey])

  function clampedTop(next: number): number {
    const el = containerRef.current
    if (!el) return Math.max(minTopPx, next)
    const totalH = el.clientHeight
    const maxPx = totalH * maxTopFrac
    return Math.max(minTopPx, Math.min(maxPx, next))
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    draggingRef.current = true
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const localY = e.clientY - rect.top
    setTopPx(clampedTop(localY))
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  return (
    <div ref={containerRef} className={`flex flex-col min-h-0 ${className}`}>
      <div
        className="min-h-0"
        style={{ height: topPx, flexShrink: 0 }}
      >
        {top}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Kéo để chỉnh chiều cao panel"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={e => {
          if (e.key === 'ArrowUp')   setTopPx(p => clampedTop(p - 16))
          if (e.key === 'ArrowDown') setTopPx(p => clampedTop(p + 16))
        }}
        className="h-2 flex items-center justify-center bg-neutral-50 hover:bg-primary-50 border-y border-neutral-100 cursor-row-resize select-none transition-colors group shrink-0"
      >
        <GripHorizontal size={12} className="text-neutral-300 group-hover:text-primary-600" />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {bottom}
      </div>
    </div>
  )
}
