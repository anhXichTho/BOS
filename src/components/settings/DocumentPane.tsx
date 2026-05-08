import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Trash2, Folder, FolderOpen, Upload, Search, Eye, Download, Loader2, ChevronRight,
} from 'lucide-react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import ChipInput from '../ui/ChipInput'
import { SkeletonList } from '../ui/Skeleton'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { slugify } from '../../lib/slug'
import {
  getFileKind, canPreview, fileKindLabel, formatBytes, downloadFile,
} from '../../lib/fileKind'
import FilePreviewModal from '../projects/FilePreviewModal'
import type { Document, Project } from '../../types'

/**
 * Document library — folders + tags + optional project link.
 *
 * Layout: folder tree on the left (collapsible on mobile), file list on the right.
 * Tag filter chips at top. Search across name/description/file_name via FTS.
 */
export default function DocumentPane() {
  const { isAdmin, isEditor, user } = useAuth()
  const canManage = isAdmin || isEditor
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const [folder, setFolder]       = useState('/')
  const [search, setSearch]       = useState('')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [uploadOpen, setUploadOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<{ name: string; url: string; mime: string | null } | null>(null)
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null)

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*, uploader:profiles!uploaded_by(id, full_name), project:projects!project_id(id, title, slug)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Document[]
    },
  })

  // Derive folder tree from docs
  const folderTree = useMemo(() => buildFolderTree(docs.map(d => d.folder_path)), [docs])
  const allTags = useMemo(() => {
    const set = new Set<string>()
    docs.forEach(d => d.tags?.forEach(t => set.add(t)))
    return [...set].sort()
  }, [docs])

  // Filter docs
  const filtered = docs.filter(d => {
    if (folder !== '/' && !d.folder_path.startsWith(folder)) return false
    if (tagFilter.length > 0 && !tagFilter.every(t => d.tags?.includes(t))) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const hay = `${d.name} ${d.description ?? ''} ${d.file_name}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('documents').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] })
      success('Đã xoá document')
    },
    onError: () => toastError('Không thể xoá'),
  })

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
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-neutral-600 mb-0.5">Document Library</p>
          <p className="text-[11px] text-neutral-400">
            Lưu trữ tập trung file/doc/pdf/excel — phân loại bằng folder + tag, có thể link 1 project.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setUploadOpen(true)}>
            <Upload size={13} /> Tải lên
          </Button>
        )}
      </div>

      {/* Search + tag filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-300" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm theo tên / mô tả / file…"
            className="w-full pl-7 pr-3 py-1.5 text-sm border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg bg-white"
          />
        </div>
        {allTags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-neutral-400">Tag:</span>
            {allTags.slice(0, 8).map(t => {
              const active = tagFilter.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter(prev => active ? prev.filter(x => x !== t) : [...prev, t])}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                    active
                      ? 'border-primary-400 bg-primary-50 text-primary-700'
                      : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'
                  }`}
                >
                  {t}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Folder tree + list */}
      <div className="flex gap-3 flex-col md:flex-row">
        {/* Folder tree */}
        <aside className="w-full md:w-48 shrink-0 bg-neutral-25 border border-neutral-100 rounded-lg p-2 max-h-[60vh] overflow-y-auto">
          <FolderTreeNode
            node={folderTree}
            current={folder}
            onSelect={setFolder}
            label="Tất cả"
            path="/"
          />
        </aside>

        {/* File list */}
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <SkeletonList count={4} />
          ) : filtered.length === 0 ? (
            <p className="text-sm text-neutral-400 italic py-6 text-center">
              {docs.length === 0 ? 'Chưa có document nào.' : 'Không có file phù hợp với filter.'}
            </p>
          ) : (
            <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
              {filtered.map(doc => {
                const kind = getFileKind(doc.file_name, doc.file_type)
                const downloading = downloadingUrl === doc.file_url
                return (
                  <div key={doc.id} className="px-3 sm:px-4 py-2.5">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-neutral-800 truncate">{doc.name}</p>
                          <span className="bg-neutral-100 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
                            {fileKindLabel(kind)}
                          </span>
                          {doc.project && (
                            <span className="bg-amber-50 text-amber-700 rounded px-1.5 py-0.5 text-[10px]">
                              📁 {doc.project.title}
                            </span>
                          )}
                        </div>
                        {doc.description && (
                          <p className="text-[11px] text-neutral-500 mt-0.5 truncate">{doc.description}</p>
                        )}
                        <p className="text-[11px] text-neutral-400 mt-0.5 truncate">
                          <span className="font-mono text-neutral-300">{doc.folder_path}</span>
                          {' · '}
                          {doc.uploader?.full_name ?? '—'}
                          {doc.file_size != null && <> · {formatBytes(doc.file_size)}</>}
                          {' · '}{new Date(doc.created_at).toLocaleDateString('vi')}
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
                        {(canManage || doc.uploaded_by === user?.id) && (
                          <button
                            onClick={() => { if (confirm(`Xoá "${doc.name}"?`)) remove.mutate(doc.id) }}
                            className="text-neutral-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-neutral-50"
                            title="Xoá"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        defaultFolder={folder}
      />
      {previewFile && (
        <FilePreviewModal
          open={!!previewFile}
          onClose={() => setPreviewFile(null)}
          fileName={previewFile.name}
          fileUrl={previewFile.url}
          fileMime={previewFile.mime}
        />
      )}
    </div>
  )
}

// ─── Folder tree ──────────────────────────────────────────────────────────────

interface TreeNode {
  name: string
  path: string
  children: Record<string, TreeNode>
  count: number
}

function buildFolderTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '/', children: {}, count: 0 }
  for (const p of paths) {
    root.count++
    const parts = p.split('/').filter(Boolean)
    let cur = root
    let acc = ''
    for (const part of parts) {
      acc += '/' + part
      if (!cur.children[part]) cur.children[part] = { name: part, path: acc, children: {}, count: 0 }
      cur.children[part].count++
      cur = cur.children[part]
    }
  }
  return root
}

function FolderTreeNode({
  node, current, onSelect, label, path, depth = 0,
}: {
  node: TreeNode
  current: string
  onSelect: (path: string) => void
  label?: string
  path: string
  depth?: number
}) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = Object.keys(node.children).length > 0
  const isActive = current === path

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(path)}
        onDoubleClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 w-full px-1.5 py-1 rounded-md text-[12px] text-left transition-colors ${
          isActive ? 'bg-primary-50 text-primary-700 font-medium' : 'text-neutral-700 hover:bg-neutral-100'
        }`}
        style={{ paddingLeft: 4 + depth * 10 }}
      >
        {hasChildren ? (
          <span
            onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
            className="text-neutral-400 -ml-1"
          >
            <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          </span>
        ) : (
          <span className="w-3" />
        )}
        {open && hasChildren
          ? <FolderOpen size={11} className="text-neutral-400" />
          : <Folder size={11} className="text-neutral-400" />}
        <span className="truncate flex-1">{label ?? node.name}</span>
        <span className="text-[10px] text-neutral-400">{node.count}</span>
      </button>
      {open && hasChildren && (
        <div>
          {Object.values(node.children)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(child => (
              <FolderTreeNode
                key={child.path}
                node={child}
                current={current}
                onSelect={onSelect}
                path={child.path}
                depth={depth + 1}
              />
            ))}
        </div>
      )}
    </div>
  )
}

// ─── Upload modal ────────────────────────────────────────────────────────────

function UploadModal({
  open, onClose, defaultFolder,
}: {
  open: boolean
  onClose: () => void
  defaultFolder: string
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const [files, setFiles]           = useState<File[]>([])
  const [name, setName]             = useState('')
  const [description, setDescription] = useState('')
  const [folder, setFolder]         = useState(defaultFolder || '/')
  const [tags, setTags]             = useState<string[]>([])
  const [projectId, setProjectId]   = useState('')
  const [uploading, setUploading]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('id, title, slug').order('title')
      return (data ?? []) as Pick<Project, 'id' | 'title' | 'slug'>[]
    },
    enabled: open,
  })

  function reset() {
    setFiles([]); setName(''); setDescription(''); setFolder(defaultFolder || '/')
    setTags([]); setProjectId(''); setUploading(false)
  }

  function handleClose() { reset(); onClose() }

  async function uploadOne(file: File) {
    const ext  = file.name.split('.').pop() ?? 'bin'
    const safe = slugify(file.name.replace(/\.[^.]+$/, '')) || 'doc'
    const path = `${slugify(folder).replace(/^-+|-+$/g, '') || 'root'}/${Date.now()}-${safe}.${ext}`

    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(path, file, { cacheControl: '3600', upsert: false })
    if (upErr) throw upErr

    const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)

    const { error: insErr } = await supabase.from('documents').insert({
      name:        name || file.name,
      description: description || null,
      file_url:    urlData.publicUrl,
      file_name:   file.name,
      file_type:   file.type,
      file_size:   file.size,
      folder_path: folder.startsWith('/') ? folder : '/' + folder,
      tags,
      project_id:  projectId || null,
      uploaded_by: user?.id,
    })
    if (insErr) throw insErr
  }

  async function handleSubmit() {
    if (files.length === 0) { toastError('Chọn ít nhất 1 file'); return }
    setUploading(true)
    try {
      for (const f of files) await uploadOne(f)
      qc.invalidateQueries({ queryKey: ['documents'] })
      success(`Đã tải lên ${files.length} file`)
      handleClose()
    } catch (err: any) {
      toastError(err?.message ?? 'Không thể tải lên')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Tải lên Document"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
          <Button onClick={handleSubmit} disabled={uploading || files.length === 0}>
            {uploading ? 'Đang tải…' : 'Tải lên'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* File picker */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            File *
          </label>
          <input
            ref={fileRef}
            type="file"
            multiple
            onChange={e => setFiles(Array.from(e.target.files ?? []))}
            className="w-full text-sm border border-neutral-200 rounded-lg p-2 bg-white file:mr-3 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:bg-primary-50 file:text-primary-700"
          />
          {files.length > 0 && (
            <p className="text-[11px] text-neutral-500 mt-1">
              Đã chọn: {files.map(f => f.name).join(', ')}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Tên hiển thị (để trống = dùng tên file)
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={files[0]?.name ?? 'Tên doc'}
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Mô tả ngắn
          </label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Tuỳ chọn"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Folder (vd: /quy-trinh/qa)
          </label>
          <input
            value={folder}
            onChange={e => setFolder(e.target.value)}
            placeholder="/"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full font-mono text-xs"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Tags</label>
          <ChipInput values={tags} onChange={setTags} placeholder="Thêm tag… (Enter)" />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Gắn với dự án (tuỳ chọn)
          </label>
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full"
          >
            <option value="">— Không gắn —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  )
}
