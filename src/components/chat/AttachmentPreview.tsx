import { useState } from 'react'
import { FileText, Image, Download, Eye, X } from 'lucide-react'
import type { ChatAttachment } from '../../types'

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function AttachmentPreview({ attachment }: { attachment: ChatAttachment }) {
  const isImage = attachment.file_type?.startsWith('image/')
  const [lightboxOpen, setLightboxOpen] = useState(false)

  if (isImage) {
    return (
      <>
        <div
          className="relative group/img cursor-pointer"
          onClick={() => setLightboxOpen(true)}
        >
          <img
            src={attachment.file_url}
            alt={attachment.file_name}
            className="max-h-[200px] max-w-[300px] rounded-lg border border-neutral-100 object-cover block"
          />
          <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 rounded-lg transition-colors flex items-center justify-center pointer-events-none">
            <span className="opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center gap-1 bg-white/90 text-neutral-800 text-xs font-medium px-2 py-1 rounded-full shadow-sm">
              <Eye size={12} /> Xem
            </span>
          </div>
        </div>

        {lightboxOpen && (
          <div
            className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
            onClick={() => setLightboxOpen(false)}
          >
            <img
              src={attachment.file_url}
              alt={attachment.file_name}
              className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl object-contain"
              onClick={e => e.stopPropagation()}
            />
            <button
              onClick={() => setLightboxOpen(false)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        )}
      </>
    )
  }

  return (
    <a
      href={attachment.file_url}
      target="_blank"
      rel="noreferrer"
      download={attachment.file_name}
      className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 hover:bg-neutral-100 transition-colors max-w-[240px]"
    >
      {attachment.file_type?.includes('image') ? (
        <Image size={16} className="text-neutral-400 shrink-0" />
      ) : (
        <FileText size={16} className="text-neutral-400 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-neutral-700 truncate">{attachment.file_name}</p>
        <p className="text-[10px] text-neutral-400">{formatBytes(attachment.file_size)}</p>
      </div>
      <Download size={13} className="text-neutral-400 shrink-0" />
    </a>
  )
}
