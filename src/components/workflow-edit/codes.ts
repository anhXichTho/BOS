/**
 * Short-code derivation for steps + forms.
 *
 * Round-5 cross-cutting concept. Codes are NOT stored — they're derived
 * deterministically from the current draft each render:
 *  • Steps numbered S1, S2, … in DFS order (matches the canvas chain).
 *  • Forms numbered F1, F2, … in the order their `form_template_id` is
 *    first encountered while walking DFS.
 *
 * Codes appear on canvas nodes, in the detail panel header, in form
 * subtitles, in the show-when picker, and in AI input/output. They give
 * users + the AI a stable address that survives renames.
 */
import { dfsOrdered } from './stepTree'
import type { StepDraft } from './types'

export interface DerivedCodes {
  /** step.id → "S1" | "S2" … */
  stepCode: Record<string, string>
  /** form_template_id → "F1" | "F2" … */
  formCode: Record<string, string>
  /** Reverse maps for AI patch resolution. */
  stepIdByCode: Record<string, string>
  formIdByCode: Record<string, string>
}

export function deriveCodes(steps: StepDraft[]): DerivedCodes {
  const ordered = dfsOrdered(steps)

  const stepCode: Record<string, string> = {}
  const stepIdByCode: Record<string, string> = {}
  ordered.forEach((s, i) => {
    const code = `S${i + 1}`
    stepCode[s.id] = code
    stepIdByCode[code] = s.id
  })

  const formCode: Record<string, string> = {}
  const formIdByCode: Record<string, string> = {}
  let formCounter = 0
  for (const s of ordered) {
    if (s.form_template_id && !formCode[s.form_template_id]) {
      formCounter += 1
      const code = `F${formCounter}`
      formCode[s.form_template_id] = code
      formIdByCode[code] = s.form_template_id
    }
  }

  return { stepCode, formCode, stepIdByCode, formIdByCode }
}
