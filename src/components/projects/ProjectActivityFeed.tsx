/**
 * ProjectActivityFeed — chronological list of project-related events.
 *
 * RSS-style: each row is a single readable sentence ("[who] [đã làm gì] · [time]"),
 * no card chrome — just hairline dividers and a tiny coloured dot to hint kind.
 *
 * Used in two places:
 *  - Projects page: a column showing the global feed across all projects.
 *  - ProjectDetailPage right pane: scoped to one project.
 *
 * Each row routes per kind:
 *  - chat_message / file_upload → /chat?ctx_type=project&ctx_id=...&msg_id=...
 *  - workflow_* → opens WorkflowRunPanel via openPanel()
 *  - form_submission → opens SubmissionView panel
 *  - project_status_changed / project_created → navigates to project detail
 */
import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useProjectActivityFeed } from '../../lib/useProjectActivityFeed'
import { openPanel } from '../../lib/sidePanelStore'
import type { ProjectActivityEntry, ProjectActivityKind } from '../../types'

interface Props {
  /** When null/undefined, shows the global feed (all projects). */
  projectId?: string | null
  /** Default 30. */
  limit?: number
  className?: string
  /** When true, omit the project code/title prefix on each row (used in detail page). */
  hideProjectLabel?: boolean
}

/** Tiny colour dot per kind — replaces icon boxes for cleaner read-out. */
const KIND_DOT: Record<ProjectActivityKind, string> = {
  workflow_started:        'bg-primary-500',
  workflow_completed:      'bg-green-500',
  workflow_cancelled:      'bg-neutral-400',
  approval_pending:        'bg-amber-500',
  chat_message:            'bg-neutral-300',
  file_upload:             'bg-neutral-300',
  form_submission:         'bg-primary-400',
  project_status_changed:  'bg-neutral-400',
  project_created:         'bg-green-400',
}

/**
 * Round-7b: simplified to verb-only labels — no message body, no form name,
 * no rich-text payload. The activity feed is a quick log; users click into
 * the source to see details.
 *
 * Rationale: the old long-form lines (e.g. `phamvietdung@gmail.com đã nhắn:
 * "<span style=\"background-color: rgb(254, 243, 199);\"><b>ádasd</b></span>"`)
 * surfaced raw HTML payloads because the chat-message summary embeds the
 * unsanitised message content. Easier + cleaner to drop the body entirely.
 */
function readableLine(it: ProjectActivityEntry): string {
  const who = (it.user_name?.trim() || 'Hệ thống').split('@')[0]
  switch (it.kind) {
    case 'chat_message':           return `${who} đã gửi tin nhắn`
    case 'file_upload':             return `${who} đã đính kèm file`
    case 'form_submission':         return `${who} đã nộp form`
    case 'workflow_started':        return `${who} đã chạy nghiệp vụ`
    case 'workflow_completed':      return 'Hoàn thành nghiệp vụ'
    case 'workflow_cancelled':      return 'Đã huỷ nghiệp vụ'
    case 'project_created':         return `${who} đã tạo dự án`
    case 'project_status_changed':  return `${who} đã đổi trạng thái`
    case 'approval_pending':        return `${who} đang chờ duyệt`
    default:                        return it.summary ?? ''
  }
}

export default memo(function ProjectActivityFeed({
  projectId = null, limit = 30, className = '', hideProjectLabel = false,
}: Props) {
  const { data: items = [], isLoading } = useProjectActivityFeed(projectId, limit)
  const navigate = useNavigate()

  function handleClick(item: ProjectActivityEntry) {
    if (item.target_chat_message_id) {
      navigate(
        `/chat?ctx_type=project&ctx_id=${item.project_id}` +
        `&ctx_name=${encodeURIComponent(item.project_title)}` +
        `&msg_id=${item.target_chat_message_id}`,
      )
      return
    }
    if (item.target_workflow_run_id) {
      openPanel({
        id: item.target_workflow_run_id,
        kind: 'workflow_run',
        title: item.summary,
        meta: { context_type: 'project', context_id: item.project_id },
      })
      navigate(`/projects/${item.project_id}`)
      return
    }
    if (item.target_form_submission_id) {
      openPanel({
        id: item.target_form_submission_id,
        kind: 'submission_view',
        title: item.summary,
      })
      navigate(`/projects/${item.project_id}`)
      return
    }
    navigate(`/projects/${item.project_id}`)
  }

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="px-1 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          {projectId ? 'Hoạt động dự án' : 'Hoạt động gần đây'}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="px-1 py-3 text-[11px] text-neutral-400">Đang tải…</p>
        )}
        {!isLoading && items.length === 0 && (
          <p className="px-1 py-3 text-[11px] text-neutral-400">Chưa có hoạt động.</p>
        )}
        <ul className="divide-y divide-neutral-100/70">
          {items.map((it, i) => {
            const dot  = KIND_DOT[it.kind] ?? 'bg-neutral-300'
            const time = formatDistanceToNow(new Date(it.created_at), { addSuffix: true, locale: vi })
            const line = readableLine(it)
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => handleClick(it)}
                  className="w-full text-left py-2 px-1 hover:bg-neutral-50/70 transition-colors"
                >
                  <div className="flex items-baseline gap-2">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dot}`} />
                    <p className="flex-1 text-[12px] leading-snug text-neutral-700">
                      {line}
                    </p>
                  </div>
                  <p className="pl-3.5 text-[10px] text-neutral-400 mt-0.5">
                    {time}
                    {!hideProjectLabel && it.project_title && (
                      <>
                        <span className="mx-1">·</span>
                        {it.project_code && (
                          <span className="font-mono text-neutral-500">{it.project_code} </span>
                        )}
                        <span>{it.project_title}</span>
                      </>
                    )}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
})
