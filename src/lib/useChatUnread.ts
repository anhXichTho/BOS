import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from '../contexts/AuthContext'

export const QK_CHAT_UNREAD = 'chat-unread'

// ─── Per-context unread counts ────────────────────────────────────────────────

/**
 * Returns a map of contextId → unreadCount for the provided context IDs.
 * Only contexts with ≥1 unread message appear; absent keys mean 0.
 * Gracefully returns {} when the migration hasn't run yet (gotcha #17).
 */
export function useChatUnread(contextIds: string[]) {
  const { user } = useAuth()
  // Stable key regardless of array ordering
  const sortedKey = contextIds.slice().sort().join(',')

  return useQuery({
    queryKey: [QK_CHAT_UNREAD, 'per-context', sortedKey, user?.id],
    queryFn: async (): Promise<Record<string, number>> => {
      if (!user || contextIds.length === 0) return {}
      const { data, error } = await supabase
        .rpc('get_chat_unread_counts', { p_context_ids: contextIds })
      if (error) {
        console.warn('[useChatUnread] query failed (migration pending?):', error.message)
        return {}
      }
      const map: Record<string, number> = {}
      for (const row of (data ?? []) as { context_id: string; unread_count: number }[]) {
        map[row.context_id] = Number(row.unread_count)
      }
      return map
    },
    enabled: !!user && contextIds.length > 0,
    // Round-9 perf: ease the polling cadence — realtime invalidates on
    // useMarkChatRead success, so this is just a fallback heartbeat.
    staleTime: 90_000,
    refetchInterval: 60_000,
    retry: false,
  })
}

// ─── Total unread (for nav-tab dot) ──────────────────────────────────────────

/**
 * Returns the total unread message count across ALL contexts for the current user.
 * Used by NavTabs to show a dot on the Chat icon without needing to know context IDs.
 * Returns 0 gracefully when the migration hasn't run.
 */
export function useChatTotalUnread() {
  const { user } = useAuth()

  return useQuery({
    queryKey: [QK_CHAT_UNREAD, 'total', user?.id],
    queryFn: async (): Promise<number> => {
      if (!user) return 0
      const { data, error } = await supabase.rpc('get_chat_total_unread')
      if (error) {
        console.warn('[useChatTotalUnread] query failed (migration pending?):', error.message)
        return 0
      }
      return Number(data ?? 0)
    },
    enabled: !!user,
    staleTime: 90_000,
    refetchInterval: 60_000,
    retry: false,
  })
}

// ─── Mark as read ─────────────────────────────────────────────────────────────

/**
 * Upserts last_read_at = now() for the given context, then invalidates
 * all unread-count queries so badges update immediately.
 * Silently degrades if the migration hasn't run.
 */
export function useMarkChatRead() {
  const { user } = useAuth()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      contextId,
      contextType,
    }: {
      contextId: string
      contextType: 'channel' | 'project'
    }) => {
      if (!user) return
      const { error } = await supabase.from('chat_last_read').upsert(
        {
          user_id:      user.id,
          context_type: contextType,
          context_id:   contextId,
          last_read_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,context_id' },
      )
      if (error) console.warn('[useMarkChatRead] upsert failed:', error.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK_CHAT_UNREAD] })
    },
  })
}
