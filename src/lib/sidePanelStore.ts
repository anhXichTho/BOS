import { useSyncExternalStore } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

// Round-10 follow-up: 'thread' removed — replies render inline (Zalo-style).
export type PanelKind = 'submission_view' | 'workflow_run' | 'task_view'

export interface OpenItem {
  /** Draft ID, submission ID, or sentinel 'new' for an unsaved draft. */
  id: string
  kind: PanelKind
  title: string
  /** Extra metadata passed through without interpretation by the store. */
  meta?: Record<string, unknown>
  /**
   * workflow_run only — when true renders as a centred modal overlay instead of the
   * default 30%-width right-side push panel.
   */
  expanded?: boolean
}

interface PanelState {
  active: OpenItem | null
  minimized: OpenItem[]
}

// ─── Singleton store (no Zustand dependency) ──────────────────────────────────

type Listener = () => void
const listeners = new Set<Listener>()
let state: PanelState = { active: null, minimized: [] }

function emit() { listeners.forEach(l => l()) }

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): PanelState { return state }

// ─── Actions (callable outside React) ────────────────────────────────────────

/** Open an item. Current active → minimized (capped at 5). */
export function openPanel(item: OpenItem) {
  const prev = state.active
  const alreadyMinimized = state.minimized.filter(m => m.id !== item.id)
  state = {
    active: item,
    minimized: prev && prev.id !== item.id
      ? [...alreadyMinimized, prev].slice(-5)
      : alreadyMinimized,
  }
  emit()
}

/** Move active → minimized. */
export function minimizePanel() {
  if (!state.active) return
  state = {
    active: null,
    minimized: [...state.minimized.filter(m => m.id !== state.active!.id), state.active].slice(-5),
  }
  emit()
}

/** Pull an item from minimized → active. */
export function restorePanel(id: string) {
  const item = state.minimized.find(m => m.id === id)
  if (item) openPanel(item)
}

/** Close an item by id, or close active when no id provided. */
export function closePanel(id?: string) {
  const targetId = id ?? state.active?.id
  state = {
    active: state.active?.id === targetId ? null : state.active,
    minimized: state.minimized.filter(m => m.id !== targetId),
  }
  emit()
}

/** Close ALL panels and clear minimized chips (e.g. when leaving the chat page). */
export function clearPanels() {
  state = { active: null, minimized: [] }
  emit()
}

/**
 * Update the active item's id + title in-place.
 * Used when a new draft is saved to the DB and gets a real UUID.
 */
export function replaceActiveId(newId: string, newTitle: string) {
  if (!state.active) return
  state = { ...state, active: { ...state.active, id: newId, title: newTitle } }
  emit()
}

/** Toggle the expanded flag on the active panel (workflow_run only). */
export function togglePanelExpand() {
  if (!state.active) return
  state = { ...state, active: { ...state.active, expanded: !state.active.expanded } }
  emit()
}

// ─── React hook ───────────────────────────────────────────────────────────────

export function useSidePanel() {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return {
    active:  s.active,
    minimized: s.minimized,
    open:    openPanel,
    minimize: minimizePanel,
    restore: restorePanel,
    close:   closePanel,
  }
}
