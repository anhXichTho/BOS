/**
 * usePushSubscription
 * Manages the browser's Web Push subscription:
 *   - Checks browser support & current permission
 *   - subscribe()  → request permission → subscribe → persist to push_subscriptions
 *   - unsubscribe() → remove from SW → delete from DB
 *
 * The VAPID public key is read from VITE_VAPID_PUBLIC_KEY.
 * If the env var is missing, push is silently disabled.
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/** Convert a URL-safe base64 string to ArrayBuffer (needed by pushManager.subscribe) */
function urlB64ToArrayBuffer(b64url: string): ArrayBuffer {
  const padding = '='.repeat((4 - (b64url.length % 4)) % 4)
  const b64 = (b64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const buf = new ArrayBuffer(raw.length)
  const arr = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return buf
}

export type PushPermission = NotificationPermission | 'unsupported'

export interface PushSubscriptionState {
  /** true if the browser supports push notifications */
  isSupported: boolean
  /** true on iOS (WebKit) — push only works after Add to Home Screen on iOS 16.4+ */
  isIOS: boolean
  /** 'default' | 'granted' | 'denied' | 'unsupported' */
  permission: PushPermission
  /** true if a push subscription is currently active */
  subscribed: boolean
  loading: boolean
  /** Request permission + subscribe + persist to DB. Returns null on success, error message on failure. */
  subscribe: () => Promise<string | null>
  /** Unsubscribe from push + remove from DB */
  unsubscribe: () => Promise<void>
}

export function usePushSubscription(): PushSubscriptionState {
  const isSupported =
    typeof window !== 'undefined' &&
    'Notification'     in window &&
    'serviceWorker'    in navigator &&
    'PushManager'      in window &&
    !!VAPID_PUBLIC_KEY

  // iOS (iPhone/iPad) uses WebKit — PushManager is only available when running
  // as an installed PWA (Add to Home Screen) on iOS 16.4+. Export this flag so
  // the UI can show a helpful "install as PWA" hint instead of hiding the section.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)

  const [permission, setPermission] = useState<PushPermission>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [loading,    setLoading]    = useState(false)

  useEffect(() => {
    if (!isSupported) { setPermission('unsupported'); return }
    setPermission(Notification.permission)
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub  => setSubscribed(!!sub))
      .catch(() => {/* migration not run yet or SW not available */})
  }, [isSupported])

  const subscribe = useCallback(async (): Promise<string | null> => {
    if (!isSupported || !VAPID_PUBLIC_KEY) return 'Trình duyệt không hỗ trợ push.'
    setLoading(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm === 'denied') return 'Trình duyệt đã chặn thông báo. Vào cài đặt trình duyệt để cấp quyền.'
      if (perm !== 'granted') return null // user dismissed — silent

      // Timeout serviceWorker.ready so a hanging SW doesn't lock the button forever
      const swReady = Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Service worker timeout')), 8000)
        ),
      ])
      const reg = await swReady
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlB64ToArrayBuffer(VAPID_PUBLIC_KEY),
      })

      const { endpoint } = sub
      const keys = sub.toJSON().keys as { p256dh: string; auth: string }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return 'Phiên đăng nhập hết hạn — vui lòng đăng nhập lại.'

      const { error } = await supabase
        .from('push_subscriptions')
        .upsert(
          { user_id: session.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
          { onConflict: 'user_id,endpoint' }
        )

      if (error) return `Lưu subscription thất bại: ${error.message}`

      setSubscribed(true)
      return null
    } catch (err) {
      console.error('[push] subscribe error:', err)
      return `Lỗi: ${(err as Error).message}`
    } finally {
      setLoading(false)
    }
  }, [isSupported])

  const unsubscribe = useCallback(async () => {
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch (err) {
      console.error('[push] unsubscribe error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  return { isSupported, isIOS, permission, subscribed, loading, subscribe, unsubscribe }
}
