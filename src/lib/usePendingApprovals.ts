import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from '../contexts/AuthContext'

export function usePendingApprovalCount() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['pending-approvals-count', user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('workflow_step_results')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'pending')
      if (error) {
        console.warn('[usePendingApprovals]', error.message)
        return 0
      }
      return count ?? 0
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
    retry: false,
  })
}
