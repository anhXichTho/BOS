// One-shot: create a "leader" role test user.
// Usage: node scripts/create-leader-user.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync('.env', 'utf8').split('\n')
        .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
    )
  } catch { return {} }
}
const env = loadEnv()
const url = env.VITE_SUPABASE_URL        || process.env.VITE_SUPABASE_URL
const svc = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !svc) { console.error('Missing env'); process.exit(1) }

const sb = createClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } })

const EMAIL    = 'leader@xichtho.local'
const PASSWORD = 'Leader@2026'
const FULLNAME = 'Leader Test'
const ROLE     = 'leader'

async function main() {
  let userId
  const { data: created, error } = await sb.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
  })
  if (error?.message?.toLowerCase().includes('already')) {
    const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 })
    userId = list?.users.find(u => u.email === EMAIL)?.id
    console.log('user exists, id=' + userId)
  } else if (error) {
    console.error('createUser failed:', error.message); process.exit(1)
  } else {
    userId = created.user.id
    console.log('✓ created user id=' + userId)
  }

  // Try with target role first; if constraint blocks (migration #35 not run yet),
  // fall back to 'user' and tell the caller to run migration + change role manually.
  let { error: pErr } = await sb.from('profiles').upsert({ id: userId, full_name: FULLNAME, role: ROLE })
  if (pErr?.message?.includes('profiles_role_check')) {
    console.warn('⚠️  Migration #35 (leader role) chưa chạy — tạm set role=user')
    const r2 = await sb.from('profiles').upsert({ id: userId, full_name: FULLNAME, role: 'user' })
    pErr = r2.error
    if (!pErr) console.warn('   Sau khi chạy migration_phase_leader_role.sql, vào Settings → đổi role thành Leader')
  }
  if (pErr) { console.error('profile upsert failed:', pErr.message); process.exit(1) }

  console.log('\n✅ Login với:')
  console.log('   email:    ' + EMAIL)
  console.log('   password: ' + PASSWORD)
  console.log('   role:     ' + ROLE)
}

main().catch(e => { console.error(e); process.exit(1) })
