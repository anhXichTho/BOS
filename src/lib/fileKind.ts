// Simple file-type classifier for preview/download decisions.

export type FileKind =
  | 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx'
  | 'md' | 'txt' | 'csv' | 'archive' | 'video' | 'audio' | 'other'

const IMAGE_EXTS    = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp']
const ARCHIVE_EXTS  = ['zip', 'rar', '7z', 'tar', 'gz']
const VIDEO_EXTS    = ['mp4', 'webm', 'mov', 'mkv']
const AUDIO_EXTS    = ['mp3', 'wav', 'ogg', 'm4a']

export function getFileKind(filename: string, mimeType?: string | null): FileKind {
  const ext = (filename.split('.').pop() ?? '').toLowerCase()
  if (mimeType?.startsWith('image/') || IMAGE_EXTS.includes(ext))   return 'image'
  if (mimeType?.startsWith('video/') || VIDEO_EXTS.includes(ext))   return 'video'
  if (mimeType?.startsWith('audio/') || AUDIO_EXTS.includes(ext))   return 'audio'
  if (ext === 'pdf' || mimeType === 'application/pdf')              return 'pdf'
  if (ext === 'doc' || ext === 'docx')                               return 'docx'
  if (ext === 'xls' || ext === 'xlsx')                               return 'xlsx'
  if (ext === 'ppt' || ext === 'pptx')                               return 'pptx'
  if (ext === 'md' || ext === 'markdown')                            return 'md'
  if (ext === 'txt' || ext === 'log')                                return 'txt'
  if (ext === 'csv')                                                 return 'csv'
  if (ARCHIVE_EXTS.includes(ext))                                    return 'archive'
  return 'other'
}

export function canPreview(kind: FileKind): boolean {
  return ['image', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'txt', 'csv', 'video', 'audio'].includes(kind)
}

export function fileKindLabel(kind: FileKind): string {
  switch (kind) {
    case 'image':   return 'Ảnh'
    case 'pdf':     return 'PDF'
    case 'docx':    return 'Word'
    case 'xlsx':    return 'Excel'
    case 'pptx':    return 'PowerPoint'
    case 'md':      return 'Markdown'
    case 'txt':     return 'Text'
    case 'csv':     return 'CSV'
    case 'archive': return 'Archive'
    case 'video':   return 'Video'
    case 'audio':   return 'Audio'
    default:        return 'File'
  }
}

/** Office Online viewer URL — works for docx/xlsx/pptx with publicly reachable file URLs. */
export function officeViewerUrl(fileUrl: string): string {
  return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(fileUrl)}`
}

/** Force-download a remote file by fetching as Blob. */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const blob = await r.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Format bytes as human-readable string. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}
