import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { openPanel } from '../lib/sidePanelStore'

/**
 * Redirect legacy /workflows/runs/:runId URLs to the /workflows page
 * and open the run inside WorkflowRunPanel (which has full approval logic).
 */
export default function WorkflowRunPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (!runId) return
    openPanel({ id: runId, kind: 'workflow_run', title: '▶ Nghiệp vụ' })
    navigate('/workflows', { replace: true })
  }, [runId, navigate])

  return null
}
