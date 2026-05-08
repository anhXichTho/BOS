import DOMPurify from 'dompurify'

/** Tags + attributes allowed in user-generated rich content. */
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'div', 'br', 'span',
    'strong', 'b', 'em', 'i', 'u', 's',
    'h1', 'h2', 'h3',
    'ul', 'ol', 'li',
    'blockquote', 'code', 'pre',
    'a', 'img',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'style'],
  // Only allow safe URLs (http/https, mailto, tel, embedded image data URIs)
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|data:image\/[a-z]+;base64,):/i,
}

/** Sanitize a possibly-untrusted HTML string. Returns safe HTML. */
export function sanitizeHtml(html: string): string {
  // DOMPurify@3 returns string by default, but its type definition can be `TrustedHTML | string`.
  return DOMPurify.sanitize(html, SANITIZE_CONFIG) as unknown as string
}

/**
 * Heuristic: looks like rich (HTML) content vs plain text?
 * Rich content starts with `<` followed by a known block-level tag.
 */
export function looksLikeHtml(content: string | null | undefined): boolean {
  if (!content) return false
  const trimmed = content.trim()
  return /^<(p|div|h[1-3]|ul|ol|blockquote|pre|span|strong|b|em|i|u|s|a|img)\b/i.test(trimmed)
}
