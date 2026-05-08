import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FileText, Image as ImageIcon, FileSpreadsheet, FileArchive, Music, Video, Eye, Download,
  ClipboardList, GitBranch, MessageSquare, Loader2, Folder,
} from 'lucide-react'
import { SkeletonList } from '../ui/Skeleton'
import { useToast } from '../ui/Toast'
import FilePreviewModal from './FilePreviewModal'
import FormSubmissionDetailModal from './FormSubmissionDetailModal'
import { supabase } from '../../lib/supabase'
import {
  getFileKind, canPreview, fileKindLabel, formatBytes, downloadFile, type FileKind,
} from '../../lib/fileKind'
import type { ChatAttachment, FormSubmission, ChatMessage, Document } from '../../types'

interface Props {
  projectId: string
}

type AttachmentRow = ChatAttachment & {
  message?: {
    id: string
    created_at: string
    author?: { id: string; full_name: string } | null
  } | null
}

type SubmissionRow = Omit<FormSubmission, 'submitter'> & {
  submitter?: { id: string; full_name: string } | null
}

interface OriginRecord {
  kind: 'chat' | 'workflow_step' | 'standalone'
  label: string
}

export default function ProjectFilesTab({ projectId }: Props) {
  const [previewFile, setPreviewFile] = useState<{ name: string; url: string; mime?: string | null } | null>(null)
  const [openSubmission, setOpenSubmission] = useState<SubmissionRow | null>(null)
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null)
  const { error: toastError } = useToast()

  // Attachments: chat messages in this project, plus their attachments.
  const { data: attachments = [], isLoading: attLoading } = useQuery({
    queryKey: ['project-attachments', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_attachments')
        .select(`
          *,
          message:chat_messages!inner(
            id, created_at, context_type, context_id,
            author:profiles!author_id(id, full_name)
          )
        `)
        .eq('message.context_type', 'project')
        .eq('message.context_id', projectId)
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as AttachmentRow[]
    },
  })

  // Documents linked to this project.
  const { data: documents = [], isLoading: docsLoading } = useQuery({
    queryKey: ['project-documents', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*, uploader:profiles!uploaded_by(id, full_name)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Document[]
    },
  })

  // Form submissions for this project.
  const { data: submissions = [], isLoading: subLoading } = useQuery({
    queryKey: ['project-submissions', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('form_submissions')
        .select('*, submitter:profiles!submitted_by(id, full_name)')
        .eq('context_type', 'project')
        .eq('context_id', projectId)
        .order('submitted_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as SubmissionRow[]
    },
  })

  // Origin lookup: for each submission, where did it come from?
  const submissionIds = submissions.map(s => s.id)
  const { data: stepOrigins = [] } = useQuery({
    queryKey: ['submission-step-origins', submissionIds.sort().join(',')],
    queryFn: async () => {
      if (submissionIds.length === 0) return []
      const { data, error } = await supabase
        .from('workflow_step_results')
        .select(`
          form_submission_id,
          step:workflow_steps!step_id(title),
          run:workflow_runs!run_id(template_name)
        `)
        .in('form_submission_id', submissionIds)
      if (error) throw error
      // Embedded relations come back as arrays from PostgREST; normalise.
      return (data ?? []).map((r: any) => ({
        form_submission_id: r.form_submission_id as string,
        step: Array.isArray(r.step) ? (r.step[0] ?? null) : r.step,
        run:  Array.isArray(r.run)  ? (r.run[0]  ?? null) : r.run,
      })) as Array<{
        form_submission_id: string
        step: { title: string } | null
        run:  { template_name: string } | null
      }>
    },
    enabled: submissionIds.length > 0,
  })

  const { data: chatOrigins = [] } = useQuery({
    queryKey: ['submission-chat-origins', submissionIds.sort().join(',')],
    queryFn: async () => {
      if (submissionIds.length === 0) return []
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, form_submission_id, context_type')
        .in('form_submission_id', submissionIds)
      if (error) throw error
      return (data ?? []) as Pick<ChatMessage, 'id' | 'form_submission_id' | 'context_type'>[]
    },
    enabled: submissionIds.length > 0,
  })

  const originMap: Record<string, OriginRecord> = useMemo(() => {
    const map: Record<string, OriginRecord> = {}
    for (const so of stepOrigins) {
      if (!so.form_submission_id) continue
      const stepTitle = so.step?.title ?? '(bước)'
      const runName   = so.run?.template_name ?? '(nghiệp vụ)'
      map[so.form_submission_id] = {
        kind: 'workflow_step',
        label: `Nghiệp vụ "${runName}" — bước "${stepTitle}"`,
      }
    }
    for (const co of chatOrigins) {
      if (!co.form_submission_id || map[co.form_submission_id]) continue
      map[co.form_submission_id] = {
        kind: 'chat',
        label: 'Chat thread của dự án',
      }
    }
    return map
  }, [stepOrigins, chatOrigins])

  async function handleDownload(url: string, filename: string) {
    setDownloadingUrl(url)
    try {
      await downloadFile(url, filename)
    } catch (err: any) {
      toastError(err?.message ?? 'Không thể tải file')
    } finally {
      setDownloadingUrl(null)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {/* Files section */}
      <section>
        <header className="flex items-center gap-2 mb-3">
          <FileText size={14} className="text-primary-600" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">File đính kèm</h3>
          <span className="text-[11px] text-neutral-400">({attachments.length})</span>
        </header>

        {attLoading ? (
          <SkeletonList count={3} />
        ) : attachments.length === 0 ? (
          <p className="text-sm text-neutral-400 italic">Chưa có file đính kèm nào trong project này.</p>
        ) : (
          <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
            {attachments.map(att => {
              const kind = getFileKind(att.file_name, att.file_type)
              const downloading = downloadingUrl === att.file_url
              return (
                <div key={att.id} className="flex items-center gap-3 px-3 sm:px-4 py-2.5">
                  <KindIcon kind={kind} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-800 truncate">{att.file_name}</p>
                    <p className="text-[11px] text-neutral-400 truncate">
                      <span className="bg-neutral-100 rounded px-1 py-0.5 mr-1.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
                        {fileKindLabel(kind)}
                      </span>
                      {att.message?.author?.full_name ?? '—'}
                      {att.file_size != null && <> · {formatBytes(att.file_size)}</>}
                      {' · '}{new Date(att.uploaded_at).toLocaleString('vi')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canPreview(kind) && (
                      <button
                        onClick={() => setPreviewFile({ name: att.file_name, url: att.file_url, mime: att.file_type })}
                        className="text-neutral-400 hover:text-primary-600 p-1.5 rounded-lg hover:bg-neutral-50"
                        title="Preview"
                      >
                        <Eye size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => handleDownload(att.file_url, att.file_name)}
                      disabled={downloading}
                      className="text-neutral-400 hover:text-primary-600 p-1.5 rounded-lg hover:bg-neutral-50 disabled:opacity-50"
                      title="Tải xuống"
                    >
                      {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Documents section (project-scoped from Document Library) */}
      <section>
        <header className="flex items-center gap-2 mb-3">
          <Folder size={14} className="text-amber-600" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Document Library</h3>
          <span className="text-[11px] text-neutral-400">({documents.length})</span>
        </header>

        {docsLoading ? (
          <SkeletonList count={2} />
        ) : documents.length === 0 ? (
          <p className="text-sm text-neutral-400 italic">
            Chưa có document nào gắn với project này. Upload qua{' '}
            <span className="text-primary-600">Cài đặt → Lab → Document</span> và chọn project khi upload.
          </p>
        ) : (
          <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
            {documents.map(doc => {
              const kind = getFileKind(doc.file_name, doc.file_type)
              const downloading = downloadingUrl === doc.file_url
              return (
                <div key={doc.id} className="flex items-center gap-3 px-3 sm:px-4 py-2.5">
                  <KindIcon kind={kind} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-800 truncate">{doc.name}</p>
                    <p className="text-[11px] text-neutral-400 truncate">
                      <span className="bg-neutral-100 rounded px-1 py-0.5 mr-1.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
                        {fileKindLabel(kind)}
                      </span>
                      <span className="font-mono text-neutral-300">{doc.folder_path}</span>
                      {' · '}
                      {doc.uploader?.full_name ?? '—'}
                      {doc.file_size != null && <> · {formatBytes(doc.file_size)}</>}
                      {' · '}{new Date(doc.created_at).toLocaleString('vi')}
                    </p>
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {doc.tags.map(t => (
                          <span key={t} className="text-[10px] bg-neutral-100 text-neutral-600 rounded-full px-1.5 py-0.5">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canPreview(kind) && (
                      <button
                        onClick={() => setPreviewFile({ name: doc.file_name, url: doc.file_url, mime: doc.file_type })}
                        className="text-neutral-400 hover:text-primary-600 p-1.5 rounded-lg hover:bg-neutral-50"
                        title="Preview"
                      >
                        <Eye size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => handleDownload(doc.file_url, doc.file_name)}
                      disabled={downloading}
                      className="text-neutral-400 hover:text-primary-600 p-1.5 rounded-lg hover:bg-neutral-50 disabled:opacity-50"
                      title="Tải xuống"
                    >
                      {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Submissions section */}
      <section>
        <header className="flex items-center gap-2 mb-3">
          <ClipboardList size={14} className="text-violet-600" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Form đã gửi</h3>
          <span className="text-[11px] text-neutral-400">({submissions.length})</span>
        </header>

        {subLoading ? (
          <SkeletonList count={3} />
        ) : submissions.length === 0 ? (
          <p className="text-sm text-neutral-400 italic">Chưa có form submission nào trong project này.</p>
        ) : (
          <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
            {submissions.map(s => {
              const origin = originMap[s.id]
              return (
                <button
                  key={s.id}
                  onClick={() => setOpenSubmission(s)}
                  className="w-full text-left flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-neutral-25 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                    <ClipboardList size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-800 truncate">{s.template_name}</p>
                    <div className="text-[11px] text-neutral-400 truncate flex items-center gap-1.5 flex-wrap">
                      {origin && (
                        <span className="inline-flex items-center gap-1 bg-neutral-100 rounded px-1.5 py-0.5">
                          {origin.kind === 'workflow_step'
                            ? <GitBranch size={9} />
                            : <MessageSquare size={9} />}
                          {origin.label}
                        </span>
                      )}
                      <span>{s.submitter?.full_name ?? '—'}</span>
                      <span>·</span>
                      <span>{new Date(s.submitted_at).toLocaleString('vi')}</span>
                    </div>
                  </div>
                  <Eye size={14} className="text-neutral-300 shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Modals */}
      {previewFile && (
        <FilePreviewModal
          open={!!previewFile}
          onClose={() => setPreviewFile(null)}
          fileName={previewFile.name}
          fileUrl={previewFile.url}
          fileMime={previewFile.mime}
        />
      )}

      <FormSubmissionDetailModal
        open={!!openSubmission}
        onClose={() => setOpenSubmission(null)}
        submission={openSubmission as FormSubmission | null}
        origin={openSubmission ? (originMap[openSubmission.id] ?? { kind: 'standalone', label: 'Standalone' }) : null}
        submitterName={openSubmission?.submitter?.full_name ?? undefined}
      />
    </div>
  )
}

function KindIcon({ kind }: { kind: FileKind }) {
  const cls = 'w-9 h-9 rounded-lg flex items-center justify-center shrink-0'
  switch (kind) {
    case 'image':
      return <div className={`${cls} bg-amber-50 text-amber-600`}><ImageIcon size={15} /></div>
    case 'video':
      return <div className={`${cls} bg-rose-50 text-rose-600`}><Video size={15} /></div>
    case 'audio':
      return <div className={`${cls} bg-violet-50 text-violet-600`}><Music size={15} /></div>
    case 'pdf':
      return <div className={`${cls} bg-red-50 text-red-600`}><FileText size={15} /></div>
    case 'docx':
      return <div className={`${cls} bg-primary-50 text-primary-600`}><FileText size={15} /></div>
    case 'xlsx':
    case 'csv':
      return <div className={`${cls} bg-green-50 text-green-600`}><FileSpreadsheet size={15} /></div>
    case 'pptx':
      return <div className={`${cls} bg-orange-50 text-orange-600`}><FileText size={15} /></div>
    case 'archive':
      return <div className={`${cls} bg-neutral-100 text-neutral-600`}><FileArchive size={15} /></div>
    default:
      return <div className={`${cls} bg-neutral-100 text-neutral-500`}><FileText size={15} /></div>
  }
}
