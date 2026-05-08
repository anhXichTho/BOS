import { useMemo } from 'react'
import { sanitizeHtml, looksLikeHtml } from '../../lib/sanitizeHtml'

interface Props {
  content: string | null | undefined
  className?: string
}

/**
 * Renders user content as either sanitized HTML (when it looks like rich content)
 * or plain text. Safe to use with anything coming from the database.
 */
export default function RichTextDisplay({ content, className = '' }: Props) {
  const safe = useMemo(() => content ? sanitizeHtml(content) : '', [content])

  if (!content) return null

  if (looksLikeHtml(content)) {
    return (
      <div
        className={`rich-content ${className}`}
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    )
  }
  return <span className={className} style={{ whiteSpace: 'pre-wrap' }}>{content}</span>
}
