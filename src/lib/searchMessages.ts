/**
 * searchMessages — full-text-ish search over chat_messages.content using
 * PostgREST ilike. RLS naturally scopes results to channels the caller
 * can see (team channels visible to all + private channels with member
 * grant + DMs where caller is owner or partner + project threads with
 * project access).
 *
 * Round-9. Note: chat_messages.context_id is polymorphic (channel id OR
 * project id — no FK declared), so we can't use a PostgREST nested join.
 * We fetch the messages first, then batch-fetch context names by type.
 *
 * Usage:
 *   const hits = await searchMessages('doanh thu', { limit: 30 })
 *   const local = await searchMessages('hôm nay', { contextId: chId, limit: 50 })
 */
import { supabase } from './supabase'

export interface SearchHit {
  id:            string
  content:       string | null
  context_id:    string
  context_type:  'channel' | 'project' | string
  author_id:     string | null
  author_name:   string | null
  channel_name:  string | null    // for channel context
  project_title: string | null    // for project context
  message_type:  string | null
  created_at:    string
}

export interface SearchOpts {
  /** Optional context_id filter — limits to one channel/project thread. */
  contextId?: string
  /** Default 30 hits. */
  limit?: number
}

export async function searchMessages(query: string, opts: SearchOpts = {}): Promise<SearchHit[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const limit = opts.limit ?? 30

  // ilike pattern — escape % and _ in the user's term so they're literal.
  const safe = trimmed.replace(/[%_]/g, m => `\\${m}`)
  const pattern = `%${safe}%`

  let q = supabase
    .from('chat_messages')
    .select('id, content, context_id, context_type, author_id, message_type, created_at, author:profiles!author_id(full_name)')
    .ilike('content', pattern)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (opts.contextId) q = q.eq('context_id', opts.contextId)

  const { data: rows, error } = await q
  if (error) {
    console.warn('[searchMessages]', error.message)
    return []
  }
  if (!rows?.length) return []

  // Batch-fetch context names by type (RLS may exclude some — graceful fallback)
  const channelIds = Array.from(new Set(rows.filter((r: any) => r.context_type === 'channel').map((r: any) => r.context_id)))
  const projectIds = Array.from(new Set(rows.filter((r: any) => r.context_type === 'project').map((r: any) => r.context_id)))

  const chMap = new Map<string, string>()
  const projMap = new Map<string, string>()

  if (channelIds.length) {
    const { data: chs } = await supabase
      .from('chat_channels')
      .select('id, name, channel_type, dm_partner_id, owner_id')
      .in('id', channelIds)
    for (const ch of chs ?? []) {
      // For DM channels, the "name" is more useful as the partner's full name —
      // but we don't have profile context here. Fall back to literal name; the
      // search-result UI can re-resolve via membersById.
      chMap.set((ch as any).id, (ch as any).name ?? '')
    }
  }
  if (projectIds.length) {
    const { data: ps } = await supabase
      .from('projects')
      .select('id, title')
      .in('id', projectIds)
    for (const p of ps ?? []) projMap.set((p as any).id, (p as any).title ?? '')
  }

  return rows.map((r: any) => ({
    id:            r.id,
    content:       r.content,
    context_id:    r.context_id,
    context_type:  r.context_type,
    author_id:     r.author_id,
    author_name:   r.author?.full_name ?? null,
    channel_name:  r.context_type === 'channel' ? (chMap.get(r.context_id) ?? null) : null,
    project_title: r.context_type === 'project' ? (projMap.get(r.context_id) ?? null) : null,
    message_type:  r.message_type,
    created_at:    r.created_at,
  }))
}

/** Highlight matched substring in a content snippet. Returns array of
 *  segments alternating between match=false and match=true — caller renders
 *  match segments in <mark>. Case-insensitive. */
export function highlightMatch(content: string, query: string): Array<{ text: string; match: boolean }> {
  const trimmed = query.trim()
  if (!trimmed || !content) return [{ text: content, match: false }]
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  const parts = content.split(re)
  return parts.map((p, i) => ({ text: p, match: i % 2 === 1 }))
}
