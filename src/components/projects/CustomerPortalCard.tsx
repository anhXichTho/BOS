/**
 * CustomerPortalCard — manages the customer-facing portal credentials for a
 * project (toggle, username, password). Extracted from ProjectDetailPage so
 * it can live in a dedicated tab (Phase 3 redesign).
 *
 * Responsibilities:
 *  - Toggle portal on/off (project.portal_enabled).
 *  - Edit username + bcrypt-hashed password.
 *  - Show + copy portal URL when enabled and configured.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, ExternalLink, Eye, EyeOff } from 'lucide-react'
import bcrypt from 'bcryptjs'
import Button from '../ui/Button'
import { useToast } from '../ui/Toast'
import { supabase } from '../../lib/supabase'
import type { Project } from '../../types'

interface Props {
  project: Project
  /** Origin to build the portal URL (e.g. window.location.origin). */
  portalOrigin: string
}

export default function CustomerPortalCard({ project, portalOrigin }: Props) {
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const [editingCreds, setEditingCreds]   = useState(false)
  const [credUsername, setCredUsername]   = useState(project.portal_username ?? '')
  const [credPassword, setCredPassword]   = useState('')
  const [showPassword, setShowPassword]   = useState(false)
  const [copied, setCopied]               = useState(false)

  const credsConfigured = !!(project.portal_username && project.portal_password_hash)
  const portalUrl = `${portalOrigin}/portal/${project.public_token}`

  const togglePortal = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (enabled && (!project.portal_username || !project.portal_password_hash)) {
        throw new Error('Đặt username + mật khẩu trước khi bật portal')
      }
      const { error } = await supabase.from('projects').update({ portal_enabled: enabled }).eq('id', project.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project'] }),
    onError: (e: any) => toastError(e?.message ?? 'Không thể cập nhật'),
  })

  const saveCreds = useMutation({
    mutationFn: async () => {
      if (!credUsername.trim()) throw new Error('Username bắt buộc')
      if (!credsConfigured && credPassword.length < 4) throw new Error('Mật khẩu ≥ 4 ký tự')
      const updates: Partial<Project> = { portal_username: credUsername.trim() }
      if (credPassword) {
        const hash = await bcrypt.hash(credPassword, 10)
        ;(updates as any).portal_password_hash = hash
      }
      const { error } = await supabase.from('projects').update(updates).eq('id', project.id)
      if (error) throw error
    },
    onSuccess: () => {
      success('Đã lưu thông tin đăng nhập')
      setEditingCreds(false)
      setCredPassword('')
      qc.invalidateQueries({ queryKey: ['project'] })
    },
    onError: (e: any) => toastError(e?.message ?? 'Không thể lưu'),
  })

  function startEditCreds() {
    setCredUsername(project.portal_username ?? '')
    setCredPassword('')
    setEditingCreds(true)
  }

  async function copyPortalLink() {
    await navigator.clipboard.writeText(portalUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-white border border-neutral-100 rounded-lg p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Customer Portal</p>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <span className="text-xs text-neutral-600">{project.portal_enabled ? 'Bật' : 'Tắt'}</span>
          <div
            onClick={() => togglePortal.mutate(!project.portal_enabled)}
            className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
              project.portal_enabled ? 'bg-primary-600' : 'bg-neutral-200'
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              project.portal_enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`} />
          </div>
        </label>
      </div>

      {editingCreds ? (
        <div className="space-y-2 bg-neutral-25 border border-neutral-100 rounded-lg p-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">Username</label>
            <input
              type="text"
              value={credUsername}
              onChange={e => setCredUsername(e.target.value)}
              placeholder="vd: khach-abc"
              className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-2.5 py-1.5 text-xs bg-white w-full"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">
              {credsConfigured ? 'Mật khẩu mới' : 'Mật khẩu'} (≥ 4 ký tự)
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={credPassword}
                onChange={e => setCredPassword(e.target.value)}
                placeholder="••••••••"
                className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg pl-2.5 pr-8 py-1.5 text-xs bg-white w-full"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
              >
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={() => saveCreds.mutate()} disabled={saveCreds.isPending}>
              Lưu
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditingCreds(false)}>
              Huỷ
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">Username:</span>
            <span className="text-xs text-neutral-700 font-mono">
              {project.portal_username ?? '— chưa đặt —'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">Mật khẩu:</span>
            <span className="text-xs text-neutral-700">
              {credsConfigured ? '••••••••' : '— chưa đặt —'}
            </span>
          </div>
          <Button size="sm" variant="secondary" onClick={startEditCreds}>
            {credsConfigured ? 'Đổi username/password' : 'Đặt username/password'}
          </Button>
        </div>
      )}

      {project.portal_enabled && credsConfigured && (
        <div className="space-y-2 pt-2 border-t border-neutral-100">
          <div className="flex items-center gap-1.5 bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-1.5">
            <span className="text-[10px] text-neutral-500 flex-1 truncate font-mono">{portalUrl}</span>
            <button onClick={copyPortalLink} className="text-neutral-400 hover:text-primary-600 transition-colors shrink-0">
              {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
            </button>
          </div>
          <a
            href={portalUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-primary-600 hover:underline"
          >
            <ExternalLink size={11} /> Mở portal
          </a>
        </div>
      )}
    </div>
  )
}
