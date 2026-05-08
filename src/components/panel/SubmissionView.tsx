import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import FormFields from '../forms/FormFields'
import type { Answers } from '../forms/FormFields'
import type { FormSubmission } from '../../types'

interface Props {
  submissionId: string
}

/**
 * Read-only form submission viewer — rendered in the SidePanel for
 * message_type='rich_card' / payload.kind='form_submission_link' clicks.
 */
export default function SubmissionView({ submissionId }: Props) {
  const { data: submission, isLoading } = useQuery({
    queryKey: ['submission-view', submissionId],
    queryFn: async (): Promise<FormSubmission | null> => {
      const { data, error } = await supabase
        .from('form_submissions')
        .select('*, submitter:profiles(*)')
        .eq('id', submissionId)
        .maybeSingle()
      if (error) {
        console.warn('[SubmissionView] fetch failed:', error.message)
        return null
      }
      return data as FormSubmission
    },
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-neutral-100 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (!submission) {
    return (
      <div className="p-6 text-center text-sm text-neutral-400">
        Không tìm thấy submission.
      </div>
    )
  }

  // Reconstruct Answers from the flat data object so FormFields renders correctly.
  const answers: Answers = {
    values: submission.data as Record<string, unknown>,
    other: {},
    comments: (submission.data as any).__comments ?? {},
  }

  // Use the snapshot as the template structure for field labels.
  const pseudoTemplate = {
    id: submission.template_id ?? '',
    name: submission.template_name,
    description: null,
    fields: submission.template_snapshot ?? [],
    summary_field_ids: [],
    is_active: true,
    created_by: null,
    created_at: submission.submitted_at,
    updated_at: submission.submitted_at,
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Meta header */}
      <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50 shrink-0">
        <p className="text-[11px] text-neutral-500">
          <span className="font-medium text-neutral-700">{submission.submitter?.full_name ?? '—'}</span>
          {' · '}
          {new Date(submission.submitted_at).toLocaleString('vi')}
        </p>
        {submission.context_type && (
          <p className="text-[10px] text-neutral-400 mt-0.5 capitalize">
            {submission.context_type}
          </p>
        )}
      </div>

      {/* Fields — read only */}
      <div className="flex-1 overflow-y-auto p-4">
        <FormFields
          template={pseudoTemplate}
          answers={answers}
          setAnswers={() => {}} // read-only, no-op
          disabled
        />
        {(!submission.template_snapshot || submission.template_snapshot.length === 0) && (
          <p className="text-sm text-neutral-400 text-center py-8">Không có snapshot cho submission này.</p>
        )}
      </div>
    </div>
  )
}
