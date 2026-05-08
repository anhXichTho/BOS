import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import { buildCardSummary } from '../../lib/buildCardSummary'
import FormFields, { OTHER_MARKER, emptyAnswers, evaluateCondition, validateField } from './FormFields'
import type { Answers } from './FormFields'
import type { FormTemplate, ContextType } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  contextType: ContextType
  contextId: string
  onSubmitted?: (submissionId: string) => void
}

// ─── Main modal ──────────────────────────────────────────────────────────────

export default function FormFillModal({ open, onClose, contextType, contextId, onSubmitted }: Props) {
  const { user } = useAuth()
  const { success, error: toastError } = useToast()
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [answers, setAnswers] = useState<Answers>(emptyAnswers())
  const [errors, setErrors] = useState<Record<string, string>>({})

  const { data: templates = [] } = useQuery({
    queryKey: ['form-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('form_templates')
        .select('*')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data as FormTemplate[]
    },
    enabled: open,
  })

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)

  function reset() {
    setAnswers(emptyAnswers())
    setErrors({})
    setSelectedTemplateId('')
  }

  function handleClose() { reset(); onClose() }

  async function submit() {
    if (!selectedTemplate || !user) return

    // Validate visible fields
    const fieldErrors: Record<string, string> = {}
    for (const f of selectedTemplate.fields) {
      if (!evaluateCondition(f, answers)) continue
      const err = validateField(f, answers)
      if (err) fieldErrors[f.id] = err
    }
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) return

    setSubmitting(true)
    try {
      // Materialize "Khác" values so the submission shows the real text
      const materializedValues: Record<string, unknown> = {}
      for (const f of selectedTemplate.fields) {
        const v = answers.values[f.id]
        const other = answers.other[f.id]
        if ((f.type === 'select' || f.type === 'radio') && v === OTHER_MARKER) {
          materializedValues[f.id] = other ? `Khác: ${other}` : 'Khác'
        } else if (f.type === 'multi_select' && Array.isArray(v)) {
          materializedValues[f.id] = (v as string[]).map(x => x === OTHER_MARKER ? (other ? `Khác: ${other}` : 'Khác') : x)
        } else {
          materializedValues[f.id] = v
        }
      }

      const data: Record<string, unknown> = { ...materializedValues }
      if (Object.keys(answers.comments).length > 0) data.__comments = answers.comments

      const { data: submission, error: subErr } = await supabase
        .from('form_submissions')
        .insert({
          template_id:       selectedTemplate.id,
          template_name:     selectedTemplate.name,
          template_snapshot: selectedTemplate.fields,
          submitted_by:      user.id,
          context_type:      contextType,
          context_id:        contextId,
          data,
        })
        .select()
        .single()
      if (subErr) throw subErr

      // Build the summary for the chat card (uses summary_field_ids configured per template).
      const summary = buildCardSummary(selectedTemplate, materializedValues)

      // Emit a rich_card message (replaces the legacy 'form_submission' type for new submissions).
      // The form_submission_id FK is kept for joins and audit; the payload drives rendering.
      await supabase.from('chat_messages').insert({
        context_type:       contextType,
        context_id:         contextId,
        author_id:          user.id,
        message_type:       'rich_card',
        form_submission_id: submission.id,
        payload: {
          kind:            'form_submission_link',
          submission_id:   submission.id,
          template_name:   selectedTemplate.name,
          ...(summary.length > 0 ? { summary } : {}),
        },
      })

      success(`Đã gửi form "${selectedTemplate.name}"`)
      onSubmitted?.(submission.id)
      reset()
      onClose()
    } catch (err) {
      console.error(err)
      toastError('Không thể gửi form')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Gửi Form"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
          <Button onClick={submit} disabled={!selectedTemplate || submitting}>
            {submitting ? 'Đang gửi…' : 'Gửi'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Template selector */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Chọn template
          </label>
          <div className="relative">
            <select
              value={selectedTemplateId}
              onChange={e => { setSelectedTemplateId(e.target.value); reset() }}
              className="appearance-none border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm font-serif bg-white w-full pr-8"
            >
              <option value="">— Chọn form template —</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          </div>
        </div>

        {/* Dynamic fields */}
        {selectedTemplate && (
          <div className="border-t border-neutral-100 pt-4">
            <FormFields
              template={selectedTemplate}
              answers={answers}
              setAnswers={setAnswers}
              errors={errors}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
