/**
 * Sticker pack — local "Ami" set served from /public.
 *
 * Round-9 polish: dropped the meme/doge/cheems set (memegen.link based)
 * in favour of a single curated "Ami" pack hosted in `public/stickers/ami/`.
 * 41 files (20 PNG + 21 GIF). Single category so the picker reads as a
 * grid, not a tabbed group.
 *
 * Each sticker is rendered as a regular chat message with
 * `payload.kind = 'sticker'`. URLs are absolute paths, served by Vite's
 * static `public/` pipeline (final URL: `/stickers/ami/<file>`). Old
 * meme-link stickers in existing chat history remain valid (memegen.link
 * is still up) — no migration needed.
 */

export interface Sticker {
  id: string                // unique key (filename without extension)
  url: string               // absolute path under /public
  alt: string               // accessibility + tooltip
  category?: string         // for grouping in the picker
}

// File names from `public/stickers/ami/`. Order: PNG first (cheaper to
// render), GIF after, both alphabetical within their group.
const PNG_FILES = [
  '0omKvZ2.png', '2rjx2Z2.png', '9PbOYY6.png', 'FQ8EIU3.png', 'FcPENzH.png',
  'GEKbDVv.png', 'Gw6SGk8.png', 'HpkWuWQ.png', 'Kww4MM4.png', 'NkTGVVx.png',
  'QoHvnKB.png', 'U1ohXnb.png', 'VzfTLSE.png', 'boGP0cp.png', 'e0kHDoI.png',
  'lT2smFP.png', 'lVmCB00.png', 'pc2vIuJ.png', 'piE0Az1.png', 'r2dsS8i.png',
  'tdnCpsj.png', 'uG2HGTM.png',
] as const

const GIF_FILES = [
  '4vrT96P.gif', '5QJEiZg.gif', '5wgCcaI.gif', 'CQ74c3x.gif', 'GLQwEBF.gif',
  'HMnyJyz.gif', 'Kq1Gc0O.gif', 'NbuQZ0r.gif', 'TtcitF6.gif', 'bSjXO5Y.gif',
  'eI8h5FK.gif', 'ej4syjH.gif', 'kfhb8et.gif', 'kupB5LD.gif', 'nFcRgUI.gif',
  'nMqk8XS.gif', 'skDgRgx.gif', 'tN9p0ps.gif', 'zoa297K.gif',
] as const

const toSticker = (file: string, idx: number): Sticker => ({
  id:       file.replace(/\.(png|gif)$/i, ''),
  url:      `/stickers/ami/${file}`,
  alt:      `Ami ${idx + 1}`,
  category: 'Ami',
})

export const STICKERS: Sticker[] = [
  ...PNG_FILES.map(toSticker),
  ...GIF_FILES.map((f, i) => toSticker(f, PNG_FILES.length + i)),
]

export const STICKER_CATEGORIES = ['Ami'] as const
export type StickerCategory = typeof STICKER_CATEGORIES[number]

export const AMI_STICKER_COUNT = STICKERS.length
