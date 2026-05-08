import type { FormTemplate } from '../types'

export interface CardSummaryEntry {
  label: string
  value: string
}

/**
 * Builds up to 3 summary entries for a chat card from a form submission.
 *
 * Looks up each id in `template.summary_field_ids`, finds the matching field
 * in `template.fields`, and formats the value from `data`.
 *
 * Returns an empty array when no summary fields are configured, or when the
 * `summary_field_ids` column is absent (migration not yet applied).
 *
 * Pure function — no side effects.
 */
export function buildCardSummary(
  template: FormTemplate,
  data: Record<string, unknown>,
): CardSummaryEntry[] {
  const ids = template.summary_field_ids ?? []
  if (ids.length === 0) return []

  const fieldMap = new Map(template.fields.map(f => [f.id, f]))

  const result: CardSummaryEntry[] = []

  for (const id of ids.slice(0, 3)) {
    const field = fieldMap.get(id)
    if (!field) continue

    const raw = data[id]
    if (raw === null || raw === undefined || raw === '') continue

    let value: string
    if (Array.isArray(raw)) {
      value = (raw as unknown[]).map(String).join(', ')
    } else {
      value = String(raw)
    }

    if (value.trim()) {
      result.push({ label: field.label, value: value.trim() })
    }
  }

  return result
}
