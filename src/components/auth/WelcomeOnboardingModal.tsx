/**
 * WelcomeOnboardingModal — first-login UX.
 *
 * Mounted in App.tsx behind <AuthProvider>. Shows on top of the app when:
 *   - The user is signed in.
 *   - They have NOT yet onboarded (no `preferences.onboarded_at` AND no
 *     legacy `profiles.onboarded_at`).
 *
 * Persistence is via the existing `profiles.preferences` jsonb column
 * (Round-10 follow-up #3). That column already exists in every deploy,
 * so the dismissal sticks across server restarts without requiring the
 * onboarding migration to have been run. A localStorage flag is kept as
 * a belt-and-suspenders fallback for offline / slow profile-refresh.
 *
 * Fields:
 *   - Nickname (maps to profiles.full_name; required)
 *   - New password (optional — Skip leaves the password unchanged)
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

const localOnboardedKey = (uid: string) => `bos_onboarded_${uid}`

export default function WelcomeOnboardingModal() {
  const { user, profile, updatePreferences } = useAuth()
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const localOnboarded = !!user && typeof window !== 'undefined'
    && window.localStorage.getItem(localOnboardedKey(user.id)) === '1'

  // Onboarded if EITHER the legacy column is set OR preferences carries the
  // timestamp OR we've stored the local flag.
  const onboardedAt =
    profile?.onboarded_at ?? profile?.preferences?.onboarded_at ?? null

  const needsOnboarding = !!user && !!profile && !onboardedAt && !localOnboarded
  const [open, setOpen] = useState(false)
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)

  // Open + initialise once the profile loads.
  useEffect(() => {
    if (!needsOnboarding) return
    setOpen(true)
    setNickname(profile?.full_name ?? '')
    setPassword('')
    setConfirmPassword('')
  }, [needsOnboarding, profile?.full_name])

  async function markOnboarded() {
    if (!user) return
    const stamp = new Date().toISOString()
    // 1. Local flag — immediate, prevents re-pop within the session/browser.
    try { window.localStorage.setItem(localOnboardedKey(user.id), '1') } catch {}
    // 2. Persist into preferences.onboarded_at via the existing
    //    AuthContext.updatePreferences() flow. This writes `profiles.preferences`
    //    (jsonb, always present), so the dismissal persists DB-side regardless
    //    of whether the legacy onboarded_at column migration was run.
    try {
      await updatePreferences({ onboarded_at: stamp })
    } catch (e: any) {
      console.warn('[Welcome] preferences write failed:', e?.message)
    }
    // 3. Best-effort write to the legacy column too — silent on failure.
    try {
      await supabase
        .from('profiles')
        .update({ onboarded_at: stamp })
        .eq('id', user.id)
    } catch { /* migration pending — fine, preferences carry the flag */ }
    qc.invalidateQueries({ queryKey: ['profile', user.id] })
  }

  async function submit() {
    if (!user) return
    const trimmedName = nickname.trim()
    if (!trimmedName) { toastError('Vui lòng nhập tên hiển thị'); return }

    // Password is optional. If filled, must match confirm + ≥6 chars.
    if (password) {
      if (password.length < 6) { toastError('Mật khẩu phải từ 6 ký tự'); return }
      if (password !== confirmPassword) { toastError('Mật khẩu xác nhận không khớp'); return }
    }

    setBusy(true)
    try {
      // 1. Update profile name
      if (trimmedName !== profile?.full_name) {
        const { error: pErr } = await supabase
          .from('profiles')
          .update({ full_name: trimmedName })
          .eq('id', user.id)
        if (pErr) throw pErr
      }

      // 2. Update password if provided
      if (password) {
        const { error: pwErr } = await supabase.auth.updateUser({ password })
        if (pwErr) throw pwErr
      }

      // 3. Mark onboarded
      await markOnboarded()
      success('Chào mừng đến với Business OS!')
      setOpen(false)
    } catch (e: any) {
      toastError(e?.message ?? 'Có lỗi xảy ra')
    } finally {
      setBusy(false)
    }
  }

  async function skip() {
    setBusy(true)
    try {
      await markOnboarded()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  if (!needsOnboarding) return null

  return (
    <Modal
      open={open}
      onClose={skip}
      title="👋 Chào mừng tới Business OS"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={skip} disabled={busy}>Bỏ qua</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !nickname.trim()}>
            {busy ? 'Đang lưu...' : 'Lưu & bắt đầu'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">
          Một số thiết lập nhỏ trước khi bắt đầu. Có thể đổi lại bất cứ lúc nào ở
          <span className="font-medium"> Cài đặt → Cá nhân</span>.
        </p>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Tên hiển thị
          </label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="VD: Nal · Phòng Phát triển"
            className="mt-1 w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-100"
            autoFocus
          />
        </div>

        <div className="border-t border-neutral-100 pt-4">
          <p className="text-[12px] text-neutral-500 mb-2">
            Đặt mật khẩu mới (tuỳ chọn — bỏ trống để giữ mật khẩu hiện tại):
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mật khẩu mới (ít nhất 6 ký tự)"
            className="w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-100"
          />
          {password && (
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Xác nhận mật khẩu"
              className="mt-2 w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-100"
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
