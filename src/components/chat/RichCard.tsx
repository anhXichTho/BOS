import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { MessageSquare, ChevronRight, Loader2, Bot, CheckSquare, Bell } from 'lucide-react'
import { openPanel } from '../../lib/sidePanelStore'
import { supabase } from '../../lib/supabase'
import type { RichCardPayload, ContextType } from '../../types'

interface Props {
  payload: RichCardPayload
  authorName: string
  createdAt: string
  contextType?: ContextType
  contextId?: string
}

function relTime(ts: string) {
  return formatDistanceToNow(new Date(ts), { addSuffix: true, locale: vi })
}

export default function RichCard({ payload, authorName, createdAt, contextType, contextId }: Props) {
  function openSubmission(submissionId: string, templateName: string) {
    openPanel({ id: submissionId, kind: 'submission_view', title: templateName })
  }

  function openWorkflowRun(runId: string, templateName: string) {
    openPanel({
      id: runId,
      kind: 'workflow_run',
      title: `▶ ${templateName}`,
      meta: contextType && contextId ? { context_type: contextType, context_id: contextId } : undefined,
    })
  }

  if (payload.kind === 'form_submission_link') {
    return (
      <FormSubmissionLinkCard
        payload={payload}
        authorName={authorName}
        createdAt={createdAt}
        onOpen={() => openSubmission(payload.submission_id, payload.template_name)}
      />
    )
  }

  if (payload.kind === 'workflow_run_link') {
    return (
      <WorkflowRunLinkCard
        payload={payload}
        authorName={authorName}
        createdAt={createdAt}
        onOpen={() => openWorkflowRun(payload.run_id, payload.template_name)}
      />
    )
  }

  if (payload.kind === 'bot_action_summary') {
    return (
      <BotActionCard
        payload={payload}
        authorName={authorName}
        createdAt={createdAt}
      />
    )
  }

  if (payload.kind === 'approval_request') {
    return (
      <ApprovalRequestCard
        payload={payload}
        authorName={authorName}
        createdAt={createdAt}
      />
    )
  }

  if (payload.kind === 'bot_response') {
    return <BotResponseCard payload={payload} createdAt={createdAt} />
  }

  // Round-10 — Quick task card. Click → opens TaskView side panel.
  if (payload.kind === 'quick_task') {
    return <QuickTaskCard payload={payload} createdAt={createdAt} />
  }

  // Round-10 follow-up — Reminder fired card.
  if (payload.kind === 'reminder_card') {
    return <ReminderCard payload={payload} createdAt={createdAt} />
  }

  // Round-7b/3 — sticker payload. Borderless inline image.
  if (payload.kind === 'sticker') {
    return (
      <img
        src={payload.url}
        alt={payload.alt ?? 'sticker'}
        title={payload.alt}
        loading="lazy"
        className="max-w-[180px] max-h-[180px] object-contain"
      />
    )
  }

  return null
}

// ─── form_submission_link ─────────────────────────────────────────────────────

function FormSubmissionLinkCard({
  payload, authorName, createdAt, onOpen,
}: {
  payload: Extract<RichCardPayload, { kind: 'form_submission_link' }>
  authorName: string
  createdAt: string
  onOpen?: () => void
}) {
  const hasSummary = (payload.summary?.length ?? 0) > 0

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="text-left border-l-4 border-primary-400 bg-primary-50/60 p-3 mt-1 max-w-sm w-full transition-opacity hover:opacity-80 disabled:hover:opacity-100 disabled:cursor-default"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-semibold text-primary-700 uppercase tracking-wider truncate">
          📋 {payload.template_name}
        </span>
        <span className="text-[10px] text-neutral-400 shrink-0">{relTime(createdAt)}</span>
      </div>
      <p className="text-[11px] text-neutral-500 mb-1.5">{authorName}</p>
      {hasSummary && (
        <div className="space-y-0.5 border-t border-primary-100 pt-1.5">
          {payload.summary!.map((entry, i) => (
            <div key={i} className="text-xs flex gap-1 flex-wrap">
              <span className="text-neutral-500 font-medium">{entry.label}:</span>
              <span className="text-neutral-700">{entry.value}</span>
            </div>
          ))}
        </div>
      )}
      {onOpen && <p className="text-[10px] text-primary-600 mt-1.5">Xem chi tiết →</p>}
    </button>
  )
}

// ─── workflow_run_link ────────────────────────────────────────────────────────

function WorkflowRunLinkCard({
  payload, authorName, createdAt, onOpen,
}: {
  payload: Extract<RichCardPayload, { kind: 'workflow_run_link' }>
  authorName: string
  createdAt: string
  onOpen?: () => void
}) {
  // Round-9 polish: in-progress = muted orange (Tableau tint #FBEFE0 /
  // border #D78B45) instead of bright amber.
  const statusColor =
    payload.status === 'completed' ? 'border-green-300 bg-green-50' :
    payload.status === 'cancelled' ? 'border-neutral-200 bg-neutral-50' :
    'border-[#D78B45] bg-[#FBEFE0]'

  const statusLabel =
    payload.status === 'completed' ? 'Hoàn thành' :
    payload.status === 'cancelled' ? 'Huỷ' : 'Đang chạy'

  const statusBadge =
    payload.status === 'completed' ? 'bg-green-100 text-green-700' :
    payload.status === 'cancelled' ? 'bg-neutral-100 text-neutral-600' :
    'bg-[#F8E5D2] text-[#8C5022]'

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className={`text-left border-l-4 ${statusColor} p-3 mt-1 max-w-sm w-full transition-opacity hover:opacity-80 disabled:hover:opacity-100 disabled:cursor-default`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
          🔀 Nghiệp vụ
        </span>
        <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${statusBadge}`}>
          {statusLabel}
        </span>
        <span className="text-[10px] text-neutral-400 ml-auto">{relTime(createdAt)}</span>
      </div>
      <p className="text-sm font-medium text-neutral-800 truncate">{payload.template_name}</p>
      <p className="text-[11px] text-neutral-500 mt-0.5">{authorName}</p>
      {onOpen && <p className="text-[10px] text-primary-600 mt-1">Mở run →</p>}
    </button>
  )
}

// ─── bot_action_summary ───────────────────────────────────────────────────────

function BotActionCard({
  payload, authorName, createdAt,
}: {
  payload: Extract<RichCardPayload, { kind: 'bot_action_summary' }>
  authorName: string
  createdAt: string
}) {
  return (
    <div className="text-left border border-neutral-200 bg-white p-3 mt-1 max-w-sm w-full">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{payload.icon ?? '🤖'}</span>
        <span className="text-xs font-semibold text-neutral-700 truncate">{payload.title}</span>
        <span className="text-[10px] text-neutral-400 ml-auto shrink-0">{relTime(createdAt)}</span>
      </div>
      <p className="text-[11px] text-neutral-500">{authorName}</p>
    </div>
  )
}

// ─── approval_request ─────────────────────────────────────────────────────────

// ─── bot_response ─────────────────────────────────────────────────────────────

function BotResponseCard({
  payload, createdAt,
}: {
  payload: Extract<RichCardPayload, { kind: 'bot_response' }>
  createdAt: string
}) {
  return (
    <div className="border border-neutral-200 bg-white p-3 mt-1 max-w-md w-full">
      <div className="flex items-center gap-1.5 mb-2">
        <Bot size={13} className="text-primary-500 shrink-0" />
        <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Bot</span>
        {payload.model && (
          <span className="text-[9px] text-neutral-300 bg-neutral-50 border border-neutral-100 px-1.5 py-0.5 rounded-full font-mono">
            {payload.model}
          </span>
        )}
        <span className="text-[10px] text-neutral-400 ml-auto">{relTime(createdAt)}</span>
      </div>
      <p className="text-[11px] text-neutral-400 italic mb-2 truncate">"{payload.query}"</p>
      <div className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">{payload.reply}</div>
    </div>
  )
}

// ─── approval_request ─────────────────────────────────────────────────────────

function ApprovalRequestCard({
  payload, createdAt,
}: {
  payload: Extract<RichCardPayload, { kind: 'approval_request' }>
  authorName: string
  createdAt: string
}) {
  const navigate = useNavigate()
  const [dmLoading, setDmLoading] = useState(false)

  function openRun() {
    openPanel({ id: payload.run_id, kind: 'workflow_run', title: `▶ ${payload.run_name}` })
  }

  async function openDm() {
    setDmLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_or_create_dm_channel', {
        partner_id: payload.requester_id,
      })
      if (error) throw error
      const channelId = (data as any)?.id ?? data
      navigate(`/chat?dm=${channelId}&dm_name=${encodeURIComponent(payload.requester_name)}`)
    } catch (err) {
      console.error('[ApprovalRequestCard] DM error:', err)
    } finally {
      setDmLoading(false)
    }
  }

  return (
    <div className="border-l-4 border-[#D78B45] bg-[#FBEFE0] p-3 mt-1 max-w-sm w-full space-y-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-[9px] font-semibold uppercase tracking-wider text-[#8C5022] bg-[#F8E5D2] px-1.5 py-0.5 rounded-full">
            ✅ Cần duyệt
          </span>
          <p className="text-sm font-medium text-neutral-800 mt-1 truncate">{payload.run_name}</p>
          <p className="text-[11px] text-neutral-600">Bước: {payload.step_title}</p>
        </div>
        <span className="text-[10px] text-neutral-400 shrink-0">{relTime(createdAt)}</span>
      </div>

      {/* Audit log */}
      <div className="border-t border-[#ECC596] pt-1.5 text-[11px] text-neutral-500 space-y-0.5">
        <p>Yêu cầu bởi: <span className="text-neutral-700 font-medium">{payload.requester_name}</span></p>
        <p>Lúc: {new Date(payload.requested_at).toLocaleString('vi')}</p>
        <p className="text-[#8C5022] font-medium">→ Đến lượt bạn duyệt</p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          onClick={openRun}
          className="flex items-center gap-1 text-[11px] text-primary-600 hover:text-primary-700 font-medium transition-colors"
        >
          Xem chi tiết <ChevronRight size={11} />
        </button>
        <button
          type="button"
          onClick={openDm}
          disabled={dmLoading}
          className="flex items-center gap-1 text-[11px] text-neutral-600 hover:text-neutral-800 border border-neutral-200 px-2 py-0.5 rounded-full transition-colors disabled:opacity-50"
        >
          {dmLoading ? <Loader2 size={10} className="animate-spin" /> : <MessageSquare size={10} />}
          Nhắn tin với {payload.requester_name}
        </button>
      </div>
    </div>
  )
}

// ─── quick_task ───────────────────────────────────────────────────────────────

function QuickTaskCard({
  payload, createdAt,
}: {
  payload: Extract<RichCardPayload, { kind: 'quick_task' }>
  createdAt: string
}) {
  const tone =
    payload.status === 'done'      ? { wrap: 'border-[#7BAA73] bg-[#DEEADB]', pill: 'bg-[#DEEADB] text-[#3D6736]', label: 'Đã xong' } :
    payload.status === 'cancelled' ? { wrap: 'border-neutral-200 bg-neutral-50',  pill: 'bg-neutral-100 text-neutral-600', label: 'Đã huỷ' } :
                                     { wrap: 'border-[#D78B45] bg-[#FBEFE0]',     pill: 'bg-[#F8E5D2] text-[#8C5022]', label: 'Đang làm' }

  function openTask() {
    openPanel({ id: payload.task_id, kind: 'task_view', title: payload.title })
  }

  return (
    <button
      type="button"
      onClick={openTask}
      className={`text-left border-l-4 ${tone.wrap} rounded p-3 mt-1 max-w-sm w-full transition-opacity hover:opacity-80`}
    >
      <div className="flex items-center gap-2 mb-1">
        <CheckSquare size={12} className="text-neutral-500 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
          Việc cần làm
        </span>
        <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${tone.pill}`}>
          {tone.label}
        </span>
        <span className="text-[10px] text-neutral-400 ml-auto">{relTime(createdAt)}</span>
      </div>
      <p className="text-sm font-medium text-neutral-800 break-words">{payload.title}</p>
      <div className="text-[11px] text-neutral-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {payload.assignee_label && <span>Phụ trách: <span className="text-neutral-700">{payload.assignee_label}</span></span>}
        {payload.due_date && <span>Hạn: {new Date(payload.due_date).toLocaleDateString('vi')}</span>}
      </div>
      <p className="text-[11px] text-primary-600 mt-1 hover:underline">Mở chi tiết →</p>
    </button>
  )
}

// ─── reminder_card ────────────────────────────────────────────────────────────

function ReminderCard({
  payload, createdAt,
}: {
  payload: Extract<RichCardPayload, { kind: 'reminder_card' }>
  createdAt: string
}) {
  return (
    <div className="border-l-4 border-[#D78B45] bg-[#FBEFE0] rounded p-3 mt-1 max-w-sm w-full">
      <div className="flex items-center gap-2 mb-1">
        <Bell size={12} className="text-[#8C5022] shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-[#8C5022]">
          Nhắc việc
        </span>
        <span className="text-[10px] text-neutral-400 ml-auto">{relTime(createdAt)}</span>
      </div>
      <p className="text-sm font-medium text-neutral-800 break-words">{payload.title}</p>
      <p className="text-[11px] text-neutral-500 mt-0.5">
        Đặt cho lúc {new Date(payload.fire_at).toLocaleString('vi')}
      </p>
    </div>
  )
}
