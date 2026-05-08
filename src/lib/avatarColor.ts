/**
 * avatarColor — deterministic colour palette for user / channel avatars.
 *
 * Round-9 polish (revised): the original Tailwind-100 swatches were too
 * vibrant. Now uses a Tableau-10-inspired *muted* palette: every entry is
 * a desaturated tint that reads warm and editorial, not candy-bright.
 * Same seed always returns the same colour, so each user/channel has a
 * stable visual fingerprint.
 *
 * Notes
 *  - Static arbitrary-hex Tailwind classes (`bg-[#xxx]`, `text-[#xxx]`).
 *    Tailwind v4 JIT picks them up because every candidate appears
 *    literally in this file.
 *  - 9 entries; deliberately drops Tableau's red (clashes with our
 *    semantic-danger) and keeps the rest as the muted T10 set.
 */

export interface AvatarColor {
  /** Soft tinted background — for avatar chips and message bubbles. */
  bg:    string
  /** Foreground text colour matched to `bg` (high enough contrast). */
  text:  string
  /** Mid-tone solid version (status dots / accent strips / unread pills). */
  solid: string
  /** Ring-friendly shade for outlines. */
  ring:  string
}

// Tableau-10 muted palette (red dropped — reserved for `--color-danger`).
const PALETTE: readonly AvatarColor[] = [
  // Blue
  { bg: 'bg-[#DCE4EE]', text: 'text-[#355475]', solid: 'bg-[#6F8CB3]', ring: 'ring-[#B6C4DA]' },
  // Orange
  { bg: 'bg-[#F8E5D2]', text: 'text-[#8C5022]', solid: 'bg-[#D78B45]', ring: 'ring-[#ECC596]' },
  // Teal
  { bg: 'bg-[#DEEAE9]', text: 'text-[#4A7570]', solid: 'bg-[#7AAFA9]', ring: 'ring-[#B5D2CE]' },
  // Green
  { bg: 'bg-[#DEEADB]', text: 'text-[#3D6736]', solid: 'bg-[#7BAA73]', ring: 'ring-[#B7CDB1]' },
  // Yellow / olive
  { bg: 'bg-[#F4EBC7]', text: 'text-[#6E5A1E]', solid: 'bg-[#C9AE53]', ring: 'ring-[#DDC983]' },
  // Purple
  { bg: 'bg-[#E8DCE5]', text: 'text-[#6E4862]', solid: 'bg-[#A380A0]', ring: 'ring-[#C5AFC3]' },
  // Pink (muted, not hot)
  { bg: 'bg-[#F8DEE3]', text: 'text-[#8B4F58]', solid: 'bg-[#D58E97]', ring: 'ring-[#E8B5BD]' },
  // Brown
  { bg: 'bg-[#E8DDD3]', text: 'text-[#6B4E37]', solid: 'bg-[#9D7B5F]', ring: 'ring-[#C5A88E]' },
  // Warm grey
  { bg: 'bg-[#E5E2E0]', text: 'text-[#595350]', solid: 'bg-[#968B85]', ring: 'ring-[#BBB0AB]' },
] as const

/**
 * FNV-1a-style fold of the seed string. Always returns a non-negative int.
 * Cheap, deterministic, well-distributed for short seeds (uuids, names).
 */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    // Multiply by FNV prime, keep 32-bit
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

// Module-scoped cache so the same seed (a uuid, basically) doesn't re-hash
// on every render. With 200+ messages in a feed plus channel-list badges,
// this trims many thousands of redundant FNV folds per session.
const COLOR_CACHE = new Map<string, AvatarColor>()
const NULL_COLOR: AvatarColor = {
  bg: 'bg-neutral-100', text: 'text-neutral-600', solid: 'bg-neutral-400', ring: 'ring-neutral-300',
}

/**
 * Return a stable colour for the given seed (typically `profile.id`).
 * Falls back to a neutral grey-ish chip when the seed is empty/null.
 */
export function avatarColorOf(seed: string | null | undefined): AvatarColor {
  if (!seed) return NULL_COLOR
  const cached = COLOR_CACHE.get(seed)
  if (cached) return cached
  const c = PALETTE[hashSeed(seed) % PALETTE.length]
  COLOR_CACHE.set(seed, c)
  return c
}

/**
 * Render-helper — Vietnamese-aware initials.
 *  "Nguyễn Văn An" → "VA"  (last 2 words)
 *  "An"            → "A"
 */
export function initialsOf(fullName: string | null | undefined): string {
  if (!fullName) return '?'
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const tail = parts.slice(-2)
  return tail.map(w => w[0]?.toUpperCase() ?? '').join('')
}
