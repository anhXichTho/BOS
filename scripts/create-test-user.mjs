// One-shot script to create a regular ("member" role) test user.
// Usage: node scripts/create-test-user.mjs
//
// Requires .env with:
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Creates: test-user@xichtho.local / Test@2026
//   role: member (NOT admin/editor)

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

if (!url || !svc) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const sb = createClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } })

const EMAIL    = 'test-user@xichtho.local'
const PASSWORD = 'Test@2026'
const FULLNAME = 'Người Dùng Test'
const ROLE     = 'user'

async function main() {
  console.log(`Creating ${EMAIL} ...`)

  // 1. Try to create. If already exists, look it up.
  let userId
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  })

  if (createErr) {
    if (createErr.message?.toLowerCase().includes('already')) {
      console.log('  user exists — looking up ID')
      const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 })
      userId = list?.users.find(u => u.email === EMAIL)?.id
      if (!userId) {
        console.error('  ❌ user exists but not found in list')
        process.exit(1)
      }
    } else {
      console.error('  ❌ createUser failed:', createErr.message)
      process.exit(1)
    }
  } else {
    userId = created.user.id
    console.log(`  ✓ created user id=${userId}`)
  }

  // 2. Upsert profile row
  const { error: profErr } = await sb.from('profiles').upsert({
    id: userId,
    full_name: FULLNAME,
    role: ROLE,
  })

  if (profErr) {
    console.error('  ❌ profile upsert failed:', profErr.message)
    process.exit(1)
  }
  console.log(`  ✓ profile upserted: ${FULLNAME} (${ROLE})`)

  console.log('\n✅ Done — login with:')
  console.log(`   email:    ${EMAIL}`)
  console.log(`   password: ${PASSWORD}`)
}

main().catch(err => { console.error('Unexpected:', err); process.exit(1) })
