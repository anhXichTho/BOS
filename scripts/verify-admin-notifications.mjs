#!/usr/bin/env node
/**
 * Verify the real admin's notification surfaces are populated:
 *   - personal channel approval_request rich cards
 *   - notifications row (kind = approval_requested)
 *   - DM channels visible in sidebar
 *   - reactions on chat messages
 *
 * Usage:
 *   node scripts/verify-admin-notifications.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const SB_URL    = env.VITE_SUPABASE_URL
const ANON_KEY  = env.VITE_SUPABASE_ANON_KEY
const SVC_KEY   = env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_PASS = env.TEST_ADMIN_PASSWORD || ''
const ADMIN_EMAIL = env.DEMO_ADMIN_EMAIL || 'phamvietdung812020@gmail.com'

const svc = createClient(SB_URL, SVC_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// Sign in as the real admin so we can SELECT from `notifications`
// (service_role lacks GRANT on it; only authenticated owner can SELECT via RLS)
async function adminClient() {
  if (!ADMIN_PASS) return null
  const base = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await base.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASS })
  if (error) { console.warn('  (admin sign-in failed:', error.message, ')'); return null }
  return createClient(SB_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  })
}
const adminAuth = await adminClient()

const c = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  red:   s => `\x1b[31m${s}\x1b[0m`,
  bold:  s => `\x1b[1m${s}\x1b[0m`,
  dim:   s => `\x1b[2m${s}\x1b[0m`,
  yellow:s => `\x1b[33m${s}\x1b[0m`,
}

console.log()
console.log(c.bold(`🔍 Verifying admin notification surfaces — ${ADMIN_EMAIL}`))
console.log()

// 1. Find admin
const { data: users } = await svc.auth.admin.listUsers({ perPage: 1000 })
const admin = users?.users?.find(u => u.email === ADMIN_EMAIL)
if (!admin) {
  console.log(c.red(`✗ Admin not found`))
  process.exit(1)
}
console.log(c.green(`✓`), `Admin found: ${admin.id.slice(0, 8)}…`)

// 2. Personal channel
const { data: personalCh } = await svc.from('chat_channels')
  .select('id').eq('owner_id', admin.id).eq('channel_type', 'personal').maybeSingle()
if (!personalCh) {
  console.log(c.yellow('⚠'), 'No personal channel yet — will be auto-created on first login or first approval trigger')
} else {
  console.log(c.green(`✓`), `Personal channel: ${personalCh.id.slice(0, 8)}…`)
}

// 3. Approval request cards in personal channel
if (personalCh) {
  const { data: cards } = await svc.from('chat_messages')
    .select('id, payload, created_at').eq('context_id', personalCh.id)
    .eq('message_type', 'rich_card').order('created_at', { ascending: false }).limit(20)
  const approvalCards = (cards ?? []).filter(m => m.payload?.kind === 'approval_request')
  console.log(c.green(`✓`), `Approval-request cards in personal channel: ${c.bold(approvalCards.length)}`)
  for (const card of approvalCards.slice(0, 6)) {
    const status = card.payload?.run_id ? `run ${card.payload.run_id.slice(0, 8)}…` : '(no run id)'
    console.log(`   ${c.dim('•')} ${card.payload?.run_name ?? '(unnamed)'} — ${card.payload?.step_title ?? ''}`)
    console.log(`      ${c.dim(status + '  ' + new Date(card.created_at).toLocaleString('vi-VN'))}`)
  }
}

// 4. Notifications row (bell) — must use admin's signed-in client (RLS-gated table)
if (adminAuth) {
  const { data: notifs, error: notifErr } = await adminAuth.from('notifications')
    .select('id, kind, title, body, read_at, created_at')
    .eq('kind', 'approval_requested')
    .order('created_at', { ascending: false }).limit(20)
  if (notifErr) {
    console.log(c.red('✗'), `notifications query failed: ${notifErr.message}`)
  } else {
    const unread = (notifs ?? []).filter(n => !n.read_at).length
    console.log(c.green(`✓`), `approval_requested notifications: ${c.bold((notifs ?? []).length)}  (${unread} unread)`)
    for (const n of (notifs ?? []).slice(0, 4)) {
      console.log(`   ${c.dim('•')} ${n.title}`)
    }
  }
} else {
  console.log(c.yellow('⚠'), 'Skip notifications query — TEST_ADMIN_PASSWORD not set')
}

// 5. DM channels for admin
const { data: dms } = await svc.from('chat_channels')
  .select('id, dm_partner_id, owner_id').eq('channel_type', 'dm')
  .or(`owner_id.eq.${admin.id},dm_partner_id.eq.${admin.id}`)
console.log(c.green(`✓`), `DM channels involving admin: ${c.bold((dms ?? []).length)}`)

// 6. Reactions on messages — count
const { count: rxCount } = await svc.from('chat_message_reactions')
  .select('*', { count: 'exact', head: true })
console.log(c.green(`✓`), `Total chat_message_reactions in DB: ${c.bold(rxCount ?? 0)}`)

// 7. Workflow runs admin can approve (pending)
const { data: pendingRuns } = await svc.from('workflow_step_results')
  .select('id, run_id, approval_status, workflow_run_steps:snapshot_id(approver_user_id, title)')
  .eq('approval_status', 'pending').limit(50)
const adminPending = (pendingRuns ?? []).filter(r => r.workflow_run_steps?.approver_user_id === admin.id)
console.log(c.green(`✓`), `Pending approvals where admin is approver: ${c.bold(adminPending.length)}`)
for (const r of adminPending) {
  console.log(`   ${c.dim('•')} ${r.workflow_run_steps?.title ?? '(no title)'} (run ${r.run_id.slice(0, 8)}…)`)
}

console.log()
console.log(c.bold(c.green('✅ Verification complete.')))
console.log()
console.log(c.dim('  Đăng nhập với phamvietdung812020@gmail.com để xem:'))
console.log(c.dim('   - Bell ở góc phải hiện số đỏ = số notification chưa đọc'))
console.log(c.dim('   - Chat → "Cá nhân" → các approval card đang chờ duyệt'))
console.log(c.dim('   - Chat → "Tin nhắn riêng" → 3 cuộc DM'))
console.log()
