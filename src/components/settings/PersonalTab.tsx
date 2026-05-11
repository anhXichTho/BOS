import { Bell, BellOff, BellRing, Send } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import { usePushSubscription } from '../../lib/usePushSubscription'
import type { FontChoice } from '../../types'

/**
 * "Cá nhân" tab — per-user preferences saved to profiles.preferences (jsonb).
 * Exposes:
 *   - Font choice (IBM Plex Sans vs Inter)
 *   - Sidebar pin toggle
 *
 * Theme is locked to IBM Carbon — single source of truth, no toggle.
 */
export default function PersonalTab() {
  const { preferences, updatePreferences, profile } = useAuth()
  const { success, error: toastError } = useToast()
  const push = usePushSubscription()

  async function handleSendTestPush() {
    if (Notification.permission !== 'granted') {
      toastError('Trình duyệt chưa cấp quyền — bật toggle bên trên trước')
      return
    }
    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification('BOS — Thử thông báo', {
        body: 'Nếu bạn thấy thông báo này, push qua nút bấm đã hoạt động ✓',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'bos-test-' + Date.now(),
        requireInteraction: false,
        data: { url: '/settings' },
      })
      success('Đã gửi — kiểm tra Windows notification')
    } catch (err) {
      toastError('Lỗi: ' + String(err))
      console.warn('[test-push]', err)
    }
  }

  const rawFont = preferences.font as string | undefined
  const font: FontChoice =
    rawFont === 'plex'  ? 'plex'  :
    rawFont === 'serif' ? 'serif' :
    'inter'
  const sidebarPinned = preferences.sidebar?.pinned ?? false

  async function setFont(next: FontChoice) {
    if (next === font) return
    await updatePreferences({ font: next })
    const label =
      next === 'inter' ? 'Inter' :
      next === 'plex'  ? 'IBM Plex Sans' :
      'Source Serif 4'
    success(`Đã đổi sang ${label}`)
  }

  async function handlePushToggle() {
    if (push.subscribed) {
      await push.unsubscribe()
      success('Đã tắt thông báo đẩy')
    } else {
      await push.subscribe()
      // Permission check happens inside subscribe(); state updates async so we
      // can't rely on push.subscribed immediately — show a neutral prompt instead.
      if (Notification.permission === 'denied') {
        toastError('Trình duyệt đã chặn thông báo. Vui lòng cấp quyền trong cài đặt.')
      } else if (Notification.permission === 'granted') {
        success('Đã bật thông báo đẩy')
      }
    }
  }

  async function setPinned(next: boolean) {
    await updatePreferences({ sidebar: { ...preferences.sidebar, pinned: next } })
    success(next ? 'Đã pin sidebar' : 'Sidebar sẽ collapse khi không hover')
  }

  return (
    <div className="space-y-8">
      {/* Account snapshot */}
      <section className="bg-white border border-neutral-100 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">Tài khoản</p>
        <p className="text-sm text-neutral-900">{profile?.full_name}</p>
        <p className="text-[11px] text-neutral-600 mt-0.5">Role: {profile?.role}</p>
      </section>

      {/* Theme — informational, no toggle */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600 mb-1">Giao diện</h3>
        <p className="text-[11px] text-neutral-500 mb-3">
          Áp dụng XT-Design v1.1 (Hybrid Carbon × Fluent, Warm Retro). Primary anchor: <span className="font-mono">#4A6AAB</span>. Bo góc 4px, đổ bóng nhẹ trên card/popover.
        </p>
        <div className="border border-neutral-100 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-700">XT v1.1 — Warm Retro</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full">Active</span>
          </div>
          <div className="flex gap-1 mt-2">
            {['#FDFDFC', '#E0E0E0', '#BCBCBC', '#524F4D', '#3B3B3B', '#4A6AAB', '#C1695B'].map(c => (
              <span key={c} className="flex-1 h-4 border" style={{ background: c, borderColor: '#E0E0E0' }} />
            ))}
          </div>
        </div>
      </section>

      {/* Font picker */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600 mb-1">Font chữ</h3>
        <p className="text-[11px] text-neutral-500 mb-3">
          Lựa chọn áp dụng toàn app. IBM Plex Sans là font chuẩn của Carbon Design.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <FontOption
            id="inter"
            active={font === 'inter'}
            onClick={() => setFont('inter')}
            label="Inter"
            sample="Quản lý vận hành — modern UI"
            fontFamily='"Inter", system-ui, sans-serif'
          />
          <FontOption
            id="plex"
            active={font === 'plex'}
            onClick={() => setFont('plex')}
            label="IBM Plex Sans"
            sample="Quản lý vận hành — engineering"
            fontFamily='"IBM Plex Sans", system-ui, sans-serif'
          />
          <FontOption
            id="serif"
            active={font === 'serif'}
            onClick={() => setFont('serif')}
            label="Source Serif 4"
            sample="Quản lý vận hành — reading mode"
            fontFamily='"Source Serif 4", Georgia, serif'
          />
        </div>
      </section>

      {/* Push notifications */}
      {push.isSupported && push.permission !== 'unsupported' && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600 mb-1">
            Thông báo đẩy
          </h3>
          <p className="text-[11px] text-neutral-500 mb-3">
            Nhận thông báo khi có tin nhắn mới, đề cập hoặc yêu cầu duyệt — ngay cả khi app đang đóng.
          </p>

          {push.permission === 'denied' ? (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
              <BellOff className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Trình duyệt đang chặn thông báo. Vào <strong>Cài đặt trình duyệt → Quyền trang web</strong> để cấp
                quyền cho <em>{typeof window !== 'undefined' ? window.location.hostname : 'app'}</em>, rồi tải lại
                trang.
              </span>
            </div>
          ) : (
            <div className="border border-neutral-100 bg-white p-3 shadow-sm flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                {push.subscribed
                  ? <BellRing className="w-4 h-4 text-primary-600" />
                  : <Bell     className="w-4 h-4 text-neutral-400" />
                }
                <div>
                  <p className="text-xs font-semibold text-neutral-700">
                    {push.subscribed ? 'Đã bật thông báo đẩy' : 'Chưa bật thông báo đẩy'}
                  </p>
                  <p className="text-[10px] text-neutral-500 mt-0.5">
                    {push.subscribed
                      ? 'Bạn sẽ nhận thông báo về đề cập, duyệt, và dự án'
                      : 'Bật để nhận thông báo dù app đang tắt'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={push.loading}
                onClick={handlePushToggle}
                className={`shrink-0 w-9 h-5 rounded-full relative transition-colors ${
                  push.subscribed ? 'bg-primary-600' : 'bg-neutral-200'
                } disabled:opacity-50`}
                aria-pressed={push.subscribed}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    push.subscribed ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          )}

          {push.subscribed && (
            <button
              type="button"
              onClick={handleSendTestPush}
              data-testid="send-test-push"
              className="mt-2 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-primary-300 text-primary-700 hover:bg-primary-50 rounded"
            >
              <Send className="w-3.5 h-3.5" /> Gửi thử thông báo
            </button>
          )}
        </section>
      )}

      {/* Sidebar pin */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600 mb-1">Sidebar (desktop)</h3>
        <p className="text-[11px] text-neutral-500 mb-3">
          Khi tắt: sidebar mở rộng khi hover, tự thu khi rời chuột. Khi bật: luôn mở.
        </p>
        <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
          <span className="text-sm text-neutral-700">Pin sidebar</span>
          <button
            type="button"
            onClick={() => setPinned(!sidebarPinned)}
            className={`w-9 h-5 rounded-full relative transition-colors ${
              sidebarPinned ? 'bg-primary-600' : 'bg-neutral-200'
            }`}
            aria-pressed={sidebarPinned}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                sidebarPinned ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>
      </section>
    </div>
  )
}

function FontOption({
  id, active, onClick, label, sample, fontFamily,
}: {
  id: string
  active: boolean
  onClick: () => void
  label: string
  sample: string
  fontFamily: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left border p-3 transition-colors ${
        active
          ? 'border-primary-600 bg-primary-50/40'
          : 'border-neutral-200 hover:border-neutral-400 bg-white'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-700">{label}</span>
        <span
          className={`w-3.5 h-3.5 rounded-full border-2 ${
            active ? 'border-primary-600 bg-primary-600' : 'border-neutral-300'
          }`}
        />
      </div>
      <p className="text-base text-neutral-900" style={{ fontFamily }}>
        {sample}
      </p>
      <p className="text-[11px] text-neutral-500 mt-1" style={{ fontFamily }}>
        AaBb 0123 — {
          id === 'plex'  ? 'IBM enterprise' :
          id === 'serif' ? 'paper / retro' :
          'modern functional'
        }
      </p>
    </button>
  )
}
