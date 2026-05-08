// ─── Slug helper ─────────────────────────────────────────────────────────────
// Vietnamese diacritic-safe slug generator.
// "Du an Website Q3 - ban 2" -> "du-an-website-q3-ban-2"

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip combining diacritical marks
    .replace(/[đĐ]/g, 'd')   // d-bar -> d (Vietnamese đ/Đ)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '')
}

/** Append `-2`, `-3`… until unique among `existing`. */
export function uniqueSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}
