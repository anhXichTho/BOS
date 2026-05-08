import type { Routine, RoutineKind } from '../types'

const DAY_NAMES_VI = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

/** Format a routine into a human Vietnamese label. */
export function formatRoutine(r: Routine): string {
  switch (r.kind) {
    case 'daily':
      return `Hằng ngày lúc ${r.at}`
    case 'weekly':
      return `Hằng tuần ${DAY_NAMES_VI[r.day_of_week] ?? '?'} lúc ${r.at}`
    case 'monthly':
      return `Hằng tháng ngày ${r.day_of_month} lúc ${r.at}`
    case 'once':
      return `Một lần — ${new Date(r.at).toLocaleString('vi')}`
  }
}

/** Default routine for a fresh schedule. */
export function defaultRoutine(kind: RoutineKind = 'daily'): Routine {
  const tz = 'Asia/Ho_Chi_Minh'
  switch (kind) {
    case 'daily':   return { kind: 'daily',   at: '09:00', tz }
    case 'weekly':  return { kind: 'weekly',  at: '09:00', day_of_week: 1, tz }
    case 'monthly': return { kind: 'monthly', at: '09:00', day_of_month: 1, tz }
    case 'once': {
      const d = new Date()
      d.setHours(9, 0, 0, 0)
      d.setDate(d.getDate() + 1)
      return { kind: 'once', at: d.toISOString() }
    }
  }
}

/**
 * Compute next-run timestamp client-side. Server has the canonical version
 * (compute_next_run() SQL function) — this is for "preview" in the UI.
 * Returns ISO string, or null if no next run (past once-shot).
 */
export function computeNextRun(routine: Routine, fromMs: number = Date.now()): string | null {
  const from = new Date(fromMs)
  switch (routine.kind) {
    case 'once': {
      const t = new Date(routine.at).getTime()
      return t > fromMs ? new Date(t).toISOString() : null
    }
    case 'daily': {
      const [h, m] = routine.at.split(':').map(Number)
      const d = new Date(from)
      d.setHours(h, m, 0, 0)
      if (d.getTime() <= fromMs) d.setDate(d.getDate() + 1)
      return d.toISOString()
    }
    case 'weekly': {
      const [h, m] = routine.at.split(':').map(Number)
      const d = new Date(from)
      d.setHours(h, m, 0, 0)
      const diff = (routine.day_of_week - d.getDay() + 7) % 7
      d.setDate(d.getDate() + diff)
      if (d.getTime() <= fromMs) d.setDate(d.getDate() + 7)
      return d.toISOString()
    }
    case 'monthly': {
      const [h, m] = routine.at.split(':').map(Number)
      const target = Math.min(routine.day_of_month, 28)
      const d = new Date(from.getFullYear(), from.getMonth(), target, h, m, 0, 0)
      if (d.getTime() <= fromMs) d.setMonth(d.getMonth() + 1)
      return d.toISOString()
    }
  }
}
