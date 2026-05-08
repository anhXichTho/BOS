import { supabase } from './supabase'

/** Upload a single file to the public chat-attachments bucket and return its public URL. */
export async function uploadAttachment(file: File, prefix = 'forms'): Promise<string> {
  const ext  = file.name.split('.').pop() ?? 'bin'
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60)
  const path = `${prefix}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe || `paste.${ext}`}`

  const { error } = await supabase.storage
    .from('chat-attachments')
    .upload(path, file, { cacheControl: '3600', upsert: false })

  if (error) throw error

  const { data } = supabase.storage.from('chat-attachments').getPublicUrl(path)
  return data.publicUrl
}

/** Pull image-like files out of a clipboard event. */
export function extractClipboardImages(e: ClipboardEvent): File[] {
  const out: File[] = []
  const items = e.clipboardData?.items ?? []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) out.push(file)
    }
  }
  return out
}
