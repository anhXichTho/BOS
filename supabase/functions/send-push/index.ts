// Supabase Edge Function: send-push
//
// Receives { user_id, title, body, url, tag } from the fan_out_push DB trigger.
// Looks up all push subscriptions for that user and sends a Web Push notification
// to each one, removing expired subscriptions automatically.
//
// VAPID keys are loaded via the get_vapid_keys() SECURITY DEFINER RPC (reads vault)
// or fall back to Edge Function Secrets.
// To update VAPID keys without redeploying: update vault via SQL:
//   select vault.update_secret('<id>', '<new_val>', 'vapid_public_key');
//   select vault.update_secret('<id>', '<new_val>', 'vapid_private_key');

// @ts-expect-error Deno runtime
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
// @ts-expect-error Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
// @ts-expect-error npm specifier
import webpush from 'npm:web-push@3.6.7'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

interface PushPayload {
  user_id: string
  title:   string
  body:    string
  url?:    string
  tag?:    string
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS })
    }

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Load VAPID keys — get_vapid_keys() RPC reads vault via SECURITY DEFINER,
    // bypassing the PostgREST vault schema restriction.
    let VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? ''
    let VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
    let VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT')     ?? 'mailto:admin@example.com'

    try {
      const { data: keys, error: rpcErr } = await svc.rpc('get_vapid_keys')
      if (rpcErr) {
        console.warn('[send-push] get_vapid_keys rpc error:', rpcErr.message)
      } else if (keys) {
        if (keys.vapid_public_key)  VAPID_PUBLIC_KEY  = keys.vapid_public_key
        if (keys.vapid_private_key) VAPID_PRIVATE_KEY = keys.vapid_private_key
        if (keys.vapid_subject)     VAPID_SUBJECT     = keys.vapid_subject
        console.log('[send-push] VAPID loaded via rpc pub_prefix=' + VAPID_PUBLIC_KEY.slice(0, 12))
      }
    } catch (e) {
      console.warn('[send-push] vault read skipped, using env secrets:', String(e))
    }

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      console.warn('[send-push] VAPID keys not configured — skipping')
      return new Response(JSON.stringify({ skipped: true, reason: 'VAPID not configured' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    const { user_id, title, body, url, tag }: PushPayload = await req.json()
    if (!user_id) {
      return new Response('Missing user_id', { status: 400, headers: CORS })
    }

    const { data: subs, error: subErr } = await svc
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', user_id)

    if (subErr) {
      console.error('[send-push] query error:', subErr.message)
      return new Response(JSON.stringify({ error: subErr.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (!subs?.length) {
      return new Response(JSON.stringify({ sent: 0 }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const payload = JSON.stringify({ title, body, url: url ?? '/', tag: tag ?? 'bos' })

    const results = await Promise.allSettled(
      subs.map((sub: { endpoint: string; p256dh: string; auth: string }) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
      )
    )

    // Remove subscriptions that returned 410 Gone or 404 Not Found (expired)
    const expiredEndpoints: string[] = []
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const err = result.reason as { statusCode?: number; body?: string; message?: string }
        const sc = err?.statusCode ?? 'unknown'
        if (sc === 410 || sc === 404) {
          expiredEndpoints.push(subs[i].endpoint)
        }
        console.error('[send-push] send failed status=' + sc + ' body=' + (err?.body ?? err?.message ?? String(result.reason)))
      }
    })

    if (expiredEndpoints.length) {
      await svc.from('push_subscriptions').delete().in('endpoint', expiredEndpoints)
      console.log(`[send-push] removed ${expiredEndpoints.length} expired subscription(s)`)
    }

    const sent = results.filter(r => r.status === 'fulfilled').length
    console.log(`[send-push] sent=${sent} to user=${user_id}`)

    return new Response(JSON.stringify({ sent }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[send-push] unexpected error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
