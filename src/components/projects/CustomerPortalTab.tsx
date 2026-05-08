/**
 * CustomerPortalTab — content of the "Cổng KH" tab in ProjectDetailPage.
 *
 * Internal staff view of:
 *  - Customer portal credentials + URL (CustomerPortalCard, extracted)
 *  - Related workflows status — high-level only (no internal step details / chats)
 *  - Internal info cards (rich-text notes by staff, chronological)
 *
 * Privacy: NONE of the info-cards content is exposed to the actual customer
 * portal page — they are staff-only annotations.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Plus, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import Button from '../ui/Button'
import RichTextEditor from '../ui/RichTextEditor'
import RichTextDisplay from '../ui/RichTextDisplay'
import CustomerPortalCard from './CustomerPortalCard'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import type { Project, ProjectInfoCard } from '../../types'

/** Compact run shape — only the fields we display. */
interface RunBrief {
  id: string
  template_name: string
  status: string
  started_at: string
  completed_at: string | null
  runner?: { full_name: string | null } | null
}

interface Props {
  project: Project
}

export default function CustomerPortalTab({ project }: Props) {
  const { user, isAdmin, isEditor } = useAuth()
  const { success, error: toastError } = useToast()
  const qc = useQueryClient()
  const canEdit = isAdmin || isEditor

  // ── Related workflow runs (high-level only) ──
  const { data: runs = [] } = useQuery({
    queryKey: ['portal-tab-runs', project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_runs')
        .select('id, template_name, status, started_at, completed_at, runner:profiles!run_by(full_name)')
        .eq('project_id', project.id)
        .order('started_at', { ascending: false })
        .limit(10)
      if (error) {
        console.warn('[portal tab] runs query failed:', error.message)
        return []
      }
      return (data ?? []) as unknown as RunBrief[]
    },
  })

  // ── Info cards (internal staff notes) ──
  const { data: infoCards = [] } = useQuery({
    queryKey: ['project-info-cards', project.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_info_cards')
        .select('*, author:profiles!author_id(full_name)')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
      if (error) {
        console.warn('[info cards] query failed (migration pending?):', error.message)
        return []
      }
      return data as ProjectInfoCard[]
    },
    retry: false,
  })

  const [composing, setComposing] = useState(false)
  const [draftHtml, setDraftHtml] = useState('')

  const addCard = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Chưa đăng nhập')
      const trimmed = draftHtml.trim()
      if (!trimmed || trimmed === '<p></p>' || trimmed === '<br>') {
        throw new Error('Nội dung không được trống')
      }
      const { error } = await supabase.from('project_info_cards').insert({
        project_id: project.id,
        author_id:  user.id,
        body_html:  draftHtml,
      })
      if (error) throw error
    },
    onSuccess: () => {
      success('Đã thêm ghi chú')
      setComposing(false)
      setDraftHtml('')
      qc.invalidateQueries({ queryKey: ['project-info-cards', project.id] })
    },
    onError: (e: any) => toastError(e?.message ?? 'Không thể lưu'),
  })

  const removeCard = useMutation({
    mutationFn: async (cardId: string) => {
      const { error } = await supabase.from('project_info_cards').delete().eq('id', cardId)
      if (error) throw error
    },
    onSuccess: () => {
      success('Đã xoá')
      qc.invalidateQueries({ queryKey: ['project-info-cards', project.id] })
    },
    onError: () => toastError('Không thể xoá'),
  })

  return (
    <div className="space-y-4">
      {/* Portal credentials card (existing CustomerPortalCard) */}
      <CustomerPortalCard project={project} portalOrigin={window.location.origin} />

      {/* Related workflows — high-level status only */}
      <div className="bg-white border border-neutral-100 rounded-lg p-4 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-3">
          Nghiệp vụ liên quan ({runs.length})
        </p>
        {runs.length === 0 ? (
          <p className="text-xs text-neutral-400 italic">Chưa có nghiệp vụ nào.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {runs.map(run => (
              <li key={run.id} className="py-2 flex items-center gap-2.5">
                <GitBranch size={12} className="text-neutral-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-neutral-700 truncate">{run.template_name}</p>
                  <p className="text-[10px] text-neutral-400">
                    {run.runner?.full_name ?? '—'} · {new Date(run.started_at).toLocaleDateString('vi')}
                  </p>
                </div>
                <RunStatusChip status={run.status} />
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-neutral-400 italic mt-3 pt-3 border-t border-neutral-100">
          Chỉ hiển thị tổng quan — chi tiết nghiệp vụ vẫn ở tab "Nghiệp vụ".
        </p>
      </div>

      {/* Info cards */}
      <div className="bg-white border border-neutral-100 rounded-lg p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Ghi chú nội bộ ({infoCards.length})
          </p>
          {canEdit && !composing && (
            <Button size="sm" variant="secondary" onClick={() => setComposing(true)}>
              <Plus size={11} /> Thêm ghi chú
            </Button>
          )}
        </div>

        {composing && (
          <div className="border border-primary-200 rounded-lg p-2.5 bg-primary-50/30 space-y-2">
            <RichTextEditor
              value={draftHtml}
              onChange={setDraftHtml}
              placeholder="Nội dung ghi chú… (rich text)"
              uploadPrefix={`projects/${project.id}/info-cards`}
              minHeight={80}
              initialMode="rich"
              hideToggle
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="secondary" onClick={() => { setComposing(false); setDraftHtml('') }}>
                Huỷ
              </Button>
              <Button size="sm" onClick={() => addCard.mutate()} disabled={addCard.isPending}>
                {addCard.isPending ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </div>
          </div>
        )}

        {infoCards.length === 0 && !composing && (
          <p className="text-xs text-neutral-400 italic">Chưa có ghi chú.</p>
        )}

        <ul className="space-y-2">
          {infoCards.map(card => {
            const canDelete = canEdit || card.author_id === user?.id
            return (
              <li key={card.id} className="border border-neutral-100 rounded-lg p-3 bg-neutral-25 group relative">
                <div className="flex items-center gap-2 mb-1.5 text-[10px] text-neutral-400">
                  <span className="font-medium text-neutral-600">
                    {card.author?.full_name ?? 'hệ thống'}
                  </span>
                  <span>·</span>
                  <span>{formatDistanceToNow(new Date(card.created_at), { addSuffix: true, locale: vi })}</span>
                </div>
                <RichTextDisplay content={card.body_html} className="text-xs text-neutral-700" />
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => { if (confirm('Xoá ghi chú?')) removeCard.mutate(card.id) }}
                    className="absolute top-2 right-2 text-neutral-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Xoá"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function RunStatusChip({ status }: { status: string }) {
  const cls =
    status === 'completed' ? 'bg-green-50 text-green-700 border-green-200' :
    status === 'cancelled' ? 'bg-neutral-100 text-neutral-500 border-neutral-200' :
    'bg-amber-50 text-amber-700 border-amber-200'
  const label =
    status === 'completed' ? 'Hoàn thành' :
    status === 'cancelled' ? 'Huỷ' :
    'Đang chạy'
  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${cls} shrink-0`}>
      {label}
    </span>
  )
}
