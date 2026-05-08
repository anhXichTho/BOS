import { useEffect, useState } from 'react'
import { X, Download, ExternalLink, Loader2 } from 'lucide-react'
import { useToast } from '../ui/Toast'
import {
  getFileKind, canPreview, downloadFile, fileKindLabel, officeViewerUrl,
} from '../../lib/fileKind'

interface Props {
  open: boolean
  onClose: () => void
  fileName: string
  fileUrl: string
  fileMime?: string | null
}

/**
 * Generic file preview / download modal.
 * - Images, PDF, video, audio: native preview
 * - docx/xlsx/pptx: Office Online viewer (works because storage URLs are public)
 * - md/txt/csv: fetched and rendered as preformatted text
 * - archives + others: download-only
 */
export default function FilePreviewModal({ open, onClose, fileName, fileUrl, fileMime }: Props) {
  const kind = getFileKind(fileName, fileMime)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loadingText, setLoadingText] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const { error: toastError } = useToast()

  // Fetch text-based files for inline rendering
  useEffect(() => {
    if (!open) return
    if (kind !== 'md' && kind !== 'txt' && kind !== 'csv') return
    setLoadingText(true)
    setTextContent(null)
    fetch(fileUrl)
      .then(r => r.text())
      .then(setTextContent)
      .catch(() => toastError('Không thể tải nội dung file'))
      .finally(() => setLoadingText(false))
  }, [open, fileUrl, kind])

  // Esc to close
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null

  async function handleDownload() {
    setDownloading(true)
    try {
      await downloadFile(fileUrl, fileName)
    } catch (err: any) {
      toastError(err?.message ?? 'Không thể tải file')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white border border-neutral-100 w-full max-w-5xl flex flex-col max-h-screen sm:max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-neutral-100 px-4 sm:px-5 py-3 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 bg-neutral-100 rounded-md px-2 py-0.5 shrink-0">
            {fileKindLabel(kind)}
          </span>
          <h2 className="font-serif text-sm font-medium text-neutral-800 flex-1 truncate">{fileName}</h2>
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className="text-neutral-400 hover:text-primary-600 p-1 rounded-lg hover:bg-neutral-50 shrink-0"
            title="Mở tab mới"
          >
            <ExternalLink size={16} />
          </a>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="text-neutral-400 hover:text-primary-600 p-1 rounded-lg hover:bg-neutral-50 disabled:opacity-50 shrink-0"
            title="Tải xuống"
          >
            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          </button>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 p-1 rounded-lg hover:bg-neutral-50 shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-neutral-25 flex items-stretch justify-center">
          {!canPreview(kind) ? (
            <UnsupportedPreview onDownload={handleDownload} />
          ) : kind === 'image' ? (
            <div className="flex items-center justify-center w-full p-4">
              <img src={fileUrl} alt={fileName} className="max-w-full max-h-[80vh] object-contain" />
            </div>
          ) : kind === 'pdf' ? (
            <iframe src={fileUrl} title={fileName} className="w-full h-[80vh] border-0" />
          ) : kind === 'docx' || kind === 'xlsx' || kind === 'pptx' ? (
            <iframe
              src={officeViewerUrl(fileUrl)}
              title={fileName}
              className="w-full h-[80vh] border-0"
            />
          ) : kind === 'video' ? (
            <video controls src={fileUrl} className="max-w-full max-h-[80vh]" />
          ) : kind === 'audio' ? (
            <audio controls src={fileUrl} className="m-auto" />
          ) : kind === 'md' ? (
            <MarkdownPreview text={textContent} loading={loadingText} />
          ) : (kind === 'txt' || kind === 'csv') ? (
            <pre className="w-full p-4 font-mono text-xs text-neutral-700 whitespace-pre-wrap break-words bg-white">
              {loadingText ? 'Đang tải…' : (textContent ?? '')}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function UnsupportedPreview({ onDownload }: { onDownload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center w-full p-12 text-center">
      <p className="text-neutral-500 text-sm mb-3">Không hỗ trợ preview cho định dạng này.</p>
      <button
        onClick={onDownload}
        className="inline-flex items-center gap-1.5 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-lg text-sm font-medium"
      >
        <Download size={14} /> Tải xuống
      </button>
    </div>
  )
}

/**
 * Lightweight markdown preview — renders headings (`#`/`##`), bold (`**`),
 * code spans, links, and bullet lists. Falls back to plain text for the rest.
 * Good enough for ad-hoc notes without pulling in a parser dependency.
 */
function MarkdownPreview({ text, loading }: { text: string | null; loading: boolean }) {
  if (loading) return <div className="p-6 text-sm text-neutral-400">Đang tải…</div>
  if (!text)   return <div className="p-6 text-sm text-neutral-400">Trống.</div>

  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let listBuf: string[] = []

  function flushList(key: string) {
    if (listBuf.length === 0) return
    out.push(
      <ul key={`ul-${key}`} className="list-disc ml-5 my-1.5 space-y-0.5 text-sm text-neutral-700">
        {listBuf.map((l, i) => <li key={i}>{renderInline(l)}</li>)}
      </ul>
    )
    listBuf = []
  }

  function renderInline(s: string): React.ReactNode {
    const parts: React.ReactNode[] = []
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index))
      const tok = m[0]
      if (tok.startsWith('**')) parts.push(<strong key={m.index}>{tok.slice(2, -2)}</strong>)
      else if (tok.startsWith('`')) parts.push(<code key={m.index} className="font-mono bg-neutral-100 px-1 rounded">{tok.slice(1, -1)}</code>)
      else {
        const linkM = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)
        if (linkM) parts.push(<a key={m.index} href={linkM[2]} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">{linkM[1]}</a>)
      }
      last = m.index + tok.length
    }
    if (last < s.length) parts.push(s.slice(last))
    return parts.length ? parts : s
  }

  lines.forEach((raw, i) => {
    const line = raw
    if (line.startsWith('# ')) {
      flushList(String(i))
      out.push(<h1 key={i} className="text-xl font-semibold text-neutral-800 mt-4 mb-2">{line.slice(2)}</h1>)
    } else if (line.startsWith('## ')) {
      flushList(String(i))
      out.push(<h2 key={i} className="text-lg font-semibold text-neutral-800 mt-3 mb-1.5">{line.slice(3)}</h2>)
    } else if (line.startsWith('### ')) {
      flushList(String(i))
      out.push(<h3 key={i} className="text-base font-semibold text-neutral-800 mt-2 mb-1">{line.slice(4)}</h3>)
    } else if (/^[-*]\s/.test(line)) {
      listBuf.push(line.slice(2))
    } else if (line.trim() === '') {
      flushList(String(i))
      out.push(<div key={i} className="h-2" />)
    } else {
      flushList(String(i))
      out.push(<p key={i} className="text-sm text-neutral-700 my-1">{renderInline(line)}</p>)
    }
  })
  flushList('end')

  return <div className="w-full p-6 max-w-3xl mx-auto bg-white">{out}</div>
}
