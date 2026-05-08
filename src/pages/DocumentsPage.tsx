/**
 * DocumentsPage — Round-10. File-explorer-style hub with folders + notes.
 *
 *  /documents                    → root list
 *  /documents/<slug>             → folder OR note (looked up by slug among siblings)
 *  /documents/<a>/<b>/<c>        → drill-down via slash-separated slugs
 *
 * Permissions:
 *   - Each node has visibility = private | shared | public.
 *   - The creator always has edit access.
 *   - Folder share cascades to all children unless the child has its own share row.
 *   - Visibility is enforced server-side via doc_node_role_for() (RLS).
 *
 * Scope of v1 (deliberately minimal):
 *   - Create folder / note (rich text via existing RichTextEditor).
 *   - Rename, delete, share modal.
 *   - Navigate by clicks; URL reflects the slug path.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  rectSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Folder, FileText, Trash2, Lock, Globe2, Users as UsersIcon,
  ChevronRight, Save, GripVertical,
} from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import RichTextEditor from '../components/ui/RichTextEditor'
import RichTextDisplay from '../components/ui/RichTextDisplay'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/ui/Toast'
import { slugify } from '../lib/slug'
import type { DocumentNode, DocumentVisibility } from '../types'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const params  = useParams<{ '*': string }>()
  const splat   = params['*'] ?? ''
  const slugPath = splat.split('/').filter(Boolean)
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()

  // Walk the slug path → resolve node ids end-to-end.
  const { data: trail = [] } = useQuery<DocumentNode[]>({
    queryKey: ['document-trail', slugPath.join('/')],
    queryFn: async () => {
      const out: DocumentNode[] = []
      let parentId: string | null = null
      for (const slug of slugPath) {
        let req = supabase.from('document_nodes').select('*').eq('slug', slug)
        req = parentId ? req.eq('parent_id', parentId) : req.is('parent_id', null)
        const { data, error } = await req
        if (error) break
        const match: DocumentNode | undefined = (data as DocumentNode[] | null)?.find(
          (d) => (d.parent_id ?? null) === parentId
        )
        if (!match) break
        out.push(match)
        parentId = match.id
      }
      return out
    },
    enabled: !!user,
  })

  const currentNode = trail[trail.length - 1]    // null when at root
  const currentParentId = currentNode?.id ?? null
  const isViewingNote = currentNode?.type === 'note'

  // List children of the current parent (folder or root).
  // Round-10 follow-up: ordered by sort_order then name so drag-drop reorder
  // persists across reloads. sort_order is global, not per-user.
  const { data: children = [] } = useQuery({
    queryKey: ['document-children', currentParentId ?? 'root'],
    queryFn: async () => {
      let q = supabase
        .from('document_nodes')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      q = currentParentId ? q.eq('parent_id', currentParentId) : q.is('parent_id', null)
      const { data, error } = await q
      if (error) {
        console.warn('[DocumentsPage] children query failed:', error.message)
        return []
      }
      return (data ?? []) as DocumentNode[]
    },
    enabled: !!user && !isViewingNote,
  })

  return (
    <AppShell title="Document">
      <div className="flex h-full">
        {/* Tree breadcrumb + content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Breadcrumb header */}
          <div className="px-4 py-3 shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.04)] flex items-center gap-1 text-sm">
            <button
              onClick={() => navigate('/documents')}
              className={`text-neutral-700 hover:text-primary-700 ${trail.length === 0 ? 'font-semibold' : ''}`}
            >
              📁 Tài liệu
            </button>
            {trail.map((n, i) => (
              <span key={n.id} className="inline-flex items-center gap-1">
                <ChevronRight size={12} className="text-neutral-300" />
                <button
                  onClick={() => navigate(`/documents/${slugPath.slice(0, i + 1).join('/')}`)}
                  className={`hover:text-primary-700 truncate max-w-[180px] ${i === trail.length - 1 ? 'font-semibold text-neutral-800' : 'text-neutral-600'}`}
                >
                  {n.type === 'folder' ? '📁' : '📄'} {n.name}
                </button>
              </span>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {isViewingNote && currentNode
              ? <NoteView node={currentNode} onChanged={() => qc.invalidateQueries({ queryKey: ['document-trail'] })} />
              : <FolderView
                  parentNode={currentNode ?? null}
                  parentId={currentParentId}
                  children={children}
                  onOpen={(node) => {
                    const next = [...slugPath, node.slug].join('/')
                    navigate(`/documents/${next}`)
                  }}
                  onChanged={() => {
                    qc.invalidateQueries({ queryKey: ['document-children', currentParentId ?? 'root'] })
                  }}
                />}
          </div>
        </div>
      </div>
    </AppShell>
  )
}

// ─── Folder view (list + create / share / delete) ────────────────────────────

function FolderView({
  parentId, children, onOpen, onChanged,
}: {
  parentNode: DocumentNode | null
  parentId: string | null
  children: DocumentNode[]
  onOpen: (node: DocumentNode) => void
  onChanged: () => void
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()
  const [showCreate, setShowCreate] = useState<{ type: 'folder' | 'note' } | null>(null)
  const [name, setName] = useState('')
  const [shareTarget, setShareTarget] = useState<DocumentNode | null>(null)

  // Round-10 follow-up: dnd-kit sensors for keyboard + mouse drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Drag-end → reorder locally + persist new sort_order on every affected row.
  // sort_order values are multiples of 10 so future inserts have headroom.
  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = children.findIndex(c => c.id === active.id)
    const newIdx = children.findIndex(c => c.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const reordered = arrayMove(children, oldIdx, newIdx)
    // Optimistic local update
    qc.setQueryData(['document-children', parentId ?? 'root'], reordered)
    // Persist
    try {
      await Promise.all(reordered.map((n, i) =>
        supabase.from('document_nodes')
          .update({ sort_order: (i + 1) * 10, updated_at: new Date().toISOString() })
          .eq('id', n.id)
      ))
      qc.invalidateQueries({ queryKey: ['document-children', parentId ?? 'root'] })
    } catch (e: any) {
      toastError(e?.message ?? 'Không lưu được thứ tự')
      qc.invalidateQueries({ queryKey: ['document-children', parentId ?? 'root'] })
    }
  }

  async function create() {
    if (!user || !name.trim()) return
    const trimmed = name.trim()
    const slug = slugify(trimmed) || trimmed
    const { error } = await supabase.from('document_nodes').insert({
      parent_id:    parentId,
      type:         showCreate!.type,
      name:         trimmed,
      slug,
      content_html: showCreate!.type === 'note' ? '' : null,
      created_by:   user.id,
      visibility:   'private',
    })
    if (error) { toastError(error.message); return }
    success(showCreate!.type === 'folder' ? 'Đã tạo thư mục' : 'Đã tạo ghi chú')
    setShowCreate(null); setName('')
    onChanged()
  }

  async function remove(node: DocumentNode) {
    if (!window.confirm(`Xoá ${node.type === 'folder' ? 'thư mục' : 'ghi chú'} "${node.name}"? ${node.type === 'folder' ? 'Tất cả nội dung bên trong cũng sẽ bị xoá.' : 'Không thể hoàn tác.'}`)) return
    const { error } = await supabase.from('document_nodes').delete().eq('id', node.id)
    if (error) { toastError(error.message); return }
    success('Đã xoá')
    onChanged()
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-neutral-500">
          {children.length === 0 ? 'Chưa có gì trong thư mục này.' : `${children.length} mục`}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => { setShowCreate({ type: 'folder' }); setName('') }}>
            <Folder size={14} /> + Thư mục
          </Button>
          <Button variant="primary" onClick={() => { setShowCreate({ type: 'note' }); setName('') }}>
            <FileText size={14} /> + Ghi chú
          </Button>
        </div>
      </div>

      {/* Grid of children — drag-drop reorder via @dnd-kit. */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={children.map(c => c.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {children.map(node => (
              <SortableNodeRow
                key={node.id}
                node={node}
                onOpen={() => onOpen(node)}
                onShare={() => setShareTarget(node)}
                onRemove={() => remove(node)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Create modal */}
      {showCreate && (
        <Modal
          open
          onClose={() => setShowCreate(null)}
          title={showCreate.type === 'folder' ? 'Thư mục mới' : 'Ghi chú mới'}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setShowCreate(null)}>Huỷ</Button>
              <Button variant="primary" onClick={create} disabled={!name.trim()}>Tạo</Button>
            </>
          }
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={showCreate.type === 'folder' ? 'Tên thư mục' : 'Tên ghi chú'}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) create() }}
            className="w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-100"
          />
        </Modal>
      )}

      {/* Share modal */}
      {shareTarget && (
        <ShareModal
          node={shareTarget}
          onClose={() => setShareTarget(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}

function VisibilityIcon({ visibility }: { visibility: DocumentVisibility }) {
  if (visibility === 'public') return <Globe2 size={11} className="text-emerald-600" aria-label="Mọi người" />
  if (visibility === 'shared') return <UsersIcon size={11} className="text-primary-600" aria-label="Đã chia sẻ" />
  return <Lock size={11} className="text-neutral-400" aria-label="Riêng tư" />
}

// ─── Sortable row (Round-10 follow-up) ───────────────────────────────────────

function SortableNodeRow({
  node, onOpen, onShare, onRemove,
}: {
  node: DocumentNode
  onOpen: () => void
  onShare: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 px-3 py-2 border border-neutral-100 rounded-lg bg-white hover:border-primary-200 hover:shadow-sm transition-all ${isDragging ? 'shadow-lg' : ''}`}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-neutral-300 hover:text-neutral-600 cursor-grab active:cursor-grabbing touch-none shrink-0"
        title="Kéo để sắp xếp"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={14} />
      </button>
      {/* Type icon + label (clickable open) */}
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
      >
        {node.type === 'folder'
          ? <Folder size={16} className="text-amber-500 shrink-0" />
          : <FileText size={16} className="text-primary-500 shrink-0" />
        }
        <span className="truncate text-sm text-neutral-800">{node.name}</span>
      </button>
      <VisibilityIcon visibility={node.visibility} />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onShare() }}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-neutral-400 hover:text-primary-700 p-0.5"
        title="Quyền truy cập"
      >
        <UsersIcon size={12} />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-neutral-400 hover:text-red-600 p-0.5"
        title="Xoá"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

// ─── Note view (display + inline edit) ───────────────────────────────────────

function NoteView({ node, onChanged }: { node: DocumentNode; onChanged: () => void }) {
  const { user } = useAuth()
  const { success, error: toastError } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.content_html ?? '')
  const [name, setName] = useState(node.name)
  const isOwner = node.created_by === user?.id

  useEffect(() => { setDraft(node.content_html ?? ''); setName(node.name) }, [node.id])

  async function save() {
    const { error } = await supabase
      .from('document_nodes')
      .update({ name: name.trim() || node.name, content_html: draft, updated_at: new Date().toISOString() })
      .eq('id', node.id)
    if (error) { toastError(error.message); return }
    success('Đã lưu')
    setEditing(false)
    onChanged()
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-3">
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 text-xl font-medium text-neutral-900 px-2 py-1 border border-neutral-200 rounded focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-100"
          />
        ) : (
          <h1 className="flex-1 text-xl font-medium text-neutral-900 truncate">{node.name}</h1>
        )}
        <VisibilityIcon visibility={node.visibility} />
        {isOwner && !editing && (
          <Button variant="ghost" onClick={() => setEditing(true)}>Sửa</Button>
        )}
        {editing && (
          <>
            <Button variant="ghost" onClick={() => { setEditing(false); setDraft(node.content_html ?? ''); setName(node.name) }}>Huỷ</Button>
            <Button variant="primary" onClick={save}>
              <Save size={14} /> Lưu
            </Button>
          </>
        )}
      </div>

      {editing ? (
        <RichTextEditor value={draft} onChange={setDraft} placeholder="Nội dung ghi chú..." />
      ) : (
        node.content_html
          ? <RichTextDisplay content={node.content_html} className="prose max-w-none text-neutral-800" />
          : <p className="text-sm text-neutral-400 italic">(Chưa có nội dung)</p>
      )}
    </div>
  )
}

// ─── Share modal ─────────────────────────────────────────────────────────────

function ShareModal({
  node, onClose, onChanged,
}: {
  node: DocumentNode
  onClose: () => void
  onChanged: () => void
}) {
  const { success, error: toastError } = useToast()
  const qc = useQueryClient()
  const [vis, setVis] = useState<DocumentVisibility>(node.visibility)
  const [search, setSearch] = useState('')

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles-with-email'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .order('full_name')
      if (error) return []
      return (data ?? []) as { id: string; full_name: string }[]
    },
    staleTime: 300_000,
  })

  const { data: shares = [] } = useQuery({
    queryKey: ['doc-shares', node.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('document_shares')
        .select('user_id, role, granted_at, profile:profiles(full_name)')
        .eq('document_id', node.id)
      return (data ?? []) as any[]
    },
  })

  const sharedSet = new Set(shares.map(s => s.user_id))

  async function setVisibility(next: DocumentVisibility) {
    setVis(next)
    const { error } = await supabase
      .from('document_nodes')
      .update({ visibility: next, updated_at: new Date().toISOString() })
      .eq('id', node.id)
    if (error) toastError(error.message)
    else onChanged()
  }

  async function addShare(userId: string) {
    const { error } = await supabase
      .from('document_shares')
      .insert({ document_id: node.id, user_id: userId, role: 'viewer' })
    if (error) toastError(error.message)
    else { qc.invalidateQueries({ queryKey: ['doc-shares', node.id] }); success('Đã chia sẻ') }
  }

  async function removeShare(userId: string) {
    const { error } = await supabase
      .from('document_shares')
      .delete()
      .eq('document_id', node.id)
      .eq('user_id', userId)
    if (error) toastError(error.message)
    else { qc.invalidateQueries({ queryKey: ['doc-shares', node.id] }); success('Đã thu hồi') }
  }

  const filteredProfiles = search.trim()
    ? profiles.filter(p => p.full_name.toLowerCase().includes(search.toLowerCase()))
    : profiles.slice(0, 10)

  return (
    <Modal
      open
      onClose={onClose}
      title={`Quyền truy cập · ${node.name}`}
      size="md"
      footer={<Button variant="primary" onClick={onClose}>Xong</Button>}
    >
      <div className="space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
            Chế độ
          </p>
          <div className="flex gap-2">
            {([
              { v: 'private', label: 'Riêng tư', icon: <Lock size={12} /> },
              { v: 'shared',  label: 'Chia sẻ',  icon: <UsersIcon size={12} /> },
              { v: 'public',  label: 'Mọi người', icon: <Globe2 size={12} /> },
            ] as const).map(o => (
              <button
                key={o.v}
                onClick={() => setVisibility(o.v)}
                className={`flex-1 px-3 py-2 text-[12px] rounded border transition-colors inline-flex items-center justify-center gap-1.5 ${
                  vis === o.v
                    ? 'border-primary-300 bg-primary-50 text-primary-700 font-semibold'
                    : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                {o.icon} {o.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-400 mt-1.5 italic">
            {vis === 'private' && 'Chỉ bạn có thể truy cập (admin/editor luôn xem được).'}
            {vis === 'shared'  && 'Chỉ những người được thêm bên dưới có thể xem.'}
            {vis === 'public'  && 'Mọi thành viên trong workspace đều xem được.'}
          </p>
        </div>

        {vis === 'shared' && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
              Chia sẻ với
            </p>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo tên..."
              className="w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300 mb-2"
            />
            <div className="border border-neutral-100 rounded max-h-48 overflow-y-auto">
              {filteredProfiles.map(p => {
                const already = sharedSet.has(p.id)
                return (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-50">
                    <span className="flex-1 text-[12px] text-neutral-800 truncate">{p.full_name}</span>
                    {already ? (
                      <button
                        onClick={() => removeShare(p.id)}
                        className="text-[11px] text-red-600 hover:underline"
                      >
                        Thu hồi
                      </button>
                    ) : (
                      <button
                        onClick={() => addShare(p.id)}
                        className="text-[11px] text-primary-600 hover:underline"
                      >
                        + Thêm
                      </button>
                    )}
                  </div>
                )
              })}
              {filteredProfiles.length === 0 && (
                <p className="text-[11px] text-neutral-400 italic px-3 py-2">Không tìm thấy người dùng.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
