import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Download } from 'lucide-react'
import Modal from '../ui/Modal'
import { SkeletonList } from '../ui/Skeleton'
import RichTextDisplay from '../ui/RichTextDisplay'
import { supabase } from '../../lib/supabase'
import type { FormSubmission } from '../../types'

function avatarInitials(name: string) {
  return name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
}

interface Props {
  templateId?: string  // filter by template
}

export default function SubmissionsViewer({ templateId }: Props) {
  const [selected, setSelected] = useState<FormSubmission | null>(null)

  const { data: submissions = [], isLoading } = useQuery({
    queryKey: ['submissions', templateId],
    queryFn: async () => {
      let q = supabase
        .from('form_submissions')
        .select('*, submitter:profiles(full_name)')
        .order('submitted_at', { ascending: false })
      if (templateId) q = q.eq('template_id', templateId)
      const { data, error } = await q
      if (error) throw error
      return data as FormSubmission[]
    },
  })

  function exportCsv() {
    if (!submissions.length) return
    const allKeys = [...new Set(submissions.flatMap(s => Object.keys(s.data).filter(k => k !== '__comments')))]
    const header  = ['Người gửi', 'Template', 'Ngày gửi', ...allKeys]
    const rows    = submissions.map(s => [
      (s as any).submitter?.full_name ?? '-',
      s.template_name,
      new Date(s.submitted_at).toLocaleString('vi'),
      ...allKeys.map(k => {
        const v = s.data[k]
        return Array.isArray(v) ? v.join('; ') : String(v ?? '')
      }),
    ])
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `submissions-${templateId ?? 'all'}.csv`
    a.click()
  }

  if (isLoading) return <SkeletonList count={4} />

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-neutral-500">{submissions.length} submissions</span>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 border border-neutral-200 rounded-lg px-2.5 py-1"
        >
          <Download size={12} /> Export CSV
        </button>
      </div>

      {submissions.length === 0 ? (
        <p className="text-sm text-neutral-400">Chưa có submission nào.</p>
      ) : (
        <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
          {submissions.map(s => (
            <div
              key={s.id}
              onClick={() => setSelected(s)}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-neutral-25 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-semibold shrink-0">
                {avatarInitials((s as any).submitter?.full_name ?? '?')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-800 truncate">
                  {(s as any).submitter?.full_name ?? 'Unknown'}
                </p>
                <p className="text-[11px] text-neutral-400 truncate">
                  {s.template_name} · {formatDistanceToNow(new Date(s.submitted_at), { addSuffix: true, locale: vi })}
                </p>
              </div>
              <span className="text-xs text-primary-600 hover:underline">Xem</span>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.template_name ?? ''}
        size="lg"
      >
        {selected && (
          <div className="space-y-3">
            <p className="text-xs text-neutral-400">
              Gửi bởi <strong>{(selected as any).submitter?.full_name}</strong> ·{' '}
              {new Date(selected.submitted_at).toLocaleString('vi')}
            </p>
            <div className="divide-y divide-neutral-100 border border-neutral-100 rounded-lg">
              {(selected.template_snapshot as any[]).map((f: any) => {
                const val = selected.data[f.id]
                if (val === null || val === undefined || val === '') return null
                const display = Array.isArray(val) ? val.join(', ') : String(val)
                const comment = (selected.data as any).__comments?.[f.id] as { text?: string; attachments?: string[] } | undefined
                return (
                  <div key={f.id} className="px-4 py-2.5 space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-0.5">{f.label}</p>
                    <p className="text-sm text-neutral-800">{display}</p>
                    {(comment?.text || (comment?.attachments?.length ?? 0) > 0) && (
                      <div className="bg-neutral-25 border border-neutral-100 rounded-md p-2 mt-1 space-y-1.5">
                        {comment?.text && (
                          <RichTextDisplay content={comment.text} className="text-xs text-neutral-600" />
                        )}
                        {(comment?.attachments ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {comment!.attachments!.map(url => (
                              /^.*\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(url) ? (
                                <a key={url} href={url} target="_blank" rel="noreferrer">
                                  <img src={url} alt="" className="w-16 h-16 object-cover rounded-md border border-neutral-200" />
                                </a>
                              ) : (
                                <a key={url} href={url} target="_blank" rel="noreferrer" className="text-xs text-primary-600 hover:underline break-all">
                                  {url.split('/').pop()}
                                </a>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
