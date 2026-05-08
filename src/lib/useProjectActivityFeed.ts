/**
 * useProjectActivityFeed — wraps the get_project_activity_feed RPC.
 *
 * Pass `null` for projectId to get a global feed (all projects). Pass a
 * specific id to scope to one project. Limit defaults to 30.
 *
 * Gracefully returns an empty array if the migration hasn't run yet
 * (matches the project-wide pattern from gotcha #17).
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { ProjectActivityEntry } from '../types'

export function useProjectActivityFeed(projectId: string | null = null, limit: number = 30) {
  return useQuery({
    queryKey: ['project-activity-feed', projectId, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_project_activity_feed', {
        p_project_id: projectId,
        p_limit: limit,
      })
      if (error) {
        console.warn('[activity feed] RPC failed (migration pending?):', error.message)
        return [] as ProjectActivityEntry[]
      }
      return (data ?? []) as ProjectActivityEntry[]
    },
    retry: false,
    refetchInterval: 60_000,  // 1 min — feed updates from many sources
  })
}
