import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, MessageCircleQuestion, Bot, ArrowLeft, Folder, History, ChevronDown, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { Badge } from '../ui/Badge'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import DocumentPane from './DocumentPane'
// FormPane moved into WorkflowsPage as a top-level tab — Round-10.
import type { HelperPanel, HelperType, HelperFaqItem, ChatbotConfig, AiUsageLog } from '../../types'

// Round-10: 'forms' moved out to /workflows page. 'docs' will follow once
// the new /documents tab ships — left in place for now.
type LabSubTab = 'ai' | 'faq' | 'docs'
type AiView   = 'config' | 'log'

// ─── Main tab ────────────────────────────────────────────────────────────────

export default function LabTab() {
  const { isAdmin, isEditor } = useAuth()
  const canManage = isAdmin || isEditor
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const [subTab, setSubTab]     = useState<LabSubTab>('ai')
  const [aiView, setAiView]     = useState<AiView>('config')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing]   = useState<HelperPanel | null>(null)

  const { data: panels = [], isLoading } = useQuery({
    queryKey: ['helper-panels'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('helper_panels')
        .select('*')
        .order('name')
      if (error) throw error
      return data as HelperPanel[]
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('helper_panels').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['helper-panels'] })
      success('Đã xoá module')
    },
    onError: () => toastError('Không thể xoá'),
  })

  if (editing) {
    return <PanelEditor panel={editing} onBack={() => setEditing(null)} />
  }

  // Group by type for the AI / FAQ sub-tabs
  const faqDocs   = panels.filter(p => p.type === 'faq')
  const aiConfigs = panels.filter(p => p.type === 'chatbot')

  const activePanels = subTab === 'ai' ? aiConfigs : subTab === 'faq' ? faqDocs : []
  const isPanelTab   = subTab === 'ai' || subTab === 'faq'

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex overflow-x-auto scrollbar-none border-b border-neutral-100 -mx-1">
        <SubTabButton
          active={subTab === 'ai'}
          onClick={() => setSubTab('ai')}
          icon={<Bot size={13} className="text-violet-600" />}
          label="AI Setting"
          count={aiConfigs.length}
        />
        <SubTabButton
          active={subTab === 'faq'}
          onClick={() => setSubTab('faq')}
          icon={<MessageCircleQuestion size={13} className="text-primary-600" />}
          label="FAQ Setting"
          count={faqDocs.length}
        />
        <SubTabButton
          active={subTab === 'docs'}
          onClick={() => setSubTab('docs')}
          icon={<Folder size={13} className="text-amber-600" />}
          label="Document"
        />
      </div>

      {/* Panel sub-tabs (AI / FAQ) */}
      {isPanelTab && (
        <div className="space-y-3">
          {/* AI sub-view toggle (Config / Log) */}
          {subTab === 'ai' && (
            <div className="flex items-center gap-1 border-b border-neutral-100 pb-2">
              <button
                onClick={() => setAiView('config')}
                className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                  aiView === 'config' ? 'bg-primary-50 text-primary-700' : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                Cấu hình
              </button>
              <button
                onClick={() => setAiView('log')}
                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                  aiView === 'log' ? 'bg-primary-50 text-primary-700' : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <History size={11} />
                Log sử dụng
              </button>
            </div>
          )}

          {/* Log view */}
          {subTab === 'ai' && aiView === 'log' && <AiUsageLogView />}

          {/* Config / panel list view */}
          {(subTab !== 'ai' || aiView === 'config') && (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <p className="text-[12px] text-neutral-500">
                  {subTab === 'ai'
                    ? 'AI Assistants — system prompt + knowledge base + model + API config. Gắn vào bước nghiệp vụ.'
                    : 'FAQ Docs — Q&A list có search nhanh. Gắn vào bước nghiệp vụ để hỗ trợ người chạy checklist.'}
                </p>
                {canManage && (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus size={12} /> {subTab === 'ai' ? 'AI mới' : 'FAQ mới'}
                  </Button>
                )}
              </div>

              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-neutral-100 animate-pulse rounded-lg" />)}
                </div>
              ) : activePanels.length === 0 ? (
                <div className="border border-dashed border-neutral-200 rounded-lg p-8 text-center text-sm text-neutral-400">
                  {subTab === 'ai' ? 'Chưa có AI Assistant nào.' : 'Chưa có FAQ Doc nào.'}
                </div>
              ) : (
                <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
                  {activePanels.map(p => (
                    <PanelRow
                      key={p.id}
                      panel={p}
                      canManage={canManage}
                      onEdit={() => setEditing(p)}
                      onRemove={() => remove.mutate(p.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Document sub-tab */}
      {subTab === 'docs' && <DocumentPane />}

      <CreateHelperModal
        open={creating}
        forceType={subTab === 'ai' ? 'chatbot' : subTab === 'faq' ? 'faq' : null}
        onClose={() => setCreating(false)}
        onCreated={p => { setCreating(false); setEditing(p) }}
      />
    </div>
  )
}

function SubTabButton({
  active, onClick, icon, label, count,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 whitespace-nowrap items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-primary-600 text-primary-700'
          : 'border-transparent text-neutral-500 hover:text-neutral-800'
      }`}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && (
        <span className="text-[10px] text-neutral-400 ml-0.5">({count})</span>
      )}
    </button>
  )
}

// ─── AI Usage Log view ───────────────────────────────────────────────────────

function AiUsageLogView() {
  const { isAdmin, isEditor } = useAuth()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['ai-usage-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_usage_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) {
        console.warn('[AiUsageLogView] query failed (migration pending?):', error.message)
        return []
      }
      return data as AiUsageLog[]
    },
    retry: false,
    refetchInterval: 30_000,
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-neutral-100 animate-pulse rounded" />)}
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="border border-dashed border-neutral-200 rounded-lg p-8 text-center text-sm text-neutral-400">
        Chưa có lịch sử sử dụng nào. Bot cần được gọi ít nhất một lần.
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <p className="text-[11px] text-neutral-400">
        {isAdmin || isEditor ? 'Tất cả lượt gọi bot (100 mới nhất)' : 'Lượt gọi của bạn (100 mới nhất)'}
      </p>
      <div className="bg-white border border-neutral-100 rounded-lg overflow-hidden divide-y divide-neutral-50">
        {logs.map(log => (
          <div key={log.id}>
            <button
              type="button"
              onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
              className="w-full text-left px-4 py-2.5 hover:bg-neutral-50 transition-colors flex items-center gap-3"
            >
              {expandedId === log.id
                ? <ChevronDown size={12} className="text-neutral-400 shrink-0" />
                : <ChevronRight size={12} className="text-neutral-400 shrink-0" />
              }
              <span className="text-[10px] text-neutral-400 shrink-0 w-28 tabular-nums">
                {formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: vi })}
              </span>
              <span className="text-xs font-medium text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full shrink-0">
                {log.bot_name}
              </span>
              {log.model && (
                <span className="text-[10px] text-neutral-400 font-mono shrink-0">{log.model}</span>
              )}
              <span className="text-xs text-neutral-600 truncate flex-1">{log.query}</span>
            </button>
            {expandedId === log.id && (
              <div className="px-4 pb-3 pt-1 space-y-2 bg-neutral-25">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">Câu hỏi</p>
                  <p className="text-sm text-neutral-700 whitespace-pre-wrap">{log.query}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">Trả lời</p>
                  <p className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">{log.reply}</p>
                </div>
                <p className="text-[10px] text-neutral-300">
                  {new Date(log.created_at).toLocaleString('vi')} · {log.context_type}/{log.context_id?.slice(0, 8)}…
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Panel list row ───────────────────────────────────────────────────────────

function PanelRow({
  panel, canManage, onEdit, onRemove,
}: {
  panel: HelperPanel
  canManage: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-neutral-800 truncate">{panel.name}</p>
          <Badge className={panel.type === 'faq' ? 'bg-primary-50 text-primary-700' : 'bg-violet-50 text-violet-700'}>
            {panel.type === 'faq' ? 'FAQ' : 'AI'}
          </Badge>
        </div>
        {panel.description && <p className="text-[11px] text-neutral-400 truncate">{panel.description}</p>}
      </div>
      {canManage && (
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded-lg">
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => { if (confirm(`Xoá "${panel.name}"?`)) onRemove() }}
            className="text-neutral-400 hover:text-red-500 p-1.5 rounded-lg"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Create modal ─────────────────────────────────────────────────────────────

function CreateHelperModal({
  open, onClose, onCreated, forceType,
}: {
  open: boolean
  onClose: () => void
  onCreated: (panel: HelperPanel) => void
  /** When set, type picker is hidden and the new panel is forced to this type. */
  forceType?: HelperType | null
}) {
  const { user } = useAuth()
  const { error: toastError } = useToast()
  const qc = useQueryClient()

  const [type, setType] = useState<HelperType>(forceType ?? 'faq')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() { setType(forceType ?? 'faq'); setName(''); setDescription(''); setSaving(false) }
  function handleClose() { reset(); onClose() }

  async function create() {
    if (!name.trim()) { toastError('Nhập tên helper'); return }
    setSaving(true)
    try {
      const defaultConfig: ChatbotConfig = type === 'chatbot'
        ? { system_prompt: 'Bạn là trợ lý nội bộ. Trả lời ngắn gọn, dùng tiếng Việt.', model: 'claude-haiku-4-5', allow_external: false }
        : {}
      const { data, error } = await supabase
        .from('helper_panels')
        .insert({ type, name: name.trim(), description: description.trim() || null, config: defaultConfig, created_by: user?.id })
        .select()
        .single()
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['helper-panels'] })
      onCreated(data as HelperPanel)
      reset()
    } catch (err: any) {
      toastError(err?.message ?? 'Không thể tạo helper')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={forceType === 'chatbot' ? 'AI Assistant mới' : forceType === 'faq' ? 'FAQ Doc mới' : 'Module mới'}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
          <Button onClick={create} disabled={saving}>{saving ? 'Đang tạo…' : 'Tạo'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {!forceType && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">Loại</p>
            <div className="grid grid-cols-2 gap-2">
              {(['faq', 'chatbot'] as HelperType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`border rounded-lg p-3 text-left transition-colors ${
                    type === t ? 'border-primary-400 bg-primary-50' : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {t === 'faq' ? <MessageCircleQuestion size={14} className="text-primary-600" /> : <Bot size={14} className="text-violet-600" />}
                    <span className="text-sm font-medium text-neutral-800">{t === 'faq' ? 'FAQ List' : 'AI Chatbot'}</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">
                    {t === 'faq' ? 'Danh sách Q&A có search nhanh' : 'Trợ lý AI dùng dữ liệu nội bộ'}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Tên helper *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="VD: FAQ về quy trình QA"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Mô tả</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Tuỳ chọn"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full"
          />
        </div>
      </div>
    </Modal>
  )
}

// ─── Panel editor (FAQ items / chatbot config) ────────────────────────────────

function PanelEditor({ panel, onBack }: { panel: HelperPanel; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-neutral-400 hover:text-neutral-700">
          <ArrowLeft size={16} />
        </button>
        <h2 className="text-base font-serif font-medium text-neutral-800">{panel.name}</h2>
        <Badge className={panel.type === 'faq' ? 'bg-primary-50 text-primary-700' : 'bg-violet-50 text-violet-700'}>
          {panel.type === 'faq' ? 'FAQ' : 'CHATBOT'}
        </Badge>
      </div>

      {panel.type === 'faq'     && <FaqEditor panel={panel} />}
      {panel.type === 'chatbot' && <ChatbotEditor panel={panel} />}
    </div>
  )
}

// ─── FAQ editor ──────────────────────────────────────────────────────────────

function FaqEditor({ panel }: { panel: HelperPanel }) {
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const { data: items = [] } = useQuery({
    queryKey: ['helper-faq', panel.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('helper_faq_items')
        .select('*')
        .eq('panel_id', panel.id)
        .order('order_index')
      if (error) throw error
      return data as HelperFaqItem[]
    },
  })

  const [newQ, setNewQ] = useState('')
  const [newA, setNewA] = useState('')

  const addItem = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('helper_faq_items').insert({
        panel_id:    panel.id,
        question:    newQ.trim(),
        answer:      newA.trim(),
        order_index: items.length,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['helper-faq', panel.id] })
      setNewQ(''); setNewA('')
      success('Đã thêm câu FAQ')
    },
    onError: () => toastError('Không thể thêm'),
  })

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('helper_faq_items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['helper-faq', panel.id] }),
  })

  return (
    <div className="space-y-4">
      {/* Existing items */}
      {items.length === 0 ? (
        <p className="text-sm text-neutral-400">Chưa có FAQ nào.</p>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="bg-white border border-neutral-100 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <p className="text-sm font-medium text-neutral-800 mb-1">{item.question}</p>
                  <p className="text-xs text-neutral-600 whitespace-pre-wrap">{item.answer}</p>
                </div>
                <button
                  onClick={() => { if (confirm('Xoá câu này?')) removeItem.mutate(item.id) }}
                  className="text-neutral-300 hover:text-red-500 shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add new */}
      <div className="bg-neutral-25 border border-neutral-100 rounded-lg p-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Thêm câu FAQ</p>
        <input
          value={newQ}
          onChange={e => setNewQ(e.target.value)}
          placeholder="Câu hỏi…"
          className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-1.5 text-sm bg-white w-full"
        />
        <textarea
          rows={3}
          value={newA}
          onChange={e => setNewA(e.target.value)}
          placeholder="Câu trả lời…"
          className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-1.5 text-sm bg-white w-full resize-y"
        />
        <Button
          size="sm"
          onClick={() => addItem.mutate()}
          disabled={!newQ.trim() || !newA.trim() || addItem.isPending}
        >
          <Plus size={12} /> Thêm
        </Button>
      </div>
    </div>
  )
}

// ─── AI Assistant editor ──────────────────────────────────────────────────────

function ChatbotEditor({ panel }: { panel: HelperPanel }) {
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const [name, setName]                   = useState(panel.name)
  const [description, setDescription]     = useState(panel.description ?? '')
  const [systemPrompt, setSystemPrompt]   = useState(panel.config.system_prompt ?? '')
  const [knowledgeBase, setKnowledgeBase] = useState(panel.config.knowledge_base ?? '')
  const [contextTemplate, setContextTemplate] = useState(panel.config.context_template ?? '')
  const [model, setModel]                 = useState(panel.config.model ?? 'claude-haiku-4-5')
  const [allowExternal, setAllowExternal] = useState(!!panel.config.allow_external)
  const [apiEndpoint, setApiEndpoint]     = useState(panel.config.api_endpoint ?? '')
  const [apiKeyEnv, setApiKeyEnv]         = useState(panel.config.api_key_env ?? 'LLM_API_KEY')
  const [historyEnabled, setHistoryEnabled] = useState(!!panel.config.conversation_history_enabled)
  const [historyPairs, setHistoryPairs]     = useState(panel.config.conversation_history_pairs ?? 5)

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('helper_panels').update({
        name,
        description: description || null,
        config: {
          system_prompt:                 systemPrompt,
          knowledge_base:                knowledgeBase || undefined,
          context_template:              contextTemplate || undefined,
          model,
          allow_external:                allowExternal,
          api_endpoint:                  apiEndpoint || undefined,
          api_key_env:                   apiKeyEnv || undefined,
          conversation_history_enabled:  historyEnabled,
          conversation_history_pairs:    historyPairs,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', panel.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['helper-panels'] })
      success('Đã lưu AI Assistant')
    },
    onError: () => toastError('Không thể lưu'),
  })

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
        AI Assistant runtime chưa kết nối với LLM. UI + config đã sẵn sàng — cần triển khai Supabase Edge Function
        <code className="mx-1 font-mono bg-white/70 px-1 rounded">chat-helper</code>
        đọc các trường bên dưới và gọi LLM. Khi xong, secret API key đặt theo tên ở
        <code className="ml-1 font-mono bg-white/70 px-1 rounded">API key env</code>.
      </div>

      <Section title="Định danh">
        <Field label="Tên *">
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Mô tả">
          <input value={description} onChange={e => setDescription(e.target.value)} className={inputCls} />
        </Field>
      </Section>

      <Section title="Hướng dẫn cho AI">
        <Field label="System prompt" hint="Cách AI nên phản hồi (vai trò, tone, giới hạn).">
          <textarea
            rows={5}
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="VD: Bạn là trợ lý nội bộ về quy trình QA. Chỉ trả lời các câu liên quan tới checklist hiện tại."
            className={`${inputCls} resize-y font-mono`}
          />
        </Field>

        <Field label="Knowledge base" hint="Dữ liệu nội bộ — markdown / dán nguyên văn. Sẽ được nối vào system prompt khi gọi LLM.">
          <textarea
            rows={6}
            value={knowledgeBase}
            onChange={e => setKnowledgeBase(e.target.value)}
            placeholder="Dán quy trình, FAQ nội bộ, checklist mẫu, glossary…"
            className={`${inputCls} resize-y font-mono`}
          />
          <KnowledgeUpload
            onAppend={(text) => setKnowledgeBase((kb) => (kb ? `${kb}\n\n${text}` : text))}
          />
        </Field>

        <Field label="Context template" hint="Tuỳ chọn — cách format câu hỏi của user trước khi gửi cho AI.">
          <textarea
            rows={3}
            value={contextTemplate}
            onChange={e => setContextTemplate(e.target.value)}
            placeholder="VD: 'Bước hiện tại: {{step.title}}. Câu hỏi: {{question}}'"
            className={`${inputCls} resize-y font-mono`}
          />
        </Field>
      </Section>

      <Section title="Model & API">
        <Field label="Model">
          <select value={model} onChange={e => setModel(e.target.value)} className={inputCls}>
            <option value="claude-haiku-4-5">Claude Haiku 4.5 (nhanh, rẻ)</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (cân bằng)</option>
            <option value="claude-opus-4-7">Claude Opus 4.7 (tốt nhất)</option>
            <option value="gpt-4o-mini">GPT-4o mini</option>
            <option value="gpt-4o">GPT-4o</option>
            <option value="custom">Custom (đặt endpoint riêng)</option>
          </select>
        </Field>

        <Field label="API endpoint (override)" hint="Trống = dùng mặc định Anthropic API. Đặt nếu dùng provider khác hoặc proxy.">
          <input
            value={apiEndpoint}
            onChange={e => setApiEndpoint(e.target.value)}
            placeholder="https://api.anthropic.com/v1/messages"
            className={inputCls}
          />
        </Field>

        <Field label="API key env" hint="Tên env var trong Supabase Edge Function chứa API key. Mặc định LLM_API_KEY.">
          <input
            value={apiKeyEnv}
            onChange={e => setApiKeyEnv(e.target.value)}
            className={inputCls + ' font-mono'}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
          <input
            type="checkbox"
            checked={allowExternal}
            onChange={e => setAllowExternal(e.target.checked)}
            className="accent-primary-600"
          />
          Cho phép AI trả lời cả ngoài dữ liệu nội bộ
        </label>
      </Section>

      <Section title="Hội thoại">
        <label className="flex items-start gap-2 text-sm text-neutral-700 cursor-pointer">
          <input
            type="checkbox"
            checked={historyEnabled}
            onChange={e => setHistoryEnabled(e.target.checked)}
            className="accent-primary-600 mt-0.5"
          />
          <div>
            <span className="font-medium">Lưu lịch sử hội thoại</span>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              Khi bật, người dùng có thể reply vào tin nhắn bot để tiếp tục hội thoại với ngữ cảnh từ các lượt trước.
            </p>
          </div>
        </label>
        {historyEnabled && (
          <Field label="Số cặp Q&A ghi nhớ" hint="Mỗi cặp = 1 câu hỏi + 1 câu trả lời (tối đa 5 cặp = 10 tin nhắn).">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={5}
                value={historyPairs}
                onChange={e => setHistoryPairs(Number(e.target.value))}
                className="accent-primary-600 w-32"
              />
              <span className="text-sm font-medium text-neutral-700 w-4 text-center">{historyPairs}</span>
              <span className="text-xs text-neutral-400">cặp ({historyPairs * 2} tin nhắn)</span>
            </div>
          </Field>
        )}
      </Section>

      <div className="pt-2 border-t border-neutral-100">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Đang lưu…' : 'Lưu cấu hình'}
        </Button>
      </div>
    </div>
  )
}

const inputCls = 'border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border border-neutral-100 rounded-lg p-3 space-y-3 bg-neutral-25">
      <legend className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 px-2">{title}</legend>
      {children}
    </fieldset>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-neutral-400 mt-1">{hint}</p>}
    </div>
  )
}

// ─── Round-10: Knowledge-base file upload ────────────────────────────────────
// Accepts .md / .txt directly via FileReader. .docx parsed client-side via
// `mammoth` (dynamic-imported so the lib is only loaded when used).

function KnowledgeUpload({ onAppend }: { onAppend: (text: string) => void }) {
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function readMdOrTxt(file: File): Promise<string> {
    return await file.text()
  }

  async function readDocx(file: File): Promise<string> {
    // mammoth ships ESM; the browser bundle has no .d.ts shipped, so cast.
    const mammothMod: any = await import('mammoth/mammoth.browser')
    const mammoth = mammothMod.default ?? mammothMod
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    return result.value as string
  }

  async function handleFiles(files: FileList) {
    setBusy(true)
    try {
      const parts: string[] = []
      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase()
        let body = ''
        if (lower.endsWith('.docx')) {
          body = await readDocx(file)
        } else if (lower.endsWith('.md') || lower.endsWith('.txt')) {
          body = await readMdOrTxt(file)
        } else {
          // Skip unsupported types silently — user picked filtered file but
          // some browsers ignore the accept= filter on drag-drop.
          continue
        }
        if (body.trim()) parts.push(`--- File: ${file.name} ---\n${body.trim()}`)
      }
      if (parts.length > 0) onAppend(parts.join('\n\n'))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".md,.txt,.docx"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="text-[12px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50"
      >
        📎 {busy ? 'Đang đọc...' : 'Tải file (.md / .txt / .docx)'}
      </button>
      <span className="text-[11px] text-neutral-400 italic">
        Nội dung sẽ được nối vào dưới phần knowledge base.
      </span>
    </div>
  )
}
