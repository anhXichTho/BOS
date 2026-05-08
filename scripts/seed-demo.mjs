#!/usr/bin/env node
/**
 * Minh Phúc Food & Household Goods — Demo Data Seed
 *
 * Simulates a real retail company with 3 stores + HO, 25 employees,
 * 8 workflow templates (shop-ops focus), realistic chat and run history.
 *
 * Usage:
 *   node scripts/seed-demo.mjs           # seed demo data (idempotent)
 *   node scripts/seed-demo.mjs --reset   # wipe @minhphuc.vn users + data, then re-seed
 *   node scripts/seed-demo.mjs --wipe    # wipe only (no re-seed)
 *
 * Requires in .env:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional:
 *   DEMO_PASSWORD   (default: MinhPhuc@2025!)
 *
 * IMPORTANT: Run supabase/seed_demo_grants.sql in Supabase SQL Editor ONCE
 * before the first run — it grants service_role the table-level privileges
 * needed to write data while bypassing RLS.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

// ─── Env ──────────────────────────────────────────────────────────────────────

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync('.env', 'utf8').split('\n')
        .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
    )
  } catch { return {} }
}
const env       = loadEnv()
const SB_URL    = env.VITE_SUPABASE_URL        || process.env.VITE_SUPABASE_URL        || ''
const SVC_KEY   = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const DEMO_PASS = env.DEMO_PASSWORD             || process.env.DEMO_PASSWORD             || 'MinhPhuc@2025!'

// Real admin (the human who logs in to test). Used for admin-targeted
// approval scenarios so the bell + personal channel light up when they sign in.
const REAL_ADMIN_EMAIL = env.DEMO_ADMIN_EMAIL || process.env.DEMO_ADMIN_EMAIL
                         || 'phamvietdung812020@gmail.com'

const ARGS  = process.argv.slice(2)
const RESET = ARGS.includes('--reset')
const WIPE  = ARGS.includes('--wipe')

if (!SB_URL || !SVC_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

// svc: service_role key — bypasses RLS for all table operations.
// IMPORTANT: run supabase/seed_demo_grants.sql first so service_role
// has the table-level privileges required (bypass RLS ≠ bypass GRANT).
const svc = createClient(SB_URL, SVC_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// ─── Console helpers ──────────────────────────────────────────────────────────

const c = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  blue:   s => `\x1b[34m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
}
const ok   = msg => console.log(`  ${c.green('✓')} ${msg}`)
const info = msg => console.log(`  ${c.blue('·')} ${msg}`)
const warn = msg => console.log(`  ${c.yellow('!')} ${msg}`)
const fail = msg => console.log(`  ${c.red('✗')} ${msg}`)
const step = msg => console.log(`\n${c.bold(msg)}`)

// ─── Time helpers ─────────────────────────────────────────────────────────────

const daysAgo  = n => new Date(Date.now() - n * 86400_000).toISOString()
const hoursAgo = n => new Date(Date.now() - n * 3600_000).toISOString()

// ─── People ───────────────────────────────────────────────────────────────────

const PEOPLE = [
  // ── Admin ──
  { key: 'giamDoc',  email: 'nguyen.minhphuc@minhphuc.vn',  name: 'Nguyễn Minh Phúc',   role: 'admin',  title: 'Giám đốc' },
  { key: 'ketoan',   email: 'tran.thilan@minhphuc.vn',       name: 'Trần Thị Lan',        role: 'admin',  title: 'Kế toán trưởng' },
  // ── Editor ──
  { key: 'qlQ1',     email: 'le.vanhung@minhphuc.vn',        name: 'Lê Văn Hùng',         role: 'editor', title: 'Quản lý CH Quận 1' },
  { key: 'qlQ3',     email: 'pham.thihoa@minhphuc.vn',       name: 'Phạm Thị Hoa',        role: 'editor', title: 'Quản lý CH Quận 3' },
  { key: 'qlBT',     email: 'do.vannam@minhphuc.vn',         name: 'Đỗ Văn Nam',          role: 'editor', title: 'Quản lý CH Bình Thạnh' },
  { key: 'tpKD',     email: 'vu.thimai@minhphuc.vn',         name: 'Vũ Thị Mai',          role: 'editor', title: 'Trưởng phòng Kinh doanh' },
  { key: 'tkhoHO',   email: 'hoang.vankhoa@minhphuc.vn',     name: 'Hoàng Văn Khoa',      role: 'editor', title: 'Thủ kho Trung tâm' },
  // ── Viewer — Quận 1 ──
  { key: 'nvQ1_1',   email: 'nguyen.vanan@minhphuc.vn',      name: 'Nguyễn Văn An',       role: 'user',   title: 'NVBH Quận 1' },
  { key: 'nvQ1_2',   email: 'tran.thibich@minhphuc.vn',      name: 'Trần Thị Bích',       role: 'user',   title: 'NVBH Quận 1' },
  { key: 'nvQ1_3',   email: 'le.vancuong@minhphuc.vn',       name: 'Lê Văn Cường',        role: 'user',   title: 'NVBH Quận 1' },
  { key: 'nvQ1_4',   email: 'pham.vandung@minhphuc.vn',      name: 'Phạm Văn Dũng',       role: 'user',   title: 'NVBH Quận 1' },
  { key: 'nvQ1_5',   email: 'do.thien@minhphuc.vn',          name: 'Đỗ Thị Én',           role: 'user',   title: 'NVBH Quận 1' },
  { key: 'tkhoQ1',   email: 'nguyen.vanquan@minhphuc.vn',    name: 'Nguyễn Văn Quân',     role: 'user',   title: 'Thủ kho Quận 1' },
  // ── Viewer — Quận 3 ──
  { key: 'nvQ3_1',   email: 'vu.vanphong@minhphuc.vn',       name: 'Vũ Văn Phong',        role: 'user',   title: 'NVBH Quận 3' },
  { key: 'nvQ3_2',   email: 'hoang.thigiang@minhphuc.vn',    name: 'Hoàng Thị Giang',     role: 'user',   title: 'NVBH Quận 3' },
  { key: 'nvQ3_3',   email: 'bui.vanhai@minhphuc.vn',        name: 'Bùi Văn Hải',         role: 'user',   title: 'NVBH Quận 3' },
  { key: 'nvQ3_4',   email: 'dinh.thiyen@minhphuc.vn',       name: 'Đinh Thị Yến',        role: 'user',   title: 'NVBH Quận 3' },
  { key: 'nvQ3_5',   email: 'ngo.vankien@minhphuc.vn',       name: 'Ngô Văn Kiên',        role: 'user',   title: 'NVBH Quận 3' },
  { key: 'tkhoQ3',   email: 'tran.vanrong@minhphuc.vn',      name: 'Trần Văn Rồng',       role: 'user',   title: 'Thủ kho Quận 3' },
  // ── Viewer — Bình Thạnh ──
  { key: 'nvBT_1',   email: 'phan.thiloan@minhphuc.vn',      name: 'Phan Thị Loan',       role: 'user',   title: 'NVBH Bình Thạnh' },
  { key: 'nvBT_2',   email: 'truong.vanminh@minhphuc.vn',    name: 'Trương Văn Minh',     role: 'user',   title: 'NVBH Bình Thạnh' },
  { key: 'nvBT_3',   email: 'ly.thinhi@minhphuc.vn',         name: 'Lý Thị Nhi',          role: 'user',   title: 'NVBH Bình Thạnh' },
  { key: 'nvBT_4',   email: 'cao.vanon@minhphuc.vn',         name: 'Cao Văn Ôn',          role: 'user',   title: 'NVBH Bình Thạnh' },
  { key: 'nvBT_5',   email: 'duong.thiphuong@minhphuc.vn',   name: 'Dương Thị Phượng',    role: 'user',   title: 'NVBH Bình Thạnh' },
  { key: 'tkhoBT',   email: 'le.thisuong@minhphuc.vn',       name: 'Lê Thị Sương',        role: 'user',   title: 'Thủ kho Bình Thạnh' },
]

// ─── Wipe ─────────────────────────────────────────────────────────────────────

async function wipe() {
  step('🗑  Wiping demo data (@minhphuc.vn users and linked content)…')

  const { data: authUsers } = await svc.auth.admin.listUsers({ perPage: 1000 })
  const demoUsers = (authUsers?.users ?? []).filter(u => u.email?.endsWith('@minhphuc.vn'))
  info(`Found ${demoUsers.length} demo auth users`)

  const demoIds = demoUsers.map(u => u.id)

  if (demoIds.length) {
    // Delete team channels (personal channels cascade via profile delete)
    const { error: e1 } = await svc.from('chat_channels').delete()
      .in('created_by', demoIds).is('owner_id', null)
    if (e1) warn(`chat_channels delete: ${e1.message}`)

    const { error: e2 } = await svc.from('projects').delete().in('created_by', demoIds)
    if (e2) warn(`projects delete: ${e2.message}`)

    const { error: e3 } = await svc.from('form_templates').delete().in('created_by', demoIds)
    if (e3) warn(`form_templates delete: ${e3.message}`)

    const { error: e4 } = await svc.from('workflow_templates').delete().in('created_by', demoIds)
    if (e4) warn(`workflow_templates delete: ${e4.message}`)

    const { error: e5 } = await svc.from('user_groups').delete().in('created_by', demoIds)
    if (e5) warn(`user_groups delete: ${e5.message}`)
  }

  let deleted = 0
  for (const u of demoUsers) {
    const { error } = await svc.auth.admin.deleteUser(u.id)
    if (error) warn(`Could not delete ${u.email}: ${error.message}`)
    else deleted++
  }

  ok(`Deleted ${deleted} demo auth users and linked data`)
}

// ─── Main seed ────────────────────────────────────────────────────────────────

async function seed() {
  // ── 1. Create auth users ───────────────────────────────────────────────────
  step('👥 Creating 25 demo users…')

  const ids = {}   // key → uuid

  const { data: existingAuth } = await svc.auth.admin.listUsers({ perPage: 1000 })
  const existingByEmail = Object.fromEntries(
    (existingAuth?.users ?? []).map(u => [u.email, u.id])
  )

  for (const p of PEOPLE) {
    if (existingByEmail[p.email]) {
      ids[p.key] = existingByEmail[p.email]
      info(`${p.name} already exists`)
      continue
    }
    const { data, error } = await svc.auth.admin.createUser({
      email: p.email,
      password: DEMO_PASS,
      email_confirm: true,
      user_metadata: { full_name: p.name },
    })
    if (error) { fail(`Failed to create ${p.email}: ${error.message}`); continue }
    ids[p.key] = data.user.id
    ok(`Created ${p.name} (${p.role})`)
  }

  // ── 2. Update profiles (role + title) ─────────────────────────────────────
  // Uses service_role directly — bypasses RLS, requires seed_demo_grants.sql
  let profileErrors = 0
  for (const p of PEOPLE) {
    if (!ids[p.key]) continue
    const { error } = await svc.from('profiles')
      .update({ full_name: p.name, role: p.role })
      .eq('id', ids[p.key])
    if (error) {
      fail(`Profile update failed for ${p.name}: ${error.message}`)
      if (error.message.includes('permission denied')) {
        console.error(c.red('\n  ⚠️  SERVICE_ROLE is missing table grants.'))
        console.error(c.red('     Run supabase/seed_demo_grants.sql in Supabase SQL Editor first.\n'))
        process.exit(1)
      }
      profileErrors++
    }
  }
  if (profileErrors === 0) ok('Profiles updated with roles and names')

  const P = ids  // alias

  // ── 3. User groups ─────────────────────────────────────────────────────────
  step('🏷  Creating user groups…')

  const groupDefs = [
    { name: 'Ban Giám đốc',               color: '#1a56db', description: 'Giám đốc và kế toán trưởng',           members: ['giamDoc','ketoan'] },
    { name: 'HO – Kinh doanh & Kế toán',  color: '#0694a2', description: 'Phòng kinh doanh và kế toán HO',       members: ['ketoan','tpKD','tkhoHO'] },
    { name: 'Cửa hàng Quận 1',            color: '#057a55', description: 'Toàn bộ nhân sự cửa hàng Quận 1',      members: ['qlQ1','nvQ1_1','nvQ1_2','nvQ1_3','nvQ1_4','nvQ1_5','tkhoQ1'] },
    { name: 'Cửa hàng Quận 3',            color: '#c27803', description: 'Toàn bộ nhân sự cửa hàng Quận 3',      members: ['qlQ3','nvQ3_1','nvQ3_2','nvQ3_3','nvQ3_4','nvQ3_5','tkhoQ3'] },
    { name: 'Cửa hàng Bình Thạnh',        color: '#9f1239', description: 'Toàn bộ nhân sự cửa hàng Bình Thạnh', members: ['qlBT','nvBT_1','nvBT_2','nvBT_3','nvBT_4','nvBT_5','tkhoBT'] },
    { name: 'Kho & Vận chuyển',           color: '#5521b5', description: 'Thủ kho tất cả điểm + quản lý kho',    members: ['tkhoHO','tkhoQ1','tkhoQ3','tkhoBT'] },
  ]

  const groupIds = {}
  for (const g of groupDefs) {
    const { data: existing } = await svc.from('user_groups').select('id').eq('name', g.name).maybeSingle()
    let gid
    if (existing) {
      gid = existing.id
      info(`Group "${g.name}" already exists`)
    } else {
      const { data, error } = await svc.from('user_groups')
        .insert({ name: g.name, description: g.description, color: g.color, created_by: P.giamDoc })
        .select('id').single()
      if (error) { fail(`Group "${g.name}": ${error.message}`); continue }
      gid = data.id
      ok(`Group: ${g.name}`)
    }
    groupIds[g.name] = gid

    for (const k of g.members) {
      if (!P[k]) continue
      await svc.from('user_group_members').insert({ group_id: gid, user_id: P[k] })
        .then(() => {})  // ignore duplicates
    }
  }

  // ── 4. Chat channels ───────────────────────────────────────────────────────
  step('💬 Creating team channels…')

  const channelDefs = [
    { name: 'chung',               description: 'Kênh thông báo chung toàn công ty' },
    { name: 'ban-giam-doc',        description: 'Kênh nội bộ ban lãnh đạo' },
    { name: 'kinh-doanh',          description: 'Báo cáo doanh số và kế hoạch kinh doanh' },
    { name: 'kho-van-chuyen',      description: 'Điều phối kho và vận chuyển hàng hóa' },
    { name: 'cua-hang-quan-1',     description: 'Nhóm cửa hàng Quận 1' },
    { name: 'cua-hang-quan-3',     description: 'Nhóm cửa hàng Quận 3' },
    { name: 'cua-hang-binh-thanh', description: 'Nhóm cửa hàng Bình Thạnh' },
  ]

  const chIds = {}
  for (const ch of channelDefs) {
    const { data: existing } = await svc.from('chat_channels')
      .select('id').eq('name', ch.name).eq('channel_type', 'team').maybeSingle()
    if (existing) { chIds[ch.name] = existing.id; info(`Channel #${ch.name} already exists`); continue }
    const { data, error } = await svc.from('chat_channels')
      .insert({ name: ch.name, description: ch.description, channel_type: 'team', created_by: P.giamDoc })
      .select('id').single()
    if (error) { fail(`Channel #${ch.name}: ${error.message}`); continue }
    chIds[ch.name] = data.id
    ok(`Channel #${ch.name}`)
  }

  // ── 5. Projects ────────────────────────────────────────────────────────────
  step('📁 Creating projects…')

  const projectDefs = [
    {
      title: 'Khai trương cửa hàng Quận 1',
      slug: 'khai-truong-quan-1',
      description: 'Toàn bộ công tác chuẩn bị và khai trương cửa hàng tại 42 Nguyễn Trãi, Quận 1.',
      status: 'completed',
      assigned_to: P.qlQ1,
      due_date: daysAgo(60).slice(0, 10),
    },
    {
      title: 'Chiến dịch Tết Ất Tỵ 2025',
      slug: 'chien-dich-tet-at-ty-2025',
      description: 'Kế hoạch kinh doanh và khuyến mại mùa Tết 2025. Target: tăng 40% doanh số tháng 1-2.',
      status: 'in_progress',
      assigned_to: P.tpKD,
      due_date: daysAgo(-30).slice(0, 10),
    },
    {
      title: 'Nâng cấp hệ thống POS toàn hệ thống',
      slug: 'nang-cap-pos-2025',
      description: 'Triển khai phần mềm POS mới tích hợp quản lý kho realtime cho cả 3 cửa hàng.',
      status: 'review',
      assigned_to: P.giamDoc,
      due_date: daysAgo(-14).slice(0, 10),
    },
    {
      title: 'Mở rộng cửa hàng thứ 4 – Quận 7',
      slug: 'mo-rong-quan-7',
      description: 'Khảo sát mặt bằng, xây dựng kế hoạch đầu tư và mở cửa hàng tại Quận 7.',
      status: 'open',
      assigned_to: P.giamDoc,
      due_date: daysAgo(-120).slice(0, 10),
    },
  ]

  const projIds = {}
  for (const p of projectDefs) {
    const { data: existing } = await svc.from('projects').select('id').eq('slug', p.slug).maybeSingle()
    if (existing) { projIds[p.slug] = existing.id; info(`Project "${p.title}" already exists`); continue }
    const { data, error } = await svc.from('projects')
      .insert({ ...p, created_by: P.giamDoc })
      .select('id').single()
    if (error) { fail(`Project "${p.title}": ${error.message}`); continue }
    projIds[p.slug] = data.id
    ok(`Project: ${p.title}`)
  }

  // ── 6. Form templates ──────────────────────────────────────────────────────
  step('📋 Creating form templates…')

  const formDefs = [
    {
      name: 'Biên bản mở cửa hàng',
      description: 'Kiểm tra tình trạng cửa hàng khi mở cửa đầu ngày',
      summaryFields: ['mo_tinhtrang', 'mo_nhanvien'],
      fields: [
        { id: 'mo_tinhtrang', label: 'Tình trạng cửa hàng khi mở', type: 'select', required: true,
          options: ['Bình thường', 'Có vấn đề nhỏ – đã xử lý', 'Cần báo cáo cấp trên'] },
        { id: 'mo_nhanvien',  label: 'Số nhân viên có mặt', type: 'number', required: true,
          validation: { min: 1, max: 20 } },
        { id: 'mo_thietbi',   label: 'Tình trạng thiết bị (máy lạnh, đèn, camera)', type: 'textarea', required: false,
          placeholder: 'Mô tả nếu có hư hỏng…' },
        { id: 'mo_hangton',   label: 'Hàng trưng bày đầy đủ?', type: 'radio', required: true,
          options: ['Có, đầy đủ', 'Thiếu một số mặt hàng', 'Cần bổ sung gấp'] },
        { id: 'mo_ghichu',    label: 'Ghi chú thêm', type: 'textarea', required: false,
          placeholder: 'Thông tin bổ sung nếu có…' },
      ],
    },
    {
      name: 'Biên bản đóng cửa hàng',
      description: 'Tổng kết và kiểm tra khi đóng cửa cuối ngày',
      summaryFields: ['dc_doanhthu', 'dc_sohoadon'],
      fields: [
        { id: 'dc_doanhthu',  label: 'Tổng doanh thu trong ngày (VND)', type: 'number', required: true,
          validation: { min: 0 } },
        { id: 'dc_sohoadon',  label: 'Số hóa đơn trong ngày', type: 'number', required: true,
          validation: { min: 0 } },
        { id: 'dc_hoantien',  label: 'Số tiền hoàn trả / hủy đơn (VND)', type: 'number', required: false,
          validation: { min: 0 } },
        { id: 'dc_tonkho',    label: 'Tình trạng tồn kho cuối ngày', type: 'select', required: true,
          options: ['Bình thường', 'Một số mặt hàng sắp hết', 'Cần đặt hàng gấp'] },
        { id: 'dc_anninh',    label: 'Kiểm tra an ninh – khóa cửa, tắt điện', type: 'radio', required: true,
          options: ['Đã kiểm tra đầy đủ', 'Có vấn đề – đã xử lý', 'Cần báo cáo'] },
        { id: 'dc_ghichu',    label: 'Ghi chú cuối ngày', type: 'textarea', required: false },
      ],
    },
    {
      name: 'Phiếu kiểm kê tồn kho',
      description: 'Biên bản kiểm kê hàng hóa định kỳ',
      summaryFields: ['kk_kykiem', 'kk_soluonglenh'],
      fields: [
        { id: 'kk_kykiem',     label: 'Kỳ kiểm kê', type: 'text', required: true,
          placeholder: 'VD: Tháng 5/2025' },
        { id: 'kk_diem',       label: 'Điểm kho', type: 'select', required: true,
          options: ['Kho HO', 'Kho Quận 1', 'Kho Quận 3', 'Kho Bình Thạnh'] },
        { id: 'kk_tong_sku',   label: 'Tổng SKU kiểm tra', type: 'number', required: true,
          validation: { min: 0 } },
        { id: 'kk_soluonglenh',label: 'Số SKU lệch so với hệ thống', type: 'number', required: true,
          validation: { min: 0 } },
        { id: 'kk_giatri',     label: 'Giá trị lệch ước tính (VND)', type: 'number', required: false,
          validation: { min: 0 } },
        { id: 'kk_nguyennhan', label: 'Nguyên nhân chênh lệch (nếu có)', type: 'textarea', required: false,
          placeholder: 'Mất mát, hư hỏng, nhập sai…' },
        { id: 'kk_dexuat',     label: 'Đề xuất xử lý', type: 'textarea', required: false },
      ],
    },
    {
      name: 'Báo cáo tổng kết đơn hàng',
      description: 'Tổng hợp đơn hàng theo ca / ngày',
      summaryFields: ['bctk_tong', 'bctk_doanhthu'],
      fields: [
        { id: 'bctk_ca',       label: 'Ca báo cáo', type: 'select', required: true,
          options: ['Ca sáng (7:00–13:00)', 'Ca chiều (13:00–19:00)', 'Cả ngày'] },
        { id: 'bctk_tong',     label: 'Tổng số đơn hàng', type: 'number', required: true,
          validation: { min: 0 } },
        { id: 'bctk_hoantat',  label: 'Đơn hoàn tất', type: 'number', required: true,
          validation: { min: 0 } },
        { id: 'bctk_huy',      label: 'Đơn hủy / trả', type: 'number', required: false,
          validation: { min: 0 } },
        { id: 'bctk_doanhthu', label: 'Tổng doanh thu (VND)', type: 'number', required: true,
          validation: { min: 0 } },
        { id: 'bctk_sanphamban', label: 'Sản phẩm bán chạy nhất', type: 'text', required: false,
          placeholder: 'VD: Nước mắm Phú Quốc 1L' },
        { id: 'bctk_ghichu',   label: 'Ghi chú', type: 'textarea', required: false },
      ],
    },
    {
      name: 'Biên bản chốt sổ quỹ',
      description: 'Kiểm đếm tiền mặt và đối chiếu sổ quỹ cuối ngày',
      summaryFields: ['csq_tienmat', 'csq_chenhlech'],
      fields: [
        { id: 'csq_tiendauky',    label: 'Tiền mặt đầu ca (VND)', type: 'number', required: true,
          validation: { min: 0 } },
        { id: 'csq_thutrongngay', label: 'Thu trong ngày (VND)', type: 'number', required: true,
          validation: { min: 0 } },
        { id: 'csq_chitrongngay', label: 'Chi trong ngày (VND)', type: 'number', required: false,
          validation: { min: 0 } },
        { id: 'csq_tienmat',      label: 'Tiền mặt thực tế cuối ca (VND)', type: 'number', required: true,
          validation: { min: 0 } },
        { id: 'csq_chenhlech',    label: 'Chênh lệch so với sổ sách (VND)', type: 'number', required: true },
        { id: 'csq_lydo',         label: 'Lý do chênh lệch (nếu có)', type: 'textarea', required: false,
          placeholder: 'Để trống nếu không có chênh lệch' },
        { id: 'csq_nguoikiem',    label: 'Người kiểm đếm', type: 'text', required: true },
      ],
    },
    {
      name: 'Phiếu điều hàng hóa',
      description: 'Yêu cầu điều chuyển hàng hóa giữa các kho',
      summaryFields: ['dh_tu', 'dh_den'],
      fields: [
        { id: 'dh_tu',          label: 'Từ kho', type: 'select', required: true,
          options: ['Kho HO', 'Kho Quận 1', 'Kho Quận 3', 'Kho Bình Thạnh'] },
        { id: 'dh_den',         label: 'Đến kho', type: 'select', required: true,
          options: ['Kho HO', 'Kho Quận 1', 'Kho Quận 3', 'Kho Bình Thạnh'] },
        { id: 'dh_ngay',        label: 'Ngày điều hàng dự kiến', type: 'date', required: true },
        { id: 'dh_danhsach',    label: 'Danh sách hàng hóa', type: 'textarea', required: true,
          placeholder: 'Tên hàng – Số lượng – Đơn vị\nVD: Nước mắm 500ml – 24 – thùng' },
        { id: 'dh_tongsoluong', label: 'Tổng số lượng (đơn vị)', type: 'number', required: true,
          validation: { min: 1 } },
        { id: 'dh_lydo',        label: 'Lý do điều hàng', type: 'select', required: true,
          options: ['Bổ sung hàng tồn thấp', 'Cân đối giữa kho', 'Đơn hàng đặc biệt', 'Khác'],
          allow_other: true },
        { id: 'dh_ghichu',      label: 'Ghi chú', type: 'textarea', required: false },
      ],
    },
    {
      name: 'Đề nghị thanh toán',
      description: 'Yêu cầu thanh toán chi phí hoặc mua sắm',
      summaryFields: ['dt_noidung', 'dt_sotien'],
      fields: [
        { id: 'dt_noidung',   label: 'Nội dung thanh toán', type: 'text', required: true,
          placeholder: 'VD: Sửa chữa máy lạnh cửa hàng Q1' },
        { id: 'dt_sotien',    label: 'Số tiền đề nghị (VND)', type: 'number', required: true,
          validation: { min: 1 } },
        { id: 'dt_loaichi',   label: 'Loại chi phí', type: 'select', required: true,
          options: ['Chi phí vận hành', 'Mua sắm tài sản', 'Sửa chữa – bảo trì', 'Marketing', 'Khác'],
          allow_other: true },
        { id: 'dt_nguoithu',  label: 'Đối tượng thụ hưởng', type: 'text', required: true,
          placeholder: 'Tên cá nhân hoặc công ty' },
        { id: 'dt_stk',       label: 'Số tài khoản / Số điện thoại ví', type: 'text', required: false,
          placeholder: 'STK ngân hàng hoặc Momo/ZaloPay' },
        { id: 'dt_nganhang',  label: 'Ngân hàng / Ví điện tử', type: 'text', required: false },
        { id: 'dt_chungtu',   label: 'Mô tả chứng từ đính kèm', type: 'textarea', required: false,
          placeholder: 'Hóa đơn, biên lai, báo giá…' },
        { id: 'dt_ghichu',    label: 'Ghi chú', type: 'textarea', required: false },
      ],
    },
    {
      name: 'Đơn xin nghỉ phép',
      description: 'Yêu cầu nghỉ phép của nhân viên',
      summaryFields: ['np_tungay', 'np_songay'],
      fields: [
        { id: 'np_tungay',   label: 'Nghỉ từ ngày', type: 'date', required: true },
        { id: 'np_denngay',  label: 'Đến hết ngày', type: 'date', required: true },
        { id: 'np_songay',   label: 'Số ngày nghỉ', type: 'number', required: true,
          validation: { min: 0.5, max: 30 } },
        { id: 'np_loainghỉ', label: 'Loại nghỉ phép', type: 'radio', required: true,
          options: ['Nghỉ phép năm', 'Nghỉ bệnh', 'Nghỉ việc riêng', 'Nghỉ không lương'] },
        { id: 'np_lydo',     label: 'Lý do', type: 'textarea', required: true,
          placeholder: 'Mô tả lý do nghỉ phép' },
        { id: 'np_bantrao',  label: 'Người bàn giao công việc', type: 'text', required: false,
          placeholder: 'Tên người bàn giao' },
        { id: 'np_ghichu',   label: 'Ghi chú', type: 'textarea', required: false },
      ],
    },
  ]

  const formIds = {}
  for (const f of formDefs) {
    const { data: existing } = await svc.from('form_templates').select('id').eq('name', f.name).maybeSingle()
    if (existing) { formIds[f.name] = existing.id; info(`Form "${f.name}" already exists`); continue }
    const { data, error } = await svc.from('form_templates').insert({
      name:             f.name,
      description:      f.description,
      fields:           f.fields,
      summary_field_ids: f.summaryFields,
      is_active:        true,
      created_by:       P.giamDoc,
    }).select('id').single()
    if (error) { fail(`Form "${f.name}": ${error.message}`); continue }
    formIds[f.name] = data.id
    ok(`Form: ${f.name}`)
  }

  // ── 7. Workflow templates + steps ──────────────────────────────────────────
  step('⚙️  Creating workflow templates…')

  async function makeWorkflow({ name, description, steps }) {
    const { data: existing } = await svc.from('workflow_templates').select('id').eq('name', name).maybeSingle()
    if (existing) { info(`Workflow "${name}" already exists`); return existing.id }

    const { data: wf, error: wfErr } = await svc.from('workflow_templates')
      .insert({ name, description, is_active: true, created_by: P.giamDoc })
      .select('id').single()
    if (wfErr) { fail(`Workflow "${name}": ${wfErr.message}`); return null }
    const wfId = wf.id

    const stepIds = {}   // label → id

    // Insert root steps in order, chained via parent_step_id so connectors render.
    // The first root has parent_step_id=null; each subsequent root parents to the
    // previous one (linear chain). Branches still fan out via children below.
    const rootDefs = steps.filter(s => !s.parentLabel).sort((a, b) => a.order - b.order)
    let prevRootId = null
    for (const s of rootDefs) {
      const { data: sd, error: sErr } = await svc.from('workflow_steps').insert({
        template_id:       wfId,
        parent_step_id:    prevRootId,        // null on first; chains thereafter
        branch_condition:  null,
        title:             s.title,
        description:       s.description ?? null,
        step_type:         s.branch ? 'branch' : 'simple',
        branch_options:    s.branch ?? null,
        order_index:       s.order,
        form_template_id:  s.formId ?? null,
        requires_approval: s.requiresApproval ?? false,
        approver_user_id:  s.approverUserId ?? null,
        approver_role:     s.approverRole ?? null,
        duration_hours:    s.duration ?? 1,
      }).select('id').single()
      if (sErr) { warn(`  Step "${s.title}": ${sErr.message}`); continue }
      stepIds[s.label ?? s.title] = sd.id
      prevRootId = sd.id
    }

    // Insert branch children
    for (const s of steps.filter(s => s.parentLabel)) {
      const parentId = stepIds[s.parentLabel]
      if (!parentId) { warn(`  Missing parent "${s.parentLabel}" for "${s.title}"`); continue }
      const { data: sd, error: sErr } = await svc.from('workflow_steps').insert({
        template_id:       wfId,
        parent_step_id:    parentId,
        branch_condition:  s.branchCondition ?? null,
        title:             s.title,
        description:       s.description ?? null,
        step_type:         'simple',
        branch_options:    null,
        order_index:       s.order,
        form_template_id:  s.formId ?? null,
        requires_approval: s.requiresApproval ?? false,
        approver_user_id:  s.approverUserId ?? null,
        approver_role:     s.approverRole ?? null,
        duration_hours:    s.duration ?? 1,
      }).select('id').single()
      if (sErr) { warn(`  Branch step "${s.title}": ${sErr.message}`); continue }
      stepIds[s.label ?? s.title] = sd.id
    }

    ok(`Workflow: ${name} (${Object.keys(stepIds).length} bước)`)
    return wfId
  }

  const wfIds = {}

  wfIds.moCuaHang = await makeWorkflow({
    name: 'Check in mở cửa hàng',
    description: 'Quy trình kiểm tra và mở cửa hàng đầu ngày',
    steps: [
      { order: 0, title: 'Đến cửa hàng & kiểm tra bên ngoài',
        description: 'Kiểm tra cửa, biển hiệu, bãi xe trước khi vào.', duration: 0.25 },
      { order: 1, title: 'Điền biên bản mở cửa hàng',
        description: 'Điền đầy đủ thông tin tình trạng cửa hàng khi mở.',
        formId: formIds['Biên bản mở cửa hàng'], duration: 0.25 },
      { order: 2, title: 'Báo cáo quản lý & mở bán',
        description: 'Gửi báo cáo tới quản lý, xác nhận mở bán chính thức.',
        requiresApproval: true, approverRole: 'editor', duration: 0.5 },
    ],
  })

  wfIds.dongCuaHang = await makeWorkflow({
    name: 'Đóng cửa hàng',
    description: 'Quy trình kiểm tra và đóng cửa hàng cuối ngày',
    steps: [
      { order: 0, title: 'Tổng kết doanh thu & điền báo cáo',
        description: 'Tổng hợp doanh số, số hóa đơn, điền form đóng cửa.',
        formId: formIds['Biên bản đóng cửa hàng'], duration: 0.5 },
      { order: 1, title: 'Kiểm tra thiết bị – an ninh',
        description: 'Tắt máy lạnh, đèn, khóa cửa, bật báo động.', duration: 0.25 },
      { order: 2, title: 'Quản lý xác nhận đóng cửa',
        description: 'Quản lý duyệt báo cáo và xác nhận đóng cửa.',
        requiresApproval: true, approverRole: 'editor', duration: 0.25 },
    ],
  })

  wfIds.kiemKe = await makeWorkflow({
    name: 'Kiểm kê tồn kho',
    description: 'Quy trình kiểm kê hàng hóa định kỳ tại các điểm kho',
    steps: [
      { order: 0, title: 'Khóa nhập xuất hàng trong kỳ kiểm kê',
        description: 'Thông báo tạm dừng nhập xuất, in danh sách tồn kho từ hệ thống.', duration: 0.5 },
      { order: 1, title: 'Đếm hàng thực tế & điền phiếu kiểm kê',
        description: 'Đếm từng SKU theo danh sách, ghi nhận số lượng thực tế.',
        formId: formIds['Phiếu kiểm kê tồn kho'], duration: 3 },
      { order: 2, title: 'Đối chiếu với hệ thống & xử lý lệch',
        description: 'So sánh số thực tế với số trên hệ thống, tìm nguyên nhân lệch.', duration: 1 },
      { order: 3, title: 'Thủ kho HO phê duyệt kết quả kiểm kê',
        description: 'Thủ kho trung tâm duyệt biên bản, xác nhận cập nhật số liệu.',
        requiresApproval: true, approverUserId: P.tkhoHO, duration: 1 },
    ],
  })

  wfIds.tongKetDonHang = await makeWorkflow({
    name: 'Tổng kết đơn hàng cuối ca',
    description: 'Báo cáo tổng hợp đơn hàng theo ca làm việc',
    steps: [
      { order: 0, title: 'Thu thập dữ liệu đơn hàng từ POS',
        description: 'In báo cáo từ phần mềm bán hàng, đối chiếu đơn hàng online.', duration: 0.25 },
      { order: 1, title: 'Điền báo cáo tổng kết đơn hàng',
        formId: formIds['Báo cáo tổng kết đơn hàng'], duration: 0.25 },
      { order: 2, title: 'Gửi báo cáo lên phòng kinh doanh',
        description: 'Đính kèm file báo cáo và gửi lên nhóm kinh doanh.', duration: 0.25 },
    ],
  })

  wfIds.chotSoQuy = await makeWorkflow({
    name: 'Chốt sổ quỹ và dư tiền',
    description: 'Kiểm đếm tiền mặt và chốt sổ quỹ cuối ngày làm việc',
    steps: [
      { order: 0, title: 'Đếm tiền mặt thực tế tại két',
        description: 'Kiểm đếm toàn bộ tiền mặt, phân loại mệnh giá.', duration: 0.5 },
      { order: 1, title: 'Điền biên bản chốt sổ quỹ',
        description: 'Nhập số liệu thu – chi – tồn quỹ, tính chênh lệch.',
        formId: formIds['Biên bản chốt sổ quỹ'], duration: 0.5 },
      { order: 2, title: 'Kế toán trưởng phê duyệt sổ quỹ',
        description: 'Kế toán trưởng xác nhận số liệu và duyệt biên bản.',
        requiresApproval: true, approverUserId: P.ketoan, duration: 1 },
    ],
  })

  wfIds.dieuHang = await makeWorkflow({
    name: 'Điều hàng hóa giữa kho',
    description: 'Quy trình điều chuyển hàng hóa từ kho này sang kho khác',
    steps: [
      { order: 0, title: 'Lập phiếu yêu cầu điều hàng',
        description: 'Điền thông tin hàng cần điều, số lượng, kho gửi và nhận.',
        formId: formIds['Phiếu điều hàng hóa'], duration: 0.5 },
      { order: 1, title: 'Xuất hàng tại kho gửi',
        description: 'Thủ kho gửi kiểm đếm, đóng gói, xuất kho theo phiếu.', duration: 1 },
      { order: 2, title: 'Vận chuyển hàng',
        description: 'Giao cho nhân viên vận chuyển, xác nhận lộ trình.', duration: 2 },
      { order: 3, title: 'Xác nhận nhận hàng tại kho nhận',
        description: 'Thủ kho nhận kiểm đếm, so sánh với phiếu, ký biên nhận.', duration: 0.5 },
    ],
  })

  wfIds.deNghiThanhToan = await makeWorkflow({
    name: 'Đề nghị thanh toán',
    description: 'Phê duyệt thanh toán: dưới 5 triệu do cửa hàng quyết, từ 5 triệu do giám đốc duyệt',
    steps: [
      { order: 0, title: 'Điền đề nghị thanh toán',
        description: 'Điền đầy đủ thông tin nội dung, số tiền, đối tượng thụ hưởng.',
        formId: formIds['Đề nghị thanh toán'], duration: 0.5 },
      { label: 'phanloai', order: 1, title: 'Phân loại theo giá trị',
        description: 'Chọn nhánh phù hợp với số tiền đề nghị.',
        branch: ['Dưới 5 triệu đồng', 'Từ 5 triệu đồng trở lên'], duration: 0.25 },
      // Branch: < 5 triệu
      { parentLabel: 'phanloai', branchCondition: 'Dưới 5 triệu đồng',
        order: 0, title: 'Quản lý cửa hàng phê duyệt',
        description: 'Quản lý trực tiếp xem xét và phê duyệt thanh toán.',
        requiresApproval: true, approverRole: 'editor', duration: 1 },
      { parentLabel: 'phanloai', branchCondition: 'Dưới 5 triệu đồng',
        order: 1, title: 'Kế toán xử lý thanh toán',
        description: 'Kế toán thực hiện chuyển khoản / trả tiền mặt và lưu chứng từ.',
        requiresApproval: true, approverUserId: P.ketoan, duration: 1 },
      // Branch: >= 5 triệu
      { parentLabel: 'phanloai', branchCondition: 'Từ 5 triệu đồng trở lên',
        order: 0, title: 'Giám đốc phê duyệt',
        description: 'Giám đốc xem xét, phê duyệt hoặc từ chối thanh toán.',
        requiresApproval: true, approverUserId: P.giamDoc, duration: 2 },
      { parentLabel: 'phanloai', branchCondition: 'Từ 5 triệu đồng trở lên',
        order: 1, title: 'Kế toán thực hiện & lưu chứng từ',
        description: 'Kế toán thực hiện thanh toán và lưu biên lai vào hệ thống.',
        requiresApproval: true, approverUserId: P.ketoan, duration: 1 },
    ],
  })

  wfIds.donNghiPhep = await makeWorkflow({
    name: 'Đơn xin nghỉ phép',
    description: 'Nhân viên nộp đơn xin nghỉ, quản lý phê duyệt',
    steps: [
      { order: 0, title: 'Điền đơn xin nghỉ phép',
        description: 'Điền đầy đủ ngày nghỉ, loại phép, lý do và người bàn giao.',
        formId: formIds['Đơn xin nghỉ phép'], duration: 0.25 },
      { order: 1, title: 'Quản lý trực tiếp phê duyệt',
        description: 'Quản lý xem xét lịch, phê duyệt hoặc đề nghị đổi ngày.',
        requiresApproval: true, approverRole: 'editor', duration: 4 },
      { order: 2, title: 'Thông báo cho bộ phận kế toán',
        description: 'Kế toán ghi nhận ngày nghỉ để tính lương / công.', duration: 0.5 },
    ],
  })

  // ── 7b. Complex workflows with branch + progressive form fill ──────────────
  // These templates showcase: multi-step forms (fill_at_step_id), branches with
  // multiple approval depths, runner-as-approver, and realistic SME flows.
  // Form fields reference workflow step IDs — created in 2 phases below.

  // ─── Workflow A: Tuyển dụng nhân viên mới (HR multi-stage with 3-way branch)
  wfIds.tuyenDung = await makeWorkflow({
    name: 'Tuyển dụng nhân viên mới',
    description: 'Quy trình tuyển dụng đầy đủ: sàng lọc CV → phỏng vấn → quyết định → ký hợp đồng',
    steps: [
      { label: 'sangloc',  order: 0, title: 'HR sàng lọc CV ứng viên',
        description: 'HR nhận CV, đánh giá sơ bộ phù hợp với vị trí.', duration: 1 },
      { label: 'henlich',  order: 1, title: 'Liên hệ ứng viên & lên lịch phỏng vấn',
        description: 'HR gọi điện xác nhận, gửi lịch phỏng vấn qua email.', duration: 0.5 },
      { label: 'pvtruc',   order: 2, title: 'Quản lý phỏng vấn trực tiếp',
        description: 'Quản lý/Trưởng phòng đánh giá kỹ năng chuyên môn + soft skills.',
        approverRole: 'editor', duration: 1.5 },
      { label: 'danhgia',  order: 3, title: 'Đánh giá ứng viên',
        description: 'Tổng kết đánh giá → chọn nhánh phù hợp.',
        branch: ['Đạt yêu cầu', 'Cần phỏng vấn lần 2', 'Không đạt'], duration: 0.5 },
      // Branch 1: Đạt → Đề xuất lương → GĐ duyệt → Ký hợp đồng
      { parentLabel: 'danhgia', branchCondition: 'Đạt yêu cầu', label: 'luong',
        order: 0, title: 'Kế toán đề xuất mức lương',
        description: 'Kế toán dựa trên ngân sách + thang lương đề xuất offer.', duration: 1 },
      { parentLabel: 'danhgia', branchCondition: 'Đạt yêu cầu', label: 'gdduyet',
        order: 1, title: 'Giám đốc phê duyệt offer',
        description: 'Giám đốc xem xét và phê duyệt mức lương cuối cùng.',
        requiresApproval: true, approverRole: 'admin', duration: 1 },
      { parentLabel: 'danhgia', branchCondition: 'Đạt yêu cầu', label: 'kyhd',
        order: 2, title: 'Ký hợp đồng + onboarding',
        description: 'HR ký hợp đồng và lên lịch onboard.', duration: 2 },
      // Branch 2: Phỏng vấn lần 2
      { parentLabel: 'danhgia', branchCondition: 'Cần phỏng vấn lần 2', label: 'pv2',
        order: 0, title: 'Lên lịch phỏng vấn lần 2 (với GĐ)',
        description: 'HR sắp xếp lịch với Giám đốc tham gia.', duration: 1.5 },
      // Branch 3: Không đạt
      { parentLabel: 'danhgia', branchCondition: 'Không đạt', label: 'tucam',
        order: 0, title: 'Gửi thư cảm ơn ứng viên',
        description: 'HR gửi email lịch sự cảm ơn, lưu CV vào pool.', duration: 0.25 },
    ],
  })

  // ─── Workflow B: Mua sắm tài sản cố định (procurement, branch by amount)
  wfIds.muaSamTaiSan = await makeWorkflow({
    name: 'Mua sắm tài sản cố định',
    description: '<10tr: cấp QL duyệt; 10–50tr: TP + KT; >50tr: yêu cầu 3 báo giá + Giám đốc',
    steps: [
      { label: 'yeucau',    order: 0, title: 'Điền yêu cầu mua sắm',
        description: 'Người yêu cầu điền tên tài sản, số lượng, ước tính giá, lý do.', duration: 0.5 },
      { label: 'phanloai',  order: 1, title: 'Phân loại theo giá trị',
        description: 'Hệ thống phân loại theo số tiền đề nghị.',
        branch: ['Dưới 10 triệu', '10–50 triệu', 'Trên 50 triệu'], duration: 0.25 },
      // <10tr
      { parentLabel: 'phanloai', branchCondition: 'Dưới 10 triệu', label: 'qlduyet',
        order: 0, title: 'Quản lý cửa hàng phê duyệt',
        description: 'Quản lý xét duyệt nhanh (≤1 ngày).',
        requiresApproval: true, approverRole: 'editor', duration: 1 },
      { parentLabel: 'phanloai', branchCondition: 'Dưới 10 triệu', label: 'qlmua',
        order: 1, title: 'Quản lý mua sắm trực tiếp',
        description: 'Quản lý trực tiếp đặt mua từ NCC quen, lưu hóa đơn.', duration: 1 },
      // 10-50tr
      { parentLabel: 'phanloai', branchCondition: '10–50 triệu', label: 'tpduyet',
        order: 0, title: 'Trưởng phòng phê duyệt',
        description: 'Trưởng phòng xem xét nhu cầu và ngân sách.',
        requiresApproval: true, approverRole: 'editor', duration: 2 },
      { parentLabel: 'phanloai', branchCondition: '10–50 triệu', label: 'ktxn',
        order: 1, title: 'Kế toán xác nhận ngân sách',
        description: 'Kế toán kiểm tra dòng tiền + ngân sách.',
        requiresApproval: true, approverUserId: P.ketoan, duration: 1 },
      { parentLabel: 'phanloai', branchCondition: '10–50 triệu', label: 'ktmua',
        order: 2, title: 'Kế toán thực hiện mua + lưu chứng từ',
        description: 'Kế toán đặt hàng, thanh toán và đính kèm hóa đơn đỏ.', duration: 2 },
      // >50tr
      { parentLabel: 'phanloai', branchCondition: 'Trên 50 triệu', label: 'baogia',
        order: 0, title: 'Yêu cầu ít nhất 3 báo giá NCC',
        description: 'Người đề xuất gọi báo giá từ ≥3 nhà cung cấp.', duration: 4 },
      { parentLabel: 'phanloai', branchCondition: 'Trên 50 triệu', label: 'gdduyet',
        order: 1, title: 'Giám đốc phê duyệt phương án',
        description: 'Giám đốc chọn NCC và phê duyệt hợp đồng.',
        requiresApproval: true, approverRole: 'admin', duration: 2 },
      { parentLabel: 'phanloai', branchCondition: 'Trên 50 triệu', label: 'kyhd',
        order: 2, title: 'Ký hợp đồng + thanh toán',
        description: 'Giám đốc ký HĐ, kế toán chuyển tiền theo điều khoản.', duration: 3 },
    ],
  })

  // ─── Workflow C: Xử lý khiếu nại khách hàng (4-way branch)
  wfIds.khieuNai = await makeWorkflow({
    name: 'Xử lý khiếu nại khách hàng',
    description: 'Tiếp nhận → phân loại → điều tra → phản hồi → đóng khiếu nại',
    steps: [
      { label: 'tiepnhan', order: 0, title: 'CSKH tiếp nhận khiếu nại',
        description: 'Ghi nhận thông tin khách + nội dung khiếu nại trong vòng 4h.', duration: 0.5 },
      { label: 'phanloai', order: 1, title: 'Phân loại khiếu nại',
        description: 'CSKH phân loại theo nguyên nhân.',
        branch: ['Hàng lỗi/Hỏng', 'Dịch vụ', 'Vận chuyển', 'Khác'], duration: 0.25 },
      // Hàng lỗi
      { parentLabel: 'phanloai', branchCondition: 'Hàng lỗi/Hỏng', label: 'kiemtra',
        order: 0, title: 'Kiểm tra hàng + xác minh',
        description: 'Quản lý cửa hàng kiểm tra sản phẩm khiếu nại.', duration: 1 },
      { parentLabel: 'phanloai', branchCondition: 'Hàng lỗi/Hỏng', label: 'quyetdinh',
        order: 1, title: 'Quyết định hoàn/đổi/giảm giá',
        description: 'Quản lý cửa hàng phê duyệt phương án xử lý.',
        requiresApproval: true, approverRole: 'editor', duration: 0.5 },
      // Dịch vụ
      { parentLabel: 'phanloai', branchCondition: 'Dịch vụ', label: 'dieutra',
        order: 0, title: 'Điều tra nhân viên + camera',
        description: 'Quản lý xem camera, hỏi nhân viên ca làm việc đó.', duration: 2 },
      { parentLabel: 'phanloai', branchCondition: 'Dịch vụ', label: 'phanhoi',
        order: 1, title: 'Phản hồi khách hàng + xin lỗi',
        description: 'Quản lý gọi xin lỗi, đề xuất bù đắp nếu cần.', duration: 0.5 },
      // Vận chuyển
      { parentLabel: 'phanloai', branchCondition: 'Vận chuyển', label: 'lhncc',
        order: 0, title: 'Liên hệ NCC vận chuyển',
        description: 'Truy vết đơn hàng, yêu cầu giải trình từ shipper.', duration: 2 },
      { parentLabel: 'phanloai', branchCondition: 'Vận chuyển', label: 'capnhat',
        order: 1, title: 'Cập nhật khách hàng',
        description: 'Báo lại tình trạng, đề xuất hoàn tiền hoặc gửi lại.', duration: 0.5 },
      // Khác
      { parentLabel: 'phanloai', branchCondition: 'Khác', label: 'chuyen',
        order: 0, title: 'Chuyển bộ phận liên quan',
        description: 'CSKH chuyển case sang bộ phận phù hợp xử lý.', duration: 0.25 },
    ],
  })
  ok('3 complex workflows added (tuyển dụng / mua sắm / khiếu nại) — branches + multi-stage')

  // ─── 7d. One-time fix: chain root steps in pre-existing templates ──────────
  // Templates seeded before round-8 had every root step with parent_step_id=null,
  // so the React Flow canvas showed disconnected nodes (no arrows). Re-chain
  // them now: each non-first root parents to the previous one. Safe to re-run —
  // we only act on rows where the chain is missing.
  step('🔗 Re-chaining root steps in existing templates (one-time fix)…')
  let chainFixed = 0
  for (const wfName in wfIds) {
    const wfTemplateId = wfIds[wfName]
    if (!wfTemplateId) continue
    const { data: rootSteps } = await svc.from('workflow_steps')
      .select('id, parent_step_id, order_index, step_type')
      .eq('template_id', wfTemplateId).is('parent_step_id', null)
      .order('order_index')
    if (!rootSteps || rootSteps.length <= 1) continue
    // If steps are already chained (more than 1 root and they're all parent=null),
    // chain them now: index 0 stays null, index 1+ parents to index-1.
    let prevId = rootSteps[0].id
    for (let i = 1; i < rootSteps.length; i++) {
      const { error } = await svc.from('workflow_steps')
        .update({ parent_step_id: prevId }).eq('id', rootSteps[i].id)
      if (!error) chainFixed++
      prevId = rootSteps[i].id
    }
  }
  if (chainFixed > 0) ok(`Re-chained ${chainFixed} root step links in existing templates`)
  else info('All templates already chained')

  // ─── 7c. Progressive-fill forms attached to complex workflows ──────────────
  // Each form's fields reference workflow_steps.id via fill_at_step_id, so
  // different roles fill different fields at their step.
  step('📝 Creating progressive-fill forms…')

  async function createFormForWorkflow(formName, description, summaryFields, fields, attachToStepId) {
    const { data: existing } = await svc.from('form_templates').select('id, fields').eq('name', formName).maybeSingle()
    let formId
    if (existing) {
      // Refresh fields (in case step IDs changed across runs)
      await svc.from('form_templates').update({ fields, summary_field_ids: summaryFields, description })
        .eq('id', existing.id)
      formId = existing.id
      info(`Form "${formName}" updated with progressive fields`)
    } else {
      const { data, error } = await svc.from('form_templates').insert({
        name: formName, description, fields, is_active: true,
        created_by: P.giamDoc, summary_field_ids: summaryFields,
      }).select('id').single()
      if (error) { warn(`Form "${formName}": ${error.message}`); return null }
      formId = data.id
      ok(`Form: ${formName} (${fields.length} fields, progressive)`)
    }
    if (attachToStepId) {
      await svc.from('workflow_steps').update({ form_template_id: formId }).eq('id', attachToStepId)
    }
    return formId
  }

  // Look up step IDs for tuyển-dụng workflow to wire fill_at_step_id
  if (wfIds.tuyenDung) {
    const { data: tdSteps } = await svc.from('workflow_steps')
      .select('id, title, order_index, parent_step_id')
      .eq('template_id', wfIds.tuyenDung)
    const tdId = (substr) => tdSteps?.find(s => s.title.includes(substr))?.id ?? null
    const sangloc = tdId('sàng lọc'), henlich = tdId('lên lịch'), pvtruc = tdId('phỏng vấn trực tiếp')
    const luong = tdId('đề xuất mức lương'), gdduyet = tdId('phê duyệt offer'), kyhd = tdId('Ký hợp đồng')

    await createFormForWorkflow(
      'Hồ sơ ứng viên',
      'Form tuyển dụng — điền dần qua các bước (HR → Quản lý → Kế toán → Giám đốc)',
      ['ud_ten', 'ud_vitri'],
      [
        { id: 'ud_ten',         label: 'Họ và tên ứng viên', type: 'text', required: true,
          fill_at_step_id: sangloc, fill_by_role: 'runner' },
        { id: 'ud_vitri',       label: 'Vị trí ứng tuyển', type: 'text', required: true,
          fill_at_step_id: sangloc, fill_by_role: 'runner' },
        { id: 'ud_cv_url',      label: 'Link CV', type: 'text', required: false,
          fill_at_step_id: sangloc, fill_by_role: 'runner' },
        { id: 'ud_phone',       label: 'Số điện thoại', type: 'text', required: true,
          fill_at_step_id: sangloc, fill_by_role: 'runner' },
        { id: 'ud_email',       label: 'Email liên hệ', type: 'text', required: false,
          fill_at_step_id: sangloc, fill_by_role: 'runner' },
        { id: 'ud_lichpv',      label: 'Ngày phỏng vấn', type: 'date', required: false,
          fill_at_step_id: henlich, fill_by_role: 'runner' },
        { id: 'ud_giopv',       label: 'Giờ phỏng vấn', type: 'text', required: false,
          fill_at_step_id: henlich, fill_by_role: 'runner', placeholder: 'VD: 14:00' },
        { id: 'ud_diem_kn',     label: 'Điểm đánh giá kỹ năng (1-10)', type: 'number', required: false,
          fill_at_step_id: pvtruc, fill_by_role: 'runner', validation: { min: 1, max: 10 } },
        { id: 'ud_diem_softskill', label: 'Điểm đánh giá soft skills (1-10)', type: 'number', required: false,
          fill_at_step_id: pvtruc, fill_by_role: 'runner', validation: { min: 1, max: 10 } },
        { id: 'ud_nhanxet_pv',  label: 'Nhận xét sau phỏng vấn', type: 'textarea', required: false,
          fill_at_step_id: pvtruc, fill_by_role: 'runner' },
        { id: 'ud_luong_dx',    label: 'Mức lương đề xuất (VND)', type: 'number', required: false,
          fill_at_step_id: luong, fill_by_role: 'runner' },
        { id: 'ud_thang_luong', label: 'Thang lương áp dụng', type: 'select', required: false,
          options: ['Bậc 1 (NV mới)', 'Bậc 2 (có kinh nghiệm)', 'Bậc 3 (chuyên môn cao)', 'Quản lý'],
          fill_at_step_id: luong, fill_by_role: 'runner' },
        { id: 'ud_luong_duyet', label: 'Mức lương Giám đốc duyệt', type: 'number', required: false,
          fill_at_step_id: gdduyet, fill_by_role: 'approver' },
        { id: 'ud_ghichu_gd',   label: 'Ghi chú từ Giám đốc', type: 'textarea', required: false,
          fill_at_step_id: gdduyet, fill_by_role: 'approver' },
        { id: 'ud_ngay_batdau', label: 'Ngày bắt đầu làm việc', type: 'date', required: false,
          fill_at_step_id: kyhd, fill_by_role: 'runner' },
        { id: 'ud_ma_hd',       label: 'Mã hợp đồng', type: 'text', required: false,
          fill_at_step_id: kyhd, fill_by_role: 'runner' },
      ],
      sangloc,  // attach form to first step
    )
  }

  if (wfIds.muaSamTaiSan) {
    const { data: msSteps } = await svc.from('workflow_steps')
      .select('id, title').eq('template_id', wfIds.muaSamTaiSan)
    const msId = (substr) => msSteps?.find(s => s.title.includes(substr))?.id ?? null
    const yc = msId('Điền yêu cầu'), tpDuyet = msId('Trưởng phòng phê duyệt')
    const ktxn = msId('Kế toán xác nhận'), gdDuyet = msId('Giám đốc phê duyệt phương án')

    await createFormForWorkflow(
      'Phiếu yêu cầu mua sắm tài sản',
      'Người yêu cầu → Quản lý → Kế toán → Giám đốc, mỗi vai điền 1 phần',
      ['ms_ten_ts', 'ms_so_tien'],
      [
        { id: 'ms_ten_ts',      label: 'Tên tài sản cần mua', type: 'text', required: true,
          fill_at_step_id: yc, fill_by_role: 'runner' },
        { id: 'ms_loai',        label: 'Phân loại', type: 'select', required: true,
          options: ['Thiết bị văn phòng', 'Thiết bị bán hàng (POS, máy quét)', 'Nội thất', 'Khác'],
          fill_at_step_id: yc, fill_by_role: 'runner' },
        { id: 'ms_so_luong',    label: 'Số lượng', type: 'number', required: true,
          fill_at_step_id: yc, fill_by_role: 'runner', validation: { min: 1 } },
        { id: 'ms_so_tien',     label: 'Số tiền ước tính (VND)', type: 'number', required: true,
          fill_at_step_id: yc, fill_by_role: 'runner', validation: { min: 1 } },
        { id: 'ms_lydo',        label: 'Lý do mua sắm', type: 'textarea', required: true,
          fill_at_step_id: yc, fill_by_role: 'runner' },
        { id: 'ms_qtl_quyetdinh', label: 'Quyết định Trưởng phòng', type: 'radio', required: false,
          options: ['Đồng ý', 'Không đồng ý', 'Yêu cầu giảm số lượng/giá'],
          fill_at_step_id: tpDuyet, fill_by_role: 'approver' },
        { id: 'ms_qtl_ghichu',  label: 'Ghi chú TP', type: 'textarea', required: false,
          fill_at_step_id: tpDuyet, fill_by_role: 'approver' },
        { id: 'ms_kt_nguonvon', label: 'Nguồn vốn (KT)', type: 'select', required: false,
          options: ['Quỹ vận hành', 'Đầu tư', 'Vay'],
          fill_at_step_id: ktxn, fill_by_role: 'approver' },
        { id: 'ms_kt_ngancsach', label: 'Ngân sách còn lại sau mua (VND)', type: 'number', required: false,
          fill_at_step_id: ktxn, fill_by_role: 'approver' },
        { id: 'ms_ncc_chon',    label: 'NCC chọn (sau khi có 3 báo giá)', type: 'text', required: false,
          fill_at_step_id: gdDuyet, fill_by_role: 'approver' },
        { id: 'ms_so_tien_duyet', label: 'Số tiền GĐ duyệt (VND)', type: 'number', required: false,
          fill_at_step_id: gdDuyet, fill_by_role: 'approver' },
      ],
      yc,
    )
  }

  if (wfIds.khieuNai) {
    const { data: knSteps } = await svc.from('workflow_steps')
      .select('id, title').eq('template_id', wfIds.khieuNai)
    const knId = (substr) => knSteps?.find(s => s.title.includes(substr))?.id ?? null
    const tn = knId('CSKH tiếp nhận'), kt = knId('Kiểm tra hàng'), qd = knId('hoàn/đổi')
    const dt = knId('Điều tra nhân viên'), ph = knId('xin lỗi')

    await createFormForWorkflow(
      'Báo cáo khiếu nại khách hàng',
      'CSKH → Quản lý/Điều tra → Phản hồi: form điền dần qua từng nhánh',
      ['kn_kh_ten', 'kn_loai'],
      [
        { id: 'kn_kh_ten',      label: 'Tên khách hàng', type: 'text', required: true,
          fill_at_step_id: tn, fill_by_role: 'runner' },
        { id: 'kn_kh_phone',    label: 'Số điện thoại', type: 'text', required: true,
          fill_at_step_id: tn, fill_by_role: 'runner' },
        { id: 'kn_loai',        label: 'Loại khiếu nại', type: 'select', required: true,
          options: ['Hàng lỗi/Hỏng', 'Dịch vụ', 'Vận chuyển', 'Khác'],
          fill_at_step_id: tn, fill_by_role: 'runner' },
        { id: 'kn_mota',        label: 'Mô tả khiếu nại', type: 'textarea', required: true,
          fill_at_step_id: tn, fill_by_role: 'runner' },
        { id: 'kn_dia_diem',    label: 'Cửa hàng / điểm bán liên quan', type: 'select', required: false,
          options: ['Quận 1', 'Quận 3', 'Bình Thạnh', 'Online', 'Khác'],
          fill_at_step_id: tn, fill_by_role: 'runner' },
        { id: 'kn_kt_ket_qua',  label: 'Kết quả kiểm tra hàng', type: 'textarea', required: false,
          fill_at_step_id: kt, fill_by_role: 'runner' },
        { id: 'kn_qd_phuongan', label: 'Phương án xử lý', type: 'radio', required: false,
          options: ['Hoàn tiền', 'Đổi hàng', 'Giảm giá lần sau', 'Không bồi thường'],
          fill_at_step_id: qd, fill_by_role: 'approver' },
        { id: 'kn_dt_nguyen_nhan', label: 'Nguyên nhân (điều tra)', type: 'textarea', required: false,
          fill_at_step_id: dt, fill_by_role: 'runner' },
        { id: 'kn_ph_noidung',  label: 'Nội dung phản hồi cho khách', type: 'textarea', required: false,
          fill_at_step_id: ph, fill_by_role: 'runner' },
      ],
      tn,
    )
  }

  // ── 8. Workflow template access control ────────────────────────────────────
  step('🔒 Setting workflow access control…')

  const gCH_Q1 = groupIds['Cửa hàng Quận 1']
  const gCH_Q3 = groupIds['Cửa hàng Quận 3']
  const gCH_BT = groupIds['Cửa hàng Bình Thạnh']
  const gKho   = groupIds['Kho & Vận chuyển']
  const gHO    = groupIds['HO – Kinh doanh & Kế toán']

  const accessEntries = [
    // Mở/đóng cửa + chốt quỹ + tổng kết đơn: nhân sự cửa hàng
    ...[gCH_Q1, gCH_Q3, gCH_BT].flatMap(g => [
      { template_id: wfIds.moCuaHang,      group_id: g },
      { template_id: wfIds.dongCuaHang,    group_id: g },
      { template_id: wfIds.chotSoQuy,      group_id: g },
      { template_id: wfIds.tongKetDonHang, group_id: g },
    ]),
    // Kiểm kê & điều hàng: kho + HO
    { template_id: wfIds.kiemKe,   group_id: gKho },
    { template_id: wfIds.dieuHang, group_id: gKho },
    { template_id: wfIds.kiemKe,   group_id: gHO },
    { template_id: wfIds.dieuHang, group_id: gHO },
    // Tuyển dụng: HO only (giám đốc + kế toán)
    { template_id: wfIds.tuyenDung,    group_id: gHO },
    // Mua sắm tài sản: cửa hàng + HO
    ...[gCH_Q1, gCH_Q3, gCH_BT, gHO].map(g => ({ template_id: wfIds.muaSamTaiSan, group_id: g })),
    // Khiếu nại: cửa hàng + HO (CSKH thường ở cửa hàng)
    ...[gCH_Q1, gCH_Q3, gCH_BT, gHO].map(g => ({ template_id: wfIds.khieuNai, group_id: g })),
    // Đề nghị thanh toán & Đơn nghỉ phép: open access (no entries = everyone)
  ].filter(e => e.template_id && e.group_id)

  for (const entry of accessEntries) {
    await svc.from('workflow_template_access').insert(entry)
      .then(() => {})  // ignore duplicates
  }
  ok(`Access rules: ${accessEntries.length} entries`)

  // ── 9. Demo workflow runs ──────────────────────────────────────────────────
  step('▶️  Creating demo workflow runs…')

  async function makeRun({ templateId, templateName, runBy, projectId = null,
                            status = 'in_progress', startedAt, completedAt = null,
                            stepsToComplete = [], pendingApprovalStep = null }) {
    const { data: run, error: runErr } = await svc.from('workflow_runs').insert({
      template_id:   templateId,
      template_name: templateName,
      run_by:        runBy,
      project_id:    projectId,
      status,
      started_at:    startedAt,
      completed_at:  completedAt,
    }).select('id').single()
    if (runErr) { warn(`Run "${templateName}": ${runErr.message}`); return null }

    // Snapshot steps (security-definer RPC, always works with svc)
    const { error: snapErr } = await svc.rpc('snapshot_workflow_run', { p_run: run.id })
    if (snapErr) { warn(`  Snapshot failed: ${snapErr.message}`) }

    const { data: runSteps } = await svc.from('workflow_run_steps')
      .select('*').eq('run_id', run.id).order('order_index')

    if (!runSteps?.length) return run.id

    // Mark completed steps
    for (const s of runSteps) {
      if (!stepsToComplete.some(t => s.title.includes(t))) continue
      await svc.from('workflow_step_results').insert({
        run_id:      run.id,
        step_id:     s.source_step_id,
        snapshot_id: s.id,
        is_done:     true,
        done_at:     startedAt,
        note:        null,
      }).then(() => {})
    }

    // Insert pending approval step result
    if (pendingApprovalStep) {
      const aps = runSteps.find(s => s.title.includes(pendingApprovalStep))
      if (aps) {
        const { error } = await svc.from('workflow_step_results').insert({
          run_id:          run.id,
          step_id:         aps.source_step_id,
          snapshot_id:     aps.id,
          is_done:         false,
          done_at:         null,
          approval_status: 'pending',
        })
        if (error) warn(`  Approval step insert: ${error.message}`)
      }
    }

    return run.id
  }

  // Run 1: Check-in mở cửa Q1 — completed yesterday
  await makeRun({
    templateId: wfIds.moCuaHang, templateName: 'Check in mở cửa hàng',
    runBy: P.nvQ1_1, status: 'completed',
    startedAt: daysAgo(1), completedAt: daysAgo(1),
    stepsToComplete: ['Đến cửa hàng', 'Điền biên bản', 'Báo cáo quản lý'],
  })

  // Run 2: Check-in mở cửa Q3 — completed yesterday
  await makeRun({
    templateId: wfIds.moCuaHang, templateName: 'Check in mở cửa hàng',
    runBy: P.nvQ3_1, status: 'completed',
    startedAt: daysAgo(1), completedAt: daysAgo(1),
    stepsToComplete: ['Đến cửa hàng', 'Điền biên bản', 'Báo cáo quản lý'],
  })

  // Run 3: Đóng cửa Q1 — completed yesterday
  await makeRun({
    templateId: wfIds.dongCuaHang, templateName: 'Đóng cửa hàng',
    runBy: P.qlQ1, status: 'completed',
    startedAt: daysAgo(1), completedAt: daysAgo(1),
    stepsToComplete: ['Tổng kết doanh thu', 'Kiểm tra thiết bị', 'Quản lý xác nhận'],
  })

  // Run 4: Kiểm kê tồn kho — in_progress, 2 bước đã xong
  await makeRun({
    templateId: wfIds.kiemKe, templateName: 'Kiểm kê tồn kho',
    runBy: P.tkhoQ1, status: 'in_progress',
    startedAt: hoursAgo(3),
    stepsToComplete: ['Khóa nhập xuất', 'Đếm hàng thực tế'],
  })

  // Run 5: Chốt sổ quỹ Q3 — pending approval by kế toán
  await makeRun({
    templateId: wfIds.chotSoQuy, templateName: 'Chốt sổ quỹ và dư tiền',
    runBy: P.qlQ3, status: 'in_progress',
    startedAt: hoursAgo(2),
    stepsToComplete: ['Đếm tiền mặt', 'Điền biên bản'],
    pendingApprovalStep: 'Kế toán trưởng phê duyệt',
  })

  // Run 6: Đề nghị thanh toán — sửa máy lạnh Q1 (< 5 triệu)
  await makeRun({
    templateId: wfIds.deNghiThanhToan, templateName: 'Đề nghị thanh toán',
    runBy: P.qlQ1, status: 'in_progress',
    startedAt: hoursAgo(4),
    stepsToComplete: ['Điền đề nghị thanh toán'],
  })

  // Run 7: Đơn nghỉ phép — Nguyễn Văn An (pending approval)
  await makeRun({
    templateId: wfIds.donNghiPhep, templateName: 'Đơn xin nghỉ phép',
    runBy: P.nvQ1_1, status: 'in_progress',
    startedAt: hoursAgo(5),
    stepsToComplete: ['Điền đơn xin nghỉ phép'],
    pendingApprovalStep: 'Quản lý trực tiếp phê duyệt',
  })

  // Run 8: Điều hàng HO → Q3 — hoàn thành 3 ngày trước
  await makeRun({
    templateId: wfIds.dieuHang, templateName: 'Điều hàng hóa giữa kho',
    runBy: P.tkhoHO, status: 'completed',
    startedAt: daysAgo(3), completedAt: daysAgo(3),
    stepsToComplete: ['Lập phiếu', 'Xuất hàng', 'Vận chuyển', 'Xác nhận nhận hàng'],
  })

  // Run 9: Tuyển dụng — đang ở bước phỏng vấn (in_progress)
  if (wfIds.tuyenDung) {
    await makeRun({
      templateId: wfIds.tuyenDung, templateName: 'Tuyển dụng — NV bán hàng Q3',
      runBy: P.tpKD, status: 'in_progress', startedAt: daysAgo(2),
      stepsToComplete: ['HR sàng lọc CV', 'Liên hệ ứng viên'],
    })
  }

  // Run 10: Mua sắm — đã hoàn tất nhánh <10tr (3 ngày trước)
  if (wfIds.muaSamTaiSan) {
    await makeRun({
      templateId: wfIds.muaSamTaiSan, templateName: 'Mua sắm — Máy in hóa đơn Q1 (3.5tr)',
      runBy: P.qlQ1, status: 'completed',
      startedAt: daysAgo(3), completedAt: daysAgo(2),
      stepsToComplete: ['Điền yêu cầu', 'Phân loại theo giá trị',
                        'Quản lý cửa hàng phê duyệt', 'Quản lý mua sắm trực tiếp'],
    })
  }

  // Run 11: Khiếu nại — đang điều tra (vận chuyển)
  if (wfIds.khieuNai) {
    await makeRun({
      templateId: wfIds.khieuNai, templateName: 'Khiếu nại — KH Nguyễn Văn X (giao trễ 2 ngày)',
      runBy: P.qlQ1, status: 'in_progress', startedAt: hoursAgo(8),
      stepsToComplete: ['CSKH tiếp nhận', 'Phân loại khiếu nại', 'Liên hệ NCC vận chuyển'],
    })
  }

  ok('11 demo workflow runs created (8 cũ + 3 cho complex flows)')

  // ── 9b. Admin-targeted approval scenarios (real human admin) ────────────────
  // Override snapshot's approver_user_id → real admin's UUID, then set
  // approval_status='pending' so fan_out_approvals fires. The trigger posts
  // an approval_request rich card to admin's personal channel + creates a
  // notifications row → admin sees the bell + chat alert when they log in.
  step('🔔 Admin notification scenarios (real human)…')

  const realAdmin = (existingAuth?.users ?? []).find(u => u.email === REAL_ADMIN_EMAIL)
  if (!realAdmin) {
    warn(`Real admin (${REAL_ADMIN_EMAIL}) not found in auth — skipping admin scenarios`)
    warn(`  → Đăng ký user này trước hoặc set DEMO_ADMIN_EMAIL trong .env`)
  } else {
    info(`Real admin: ${REAL_ADMIN_EMAIL} (${realAdmin.id.slice(0, 8)}…)`)

    // Ensure profile row exists for the real admin (so triggers can resolve display name)
    await svc.from('profiles').upsert(
      { id: realAdmin.id, full_name: realAdmin.user_metadata?.full_name ?? 'Pham Viet Dung', role: 'admin' },
      { onConflict: 'id' },
    )

    // Idempotency: nuke ALL approval-request cards + approval_requested
    // notifications for the real admin BEFORE re-creating fresh ones. Also
    // cascade-deletes all admin-targeted runs (template_name match).
    const adminScenarioNames = [
      'Đề nghị thanh toán — Sửa kho HO (8.5tr)',
      'Đề nghị thanh toán — Bảng hiệu Q1 (12tr)',
      'Đề nghị thanh toán — Mua bàn ghế Q3 (15tr)',
      'Đóng cửa hàng — BT (cần xác nhận đặc biệt)',
    ]
    // 1) Find admin's personal channel id
    const { data: adminPersonal } = await svc.from('chat_channels')
      .select('id').eq('owner_id', realAdmin.id).eq('channel_type', 'personal').maybeSingle()

    // 2) Delete ALL approval_request rich cards in admin's personal channel
    let cardsDeleted = 0
    if (adminPersonal?.id) {
      const { data: cards } = await svc.from('chat_messages')
        .select('id, payload').eq('context_id', adminPersonal.id)
        .eq('message_type', 'rich_card')
      const cardIds = (cards ?? [])
        .filter(c => c.payload?.kind === 'approval_request')
        .map(c => c.id)
      if (cardIds.length > 0) {
        await svc.from('chat_messages').delete().in('id', cardIds)
        cardsDeleted = cardIds.length
      }
    }

    // 3) Delete ALL approval_requested notifications for admin
    const { count: notifsDeleted } = await svc.from('notifications').delete({ count: 'exact' })
      .eq('user_id', realAdmin.id).eq('kind', 'approval_requested')

    // 4) Cascade-delete admin-scenario runs (FK cascades to step_results + run_steps)
    const { data: oldRuns } = await svc.from('workflow_runs')
      .select('id').in('template_name', adminScenarioNames)
    const oldRunIds = (oldRuns ?? []).map(r => r.id)
    if (oldRunIds.length > 0) {
      await svc.from('workflow_runs').delete().in('id', oldRunIds)
    }
    if (cardsDeleted || (notifsDeleted ?? 0) || oldRunIds.length) {
      info(`Cleaned ${oldRunIds.length} prior runs + ${cardsDeleted} cards + ${notifsDeleted ?? 0} notifications`)
    }

    // Helper: create a run, override snapshot approver to real admin, and either
    // leave it pending (default) or finalize it (approved/rejected).
    async function adminApprovalRun({ templateId, templateName, runBy, startedAt,
                                       stepsToComplete = [], pendingStepTitle,
                                       finalState = 'pending' /* 'pending' | 'approved' | 'rejected' */ }) {
      const runId = await makeRun({
        templateId, templateName, runBy, status: 'in_progress',
        startedAt, stepsToComplete,
      })
      if (!runId) return null

      const { data: snaps } = await svc.from('workflow_run_steps')
        .select('id, source_step_id, title, order_index')
        .eq('run_id', runId).order('order_index')

      const target = snaps?.find(s => s.title.includes(pendingStepTitle))
      if (!target) {
        warn(`  No step matching "${pendingStepTitle}" in run`)
        return runId
      }

      // Override snapshot approver → real admin
      await svc.from('workflow_run_steps').update({
        approver_user_id:  realAdmin.id,
        approver_role:     'specific_user',
        requires_approval: true,
      }).eq('id', target.id)

      // INSERT step_result with approval_status='pending' → trigger fires
      // (this is the moment the rich card lands in admin's personal channel)
      const insertRow = {
        run_id:          runId,
        step_id:         target.source_step_id,
        snapshot_id:     target.id,
        is_done:         false,
        approval_status: 'pending',
      }
      const { data: srRow, error: srErr } = await svc.from('workflow_step_results')
        .insert(insertRow).select('id').single()
      if (srErr) { warn(`  Approval insert: ${srErr.message}`); return runId }

      if (finalState === 'approved') {
        await svc.from('workflow_step_results').update({
          approval_status:  'approved',
          approved_by:      realAdmin.id,
          approval_at:      startedAt,
          is_done:          true,
          done_at:          startedAt,
          approval_comment: 'Đã duyệt. OK chuyển kế toán xử lý.',
        }).eq('id', srRow.id)
        await svc.from('workflow_runs').update({
          status: 'completed', completed_at: startedAt,
        }).eq('id', runId)
      } else if (finalState === 'rejected') {
        await svc.from('workflow_step_results').update({
          approval_status:  'rejected',
          approved_by:      realAdmin.id,
          approval_at:      startedAt,
          approval_comment: 'Cần bổ sung báo giá từ ít nhất 2 nhà cung cấp + hóa đơn đỏ. Vui lòng làm lại.',
        }).eq('id', srRow.id)
      }
      return runId
    }

    // Scenario A — Đề nghị thanh toán >5tr đang chờ admin duyệt (mới gửi sáng nay)
    await adminApprovalRun({
      templateId:      wfIds.deNghiThanhToan,
      templateName:    'Đề nghị thanh toán — Sửa kho HO (8.5tr)',
      runBy:           P.tkhoHO,
      startedAt:       hoursAgo(2),
      stepsToComplete: ['Điền đề nghị thanh toán', 'Phân loại theo giá trị'],
      pendingStepTitle:'Giám đốc phê duyệt',
      finalState:      'pending',
    })

    // Scenario B — Đề nghị thanh toán đã được admin duyệt (lịch sử 5 ngày trước)
    await adminApprovalRun({
      templateId:      wfIds.deNghiThanhToan,
      templateName:    'Đề nghị thanh toán — Bảng hiệu Q1 (12tr)',
      runBy:           P.qlQ1,
      startedAt:       daysAgo(5),
      stepsToComplete: ['Điền đề nghị thanh toán', 'Phân loại theo giá trị'],
      pendingStepTitle:'Giám đốc phê duyệt',
      finalState:      'approved',
    })

    // Scenario C — Đề nghị thanh toán đã bị admin từ chối (cần bổ sung chứng từ)
    await adminApprovalRun({
      templateId:      wfIds.deNghiThanhToan,
      templateName:    'Đề nghị thanh toán — Mua bàn ghế Q3 (15tr)',
      runBy:           P.qlQ3,
      startedAt:       daysAgo(2),
      stepsToComplete: ['Điền đề nghị thanh toán', 'Phân loại theo giá trị'],
      pendingStepTitle:'Giám đốc phê duyệt',
      finalState:      'rejected',
    })

    // Scenario D — Đóng cửa hàng đang chờ admin xác nhận (dùng quyền admin override role-based)
    await adminApprovalRun({
      templateId:      wfIds.dongCuaHang,
      templateName:    'Đóng cửa hàng — BT (cần xác nhận đặc biệt)',
      runBy:           P.qlBT,
      startedAt:       hoursAgo(1),
      stepsToComplete: ['Tổng kết doanh thu', 'Kiểm tra thiết bị'],
      pendingStepTitle:'Quản lý xác nhận đóng cửa',
      finalState:      'pending',
    })

    ok('4 admin approval scenarios created (2 pending → notifications fire)')
  }

  // ── 10. Chat messages ──────────────────────────────────────────────────────
  step('💬 Seeding chat messages…')

  // Post a message as a specific user into a context.
  // Service_role bypasses the "author_id = auth.uid()" INSERT check,
  // so we can post messages as any user.
  async function postMsg(contextType, contextId, authorId, content) {
    const { error } = await svc.from('chat_messages').insert({
      context_type: contextType,
      context_id:   contextId,
      author_id:    authorId,
      message_type: 'text',
      content,
    })
    if (error) warn(`  Message error: ${error.message}`)
  }

  // Helper: only seed messages if channel is empty
  async function seedChannel(contextType, contextId, messages) {
    if (!contextId) return
    const { count } = await svc.from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('context_id', contextId)
    if (count > 0) { info(`Messages already exist in ${contextType}:${contextId}`); return }
    for (const [authorId, content] of messages) {
      await postMsg(contextType, contextId, authorId, content)
    }
  }

  await seedChannel('channel', chIds['chung'], [
    [P.giamDoc, '👋 Chào toàn thể anh chị em Minh Phúc! Từ hôm nay toàn bộ thông báo nội bộ và trao đổi công việc sẽ qua hệ thống này. Mọi người kiểm tra kênh của mình nhé.'],
    [P.tpKD,    'Nhắc toàn hệ thống: tháng này là cao điểm hè, yêu cầu tất cả cửa hàng báo cáo tồn kho thực phẩm tươi sống mỗi sáng trước 8h. Dùng quy trình "Kiểm kê tồn kho" nhé anh chị.'],
    [P.ketoan,  'Lưu ý: các đề nghị thanh toán trên 5 triệu vui lòng đính kèm đủ chứng từ trước khi submit nhé. Tuần trước có 2 hồ sơ thiếu hóa đơn đỏ.'],
    [P.giamDoc, '📢 Kết quả kinh doanh tháng 4: tổng doanh thu 3 cửa hàng đạt 847 triệu, tăng 12% so với tháng 3. Cảm ơn toàn đội đã nỗ lực!'],
  ])
  ok('Messages: #chung')

  await seedChannel('channel', chIds['ban-giam-doc'], [
    [P.giamDoc, 'Lan ơi, tháng này tổng chi phí vận hành có vẻ tăng. Em chuẩn bị báo cáo chi tiết để mình họp thứ 6 nhé.'],
    [P.ketoan,  'Vâng anh, em đã pull số liệu xong rồi. Chi phí điện Q1 tăng 23% do thay máy lạnh cũ. Em sẽ làm báo cáo phân tích gửi anh trước chiều thứ 5.'],
    [P.giamDoc, 'Ok, tiện thể cũng đánh giá lại định mức chi phí sửa chữa cho từng điểm. Từ tháng sau trên 3 triệu là cần giám đốc duyệt trước.'],
  ])
  ok('Messages: #ban-giam-doc')

  await seedChannel('channel', chIds['kinh-doanh'], [
    [P.tpKD,  '📊 Báo cáo doanh số tuần 18 (28/4–4/5): Q1: 198tr, Q3: 167tr, BT: 142tr. Tổng: 507tr. Q1 đang dẫn đầu nhờ chiến dịch giỏ quà hè!'],
    [P.qlQ1,  'Team Q1 báo cáo: mặt hàng nước mắm và dầu ăn tháng này tăng mạnh, đề nghị phòng KD tăng định mức nhập cho Q1.'],
    [P.qlQ3,  'Q3 đang test bundle "combo bếp gia đình" — doanh thu combo tăng 40% so với bán lẻ đơn lẻ. Đề xuất nhân rộng sang Q1 và BT.'],
    [P.tpKD,  'Hay đó chị Hoa! Cho em xin data chi tiết để trình anh Phúc. Nếu ổn thì sẽ áp dụng toàn hệ thống từ tuần sau.'],
  ])
  ok('Messages: #kinh-doanh')

  await seedChannel('channel', chIds['kho-van-chuyen'], [
    [P.tkhoHO, 'Thông báo: lô hàng từ nhà cung cấp Hoàng Gia dự kiến về kho HO chiều nay 15h. Anh chị kho sắp xếp nhân sự nhận hàng nhé.'],
    [P.tkhoQ1, 'Kho Q1 báo: tồn dầu ăn Neptune 5L chỉ còn 8 thùng, cần điều thêm từ kho HO trước cuối tuần.'],
    [P.tkhoHO, 'OK anh Quân, anh tạo phiếu điều hàng trên hệ thống đi, mình duyệt và cho xe chiều mai.'],
    [P.tkhoBT, 'Kho BT cũng cần bổ sung nước tương và nước rửa chén. Chị sẽ tạo phiếu điều hàng hôm nay.'],
  ])
  ok('Messages: #kho-van-chuyen')

  await seedChannel('channel', chIds['cua-hang-quan-1'], [
    [P.qlQ1,   'Team Q1 ơi! Từ tuần này bắt đầu thực hiện check-in mở cửa bằng hệ thống nhé, không dùng group Zalo nữa. Bạn nào chưa biết cách dùng nhắn anh.'],
    [P.nvQ1_1, 'Dạ anh, em đã làm thử rồi, khá dễ dùng ạ! Sáng nay check-in lúc 7h15 xong xuôi rồi.'],
    [P.nvQ1_2, 'Anh Hùng ơi, máy tính tiền quầy 2 sáng nay khởi động chậm, anh nhờ kỹ thuật kiểm tra giúp được không ạ?'],
    [P.qlQ1,   'Em Bích: anh đã báo kỹ thuật rồi, họ sẽ qua buổi chiều. Tạm thời dồn về quầy 1 nhé.'],
    [P.nvQ1_3, 'Doanh thu ca sáng hôm nay: 23 hóa đơn, tổng 4.2 triệu. Top sản phẩm: mì gói, nước giải khát, dầu ăn.'],
  ])
  ok('Messages: #cua-hang-quan-1')

  await seedChannel('channel', chIds['cua-hang-quan-3'], [
    [P.qlQ3,   'Anh chị Q3 lưu ý: sắp vào đợt kiểm tra VSATTP quận, cần vệ sinh khu trưng bày thực phẩm kỹ hơn, đặc biệt kệ hàng tươi sống.'],
    [P.nvQ3_2, 'Chị Hoa ơi, khách hỏi nhiều về mặt hàng bột giặt Omo túi lớn mà mình đang hết hàng, khi nào có hàng về ạ?'],
    [P.qlQ3,   'Anh Khoa bên kho HO vừa xác nhận hàng về chiều mai. Em Giang cập nhật cho khách biết nhé, nếu cần giữ hàng thì lấy thông tin khách.'],
    [P.nvQ3_3, 'Báo cáo: combo bếp gia đình hôm nay bán được 7 set, khách phản hồi tốt!'],
  ])
  ok('Messages: #cua-hang-quan-3')

  await seedChannel('channel', chIds['cua-hang-binh-thanh'], [
    [P.qlBT,   'Chào cả nhà! BT hôm nay khai trương khu trưng bày gia dụng mới, anh em tranh thủ giới thiệu với khách nhé 🎉'],
    [P.nvBT_1, 'Anh Nam ơi, khu gia dụng mới trưng bày đẹp lắm ạ! Khách sáng nay hỏi nhiều về nồi chiên không dầu và máy xay sinh tố.'],
    [P.nvBT_3, 'Em Sương nhắc: tủ đông khu tươi sống hôm qua nhiệt độ có vẻ cao hơn bình thường, sáng nay kiểm tra lại chưa ạ?'],
    [P.tkhoBT, 'Chị kiểm tra rồi, tủ đông ổn nhé, hôm qua do mở cửa nhiều lần khi nhập hàng. Nhiệt độ sáng nay -18°C bình thường.'],
  ])
  ok('Messages: #cua-hang-binh-thanh')

  // Project thread messages
  await seedChannel('project', projIds['chien-dich-tet-at-ty-2025'], [
    [P.tpKD,   '🎯 Kickoff chiến dịch Tết Ất Tỵ 2025! Target: +40% doanh số tháng 1-2. Kế hoạch gồm: combo quà tết, tặng quà khi mua từ 500k, khuyến mãi đặc biệt cuối tuần.'],
    [P.giamDoc,'Phê duyệt ngân sách marketing: 45 triệu. Lưu ý ưu tiên nhóm hàng thực phẩm đóng gói và gia dụng cao cấp.'],
    [P.qlQ1,   'Q1 đã đặt hàng bộ quà tết 200 set, dự kiến về kho ngày 15/12. Anh chị kho HO lưu ý nhận hàng nhé.'],
  ])
  ok('Messages: project Tết')

  await seedChannel('project', projIds['nang-cap-pos-2025'], [
    [P.giamDoc,'Kickoff dự án nâng cấp POS. Yêu cầu: tích hợp quản lý kho realtime, báo cáo doanh thu tức thì, hỗ trợ đa chi nhánh.'],
    [P.tpKD,   'Em đã khảo sát 3 nhà cung cấp POS. KiotViet phù hợp nhất về giá và tính năng. Anh xem proposal em gửi qua email nhé.'],
    [P.ketoan, 'Chi phí license KiotViet Pro 3 điểm khoảng 28tr/năm. Trong ngân sách. Anh Phúc cần ký hợp đồng thì em chuẩn bị hồ sơ.'],
  ])
  ok('Messages: project POS')

  // ── 10b. DMs with real admin + reactions ──────────────────────────────────
  // Gives the real admin a populated "Tin nhắn riêng" sidebar + sample reactions.
  if (realAdmin) {
    step('💌 DM channels with real admin + sample reactions…')

    async function dmWith(partnerId) {
      // Look up an existing DM by either ownership orientation
      const { data: existing } = await svc.from('chat_channels')
        .select('id, owner_id, dm_partner_id').eq('channel_type', 'dm')
        .or(`and(owner_id.eq.${realAdmin.id},dm_partner_id.eq.${partnerId}),and(owner_id.eq.${partnerId},dm_partner_id.eq.${realAdmin.id})`)
        .maybeSingle()
      if (existing?.id) return existing.id
      // Create new — admin as owner, partner as dm_partner_id
      const { data: ch, error: ce } = await svc.from('chat_channels').insert({
        name: 'DM', channel_type: 'dm',
        owner_id: realAdmin.id, dm_partner_id: partnerId, created_by: realAdmin.id,
      }).select('id').single()
      if (ce) { warn(`  DM channel: ${ce.message}`); return null }
      return ch.id
    }

    async function seedDM(partnerId, partnerKey, messages) {
      const chId = await dmWith(partnerId)
      if (!chId) return
      const { count } = await svc.from('chat_messages')
        .select('*', { count: 'exact', head: true }).eq('context_id', chId)
      if (count > 0) { info(`DM with ${partnerKey} already has messages`); return }
      for (const [authorIsAdmin, content] of messages) {
        await postMsg('channel', chId, authorIsAdmin ? realAdmin.id : partnerId, content)
      }
      ok(`DM seeded: admin ↔ ${partnerKey}`)
    }

    // DM 1 — admin ↔ giamDoc (Nguyễn Minh Phúc): cross-checking the company's status
    await seedDM(P.giamDoc, 'Nguyễn Minh Phúc', [
      [false, 'Anh Dung ơi, hệ thống mới chạy êm chưa? Bên Q1 báo nhanh hơn hẳn so với tuần trước.'],
      [true,  'Cảm ơn anh! Round-7 đã ổn, AI assistant edit nhanh + sandbox an toàn. Bên anh thử feature "Trợ lý AI" trong workflow editor chưa?'],
      [false, 'Em vừa thử tạo quy trình "Đóng cửa hàng cuối tháng" bằng AI, gọn lắm. Có việc cần anh duyệt 2 đề nghị thanh toán nhé, em đẩy lên rồi.'],
      [true,  '👌 OK em, anh đang vào duyệt liền.'],
    ])

    // DM 2 — admin ↔ ketoan (Trần Thị Lan): finance alert
    await seedDM(P.ketoan, 'Trần Thị Lan', [
      [false, 'Anh Dung, có 1 đề nghị thanh toán Q3 (15tr — bàn ghế) em thấy thiếu báo giá so sánh. Anh xem giúp em quyết định?'],
      [true,  'Anh sẽ từ chối + yêu cầu bổ sung chứng từ. Em thấy ổn không?'],
      [false, 'Em đồng ý anh. Quy định mới từ tháng sau là phải có ít nhất 2 báo giá đính kèm với khoản >10tr.'],
    ])

    // DM 3 — admin ↔ tpKD (Vũ Thị Mai)
    await seedDM(P.tpKD, 'Vũ Thị Mai', [
      [false, 'Anh ơi, doanh số tuần này Q1 đang dẫn đầu, Q3 hơi chậm. Em đề xuất push combo bếp gia đình bên Q3 từ tuần sau.'],
      [true,  'OK. Em làm đề xuất + ngân sách marketing đính kèm rồi gửi qua workflow "Đề nghị thanh toán" nhé. Anh sẽ duyệt nhanh.'],
      [false, '🙌 Cảm ơn anh!'],
    ])

    // ── Reactions on highlight messages ─────────────────────────────────────
    // Pick the most recent highlight in #chung (the "doanh thu tháng 4" announcement)
    // and add reactions from a few demo users to make the chat feel alive.
    const { data: highlightMsg } = await svc.from('chat_messages')
      .select('id, content').eq('context_id', chIds['chung'])
      .ilike('content', '%doanh thu%')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (highlightMsg) {
      const reactors = [
        [P.tpKD,    '🎉'],
        [P.qlQ1,    '👍'],
        [P.qlQ3,    '👍'],
        [P.qlBT,    '❤️'],
        [P.ketoan,  '👏'],
        [P.nvQ1_1,  '🎉'],
      ]
      let rxOK = 0, rxFail = 0, rxFirstErr = null
      for (const [uid, emoji] of reactors) {
        if (!uid) continue
        const { error } = await svc.from('chat_message_reactions').insert({
          message_id: highlightMsg.id, user_id: uid, emoji,
        })
        // 23505 = unique violation (idempotency on re-run) — silent OK
        if (!error || error.code === '23505') rxOK++
        else { rxFail++; rxFirstErr ??= error }
      }
      if (rxFail > 0) {
        warn(`Reactions: ${rxOK} ok, ${rxFail} fail. First error: ${rxFirstErr?.message}`)
        if (rxFirstErr?.code === '42501') {
          warn('  → service_role thiếu GRANT trên chat_message_reactions. Chạy lại seed_demo_grants.sql.')
        }
      } else {
        ok(`Reactions on highlight message: ${rxOK}`)
      }
    }

    // Reactions on admin's DM with giamDoc (the "OK em, anh đang vào duyệt" message)
    const { data: dmMsg } = await svc.from('chat_messages')
      .select('id, context_id')
      .eq('author_id', realAdmin.id)
      .ilike('content', '%duyệt liền%')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (dmMsg) {
      const { error } = await svc.from('chat_message_reactions').insert({
        message_id: dmMsg.id, user_id: P.giamDoc, emoji: '👍',
      })
      if (error && error.code !== '23505') warn(`DM reaction: ${error.message}`)
    }
  }


  // ── Done ───────────────────────────────────────────────────────────────────
  console.log()
  console.log(c.bold(c.green('✅ Demo seed hoàn tất!')))
  console.log()
  console.log(c.bold('📌 Tài khoản đăng nhập (password: ' + c.yellow(DEMO_PASS) + ')'))
  console.log()
  console.log(`  ${'Role'.padEnd(7)} │ ${'Email'.padEnd(38)} │ Tên`)
  console.log(`  ${'─'.repeat(7)}─┼─${'─'.repeat(38)}─┼──────────────────────────────`)
  const sample = [
    ...PEOPLE.filter(p => p.role === 'admin'),
    ...PEOPLE.filter(p => p.role === 'editor'),
    PEOPLE.find(p => p.key === 'nvQ1_1'),
    PEOPLE.find(p => p.key === 'nvQ3_1'),
    PEOPLE.find(p => p.key === 'nvBT_1'),
  ]
  for (const p of sample) {
    const role  = p.role.padEnd(7)
    const email = p.email.padEnd(38)
    console.log(`  ${c.yellow(role)} │ ${email} │ ${p.name} (${p.title})`)
  }
  console.log()
  console.log(c.dim('  (Run with --wipe to delete all demo data, --reset to wipe+reseed)'))
  console.log()
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  console.log()
  console.log(c.bold('🏪 Minh Phúc Food & Household — Demo Seed'))
  console.log(c.dim(`   ${SB_URL}`))
  console.log()

  if (WIPE || RESET) {
    await wipe()
    if (WIPE) { console.log(); process.exit(0) }
  }

  await seed()
}

main().catch(e => {
  console.error(c.red('\nFatal: ' + e.message))
  if (process.env.VERBOSE) console.error(e.stack)
  process.exit(1)
})
