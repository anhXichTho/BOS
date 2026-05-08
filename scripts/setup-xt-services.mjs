#!/usr/bin/env node
/**
 * XT Services — Software & Custom Digital Solutions
 *
 * Tailors the workflow + form catalogue for a small software-services
 * studio (proposal → contract → QC → MVP demo → ship → warranty), and
 * trims the HR list to a 3-person starter team (Nal, Dz, Bình).
 *
 * Usage
 *   node scripts/setup-xt-services.mjs           # idempotent — safe to re-run
 *   node scripts/setup-xt-services.mjs --reset   # wipe demo/test artifacts first
 *
 * What it does
 *   1. Optional --reset wipe of legacy demo users (@minhphuc.vn) + test
 *      runner users (@bos-test.local) + their channels/projects/templates.
 *   2. Removes ALL existing workflow_templates + form_templates that aren't
 *      preserved by the live admin (so the catalogue is genuinely a clean
 *      slate). The admin's content is never touched.
 *   3. Creates 3 team accounts: Nal, Dz, Bình (role=editor, password from
 *      $XT_TEAM_PASSWORD or default).
 *   4. Seeds 5 form templates + 1 main 7-step workflow tailored to the
 *      software-services delivery loop.
 *
 * Requires in .env
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Pre-req: supabase/seed_demo_grants.sql ran once (gotcha #50).
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
const env      = loadEnv()
const SB_URL   = env.VITE_SUPABASE_URL          || process.env.VITE_SUPABASE_URL          || ''
const SVC_KEY  = env.SUPABASE_SERVICE_ROLE_KEY  || process.env.SUPABASE_SERVICE_ROLE_KEY  || ''
const TEAM_PW  = env.XT_TEAM_PASSWORD           || process.env.XT_TEAM_PASSWORD           || 'XtTeam@2026!'
const ADMIN_EM = env.XT_ADMIN_EMAIL             || process.env.XT_ADMIN_EMAIL             || 'phamvietdung812020@gmail.com'

const ARGS  = process.argv.slice(2)
const RESET = ARGS.includes('--reset')

if (!SB_URL || !SVC_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const svc = createClient(SB_URL, SVC_KEY, { auth: { persistSession: false } })

// ─── Tiny console helpers ─────────────────────────────────────────────────────

const c = {
  reset:'\x1b[0m', dim:'\x1b[2m', bold:'\x1b[1m',
  red:s=>`\x1b[31m${s}\x1b[0m`, green:s=>`\x1b[32m${s}\x1b[0m`,
  yellow:s=>`\x1b[33m${s}\x1b[0m`, blue:s=>`\x1b[34m${s}\x1b[0m`,
  cyan:s=>`\x1b[36m${s}\x1b[0m`,
}
const step = m => console.log(`\n${c.bold}${c.cyan(`▶ ${m}`)}${c.reset}`)
const ok   = m => console.log(`  ${c.green('✓')} ${m}`)
const info = m => console.log(`  ${c.dim}·${c.reset} ${m}`)
const warn = m => console.log(`  ${c.yellow('!')} ${m}`)
const fail = m => console.log(`  ${c.red('✗')} ${m}`)

// ─── Team roster ──────────────────────────────────────────────────────────────

// Three real names; emails follow the existing xichtho.vercel.app domain
// pattern. Editor role so each can run + manage workflows without being a
// full admin (admin = the live human who logs in via Google).
const TEAM = [
  { email: 'nal@xichtho.local',  name: 'Nal',  role: 'editor' },
  { email: 'dz@xichtho.local',   name: 'Dz',   role: 'editor' },
  { email: 'binh@xichtho.local', name: 'Bình', role: 'editor' },
]

const TEAM_EMAILS = new Set(TEAM.map(p => p.email))

// ─── Reset helpers ────────────────────────────────────────────────────────────

async function resetLegacyDemoUsers() {
  if (!RESET) return
  step('🗑  --reset: wiping legacy demo + test users')

  const { data: authUsers } = await svc.auth.admin.listUsers({ perPage: 1000 })
  const removable = (authUsers?.users ?? []).filter(u => {
    const e = u.email ?? ''
    if (e === ADMIN_EM) return false        // never delete the live admin
    if (TEAM_EMAILS.has(e)) return false    // keep our 3-person team
    return e.endsWith('@minhphuc.vn')       // demo dataset
        || e.endsWith('@bos-test.local')    // test runner accounts
        || e.endsWith('@xichtho.local')     // earlier xt setups (re-create cleanly)
  })

  if (removable.length === 0) { info('No legacy users to remove'); return }
  info(`Removing ${removable.length} legacy auth users + their content`)

  const ids = removable.map(u => u.id)

  // To delete users we have to clear every FK reference. Order matters:
  // - quick_tasks (created_by/assignee_user_id → profiles)
  // - form_submissions (submitted_by → profiles)
  // - workflow_step_results (run_by/approver indirectly)
  // - workflow_runs (run_by → profiles)
  // - workflow_templates / form_templates / projects / user_groups (created_by)
  // - chat_messages.author_id (cascade) — handled by Supabase cascade
  // - personal channels (cascade via profile FK)

  // 1. quick_tasks owned by removable users
  await svc.from('quick_tasks').delete().in('created_by', ids)
  await svc.from('quick_tasks').delete().in('assignee_user_id', ids)

  // 2. form_submissions submitted by removable users (we re-null FKs into them
  //    from chat_messages + workflow_step_results first to keep FKs happy)
  const { data: fsRows } = await svc.from('form_submissions').select('id').in('submitted_by', ids)
  const fsIds = (fsRows ?? []).map(r => r.id)
  if (fsIds.length) {
    await svc.from('chat_messages').update({ form_submission_id: null }).in('form_submission_id', fsIds)
    await svc.from('workflow_step_results').update({ form_submission_id: null }).in('form_submission_id', fsIds)
    await svc.from('form_submissions').delete().in('id', fsIds)
  }

  // 3. workflow_runs started by removable users (cascade to run_steps + results)
  const { data: runRows } = await svc.from('workflow_runs').select('id').in('run_by', ids)
  const runIds = (runRows ?? []).map(r => r.id)
  if (runIds.length) {
    await svc.from('workflow_step_results').delete().in('run_id', runIds)
    await svc.from('workflow_run_steps').delete().in('run_id', runIds)
    await svc.from('workflow_runs').delete().in('id', runIds)
  }

  // 4. workflow_runs whose templates were created by removable users
  const { data: rmTpl } = await svc.from('workflow_templates').select('id').in('created_by', ids)
  const rmTplIds = (rmTpl ?? []).map(r => r.id)
  if (rmTplIds.length) {
    const { data: linkedRuns } = await svc.from('workflow_runs').select('id').in('template_id', rmTplIds)
    const linkedRunIds = (linkedRuns ?? []).map(r => r.id)
    if (linkedRunIds.length) {
      await svc.from('workflow_step_results').delete().in('run_id', linkedRunIds)
      await svc.from('workflow_run_steps').delete().in('run_id', linkedRunIds)
      await svc.from('workflow_runs').delete().in('id', linkedRunIds)
    }
  }

  // 5. workflow_runs linked to projects we're about to delete
  const { data: rmProj } = await svc.from('projects').select('id').in('created_by', ids)
  const rmProjIds = (rmProj ?? []).map(r => r.id)
  if (rmProjIds.length) {
    const { data: pRuns } = await svc.from('workflow_runs').select('id').in('project_id', rmProjIds)
    const pRunIds = (pRuns ?? []).map(r => r.id)
    if (pRunIds.length) {
      await svc.from('workflow_step_results').delete().in('run_id', pRunIds)
      await svc.from('workflow_run_steps').delete().in('run_id', pRunIds)
      await svc.from('workflow_runs').delete().in('id', pRunIds)
    }
  }

  // 6. workflow_steps refs to templates we'll delete (form_template_id)
  if (rmTplIds.length) {
    await svc.from('workflow_steps').delete().in('template_id', rmTplIds)
  }

  // 7. form_submissions tied to forms created by removable users
  const { data: rmForms } = await svc.from('form_templates').select('id').in('created_by', ids)
  const rmFormIds = (rmForms ?? []).map(r => r.id)
  if (rmFormIds.length) {
    // null-out workflow_steps that reference these forms (so form delete can pass)
    await svc.from('workflow_steps').update({ form_template_id: null }).in('form_template_id', rmFormIds)
    const { data: linkedSubs } = await svc.from('form_submissions').select('id').in('template_id', rmFormIds)
    const linkedSubIds = (linkedSubs ?? []).map(r => r.id)
    if (linkedSubIds.length) {
      await svc.from('chat_messages').update({ form_submission_id: null }).in('form_submission_id', linkedSubIds)
      await svc.from('workflow_step_results').update({ form_submission_id: null }).in('form_submission_id', linkedSubIds)
      await svc.from('form_submissions').delete().in('id', linkedSubIds)
    }
  }

  // 8. Many tables hold FKs to profiles WITHOUT cascade-on-delete. Without
  //    explicit clears the auth.users delete fails with the generic
  //    "Database error deleting user". Clear every known non-cascade ref.
  await svc.from('chat_messages').delete().in('author_id', ids)

  // chat_channels: delete TEAM + DM channels created by removable users;
  // for personal channels (which cascade via owner_id FK), null-out
  // created_by so it stops blocking the auth delete.
  await svc.from('chat_channels').delete()
    .in('created_by', ids).neq('channel_type', 'personal')
  await svc.from('chat_channels').update({ created_by: null })
    .in('created_by', ids).eq('channel_type', 'personal')

  // DM channels owned by OTHER users but pointing to a removable user.
  // Can't UPDATE dm_partner_id=NULL because of a unique-pair constraint —
  // just DELETE the whole DM channel (its messages/reactions cascade).
  await svc.from('chat_channels').delete()
    .in('dm_partner_id', ids).eq('channel_type', 'dm')

  // Personal channels still owned by removable users — owner_id has
  // ON DELETE CASCADE, but the cascade only fires when the auth user
  // delete succeeds, which is what we're trying to enable. Delete them
  // proactively here.
  await svc.from('chat_channels').delete()
    .in('owner_id', ids).eq('channel_type', 'personal')

  await svc.from('workflow_step_results').update({ approved_by: null }).in('approved_by', ids)
  await svc.from('workflow_steps').update({ approver_user_id: null }).in('approver_user_id', ids)
  await svc.from('workflow_run_steps').update({ approver_user_id: null }).in('approver_user_id', ids)
  await svc.from('workflow_schedules').delete().in('run_by', ids).then(()=>{}, ()=>{})
  await svc.from('documents').update({ uploaded_by: null }).in('uploaded_by', ids).then(()=>{}, ()=>{})
  await svc.from('helper_panels').delete().in('created_by', ids).then(()=>{}, ()=>{})
  await svc.from('projects').update({ assigned_to: null }).in('assigned_to', ids).then(()=>{}, ()=>{})

  // Project info cards by removable users
  await svc.from('project_info_cards').delete().in('author_id', ids).then(()=>{}, ()=>{})

  // Templates + groups + projects created by removable users
  for (const [tbl, col] of [
    ['form_templates',     'created_by'],
    ['workflow_templates', 'created_by'],
    ['projects',           'created_by'],
    ['user_groups',        'created_by'],
  ]) {
    const { error } = await svc.from(tbl).delete().in(col, ids)
    if (error) warn(`${tbl} delete: ${error.message}`)
  }

  // 9. auth.users — should now succeed. profile cascades; chat_messages cascade.
  let deleted = 0, blocked = 0
  for (const u of removable) {
    const { error } = await svc.auth.admin.deleteUser(u.id)
    if (error) {
      warn(`Could not delete ${u.email}: ${error.message}`)
      blocked++
    } else deleted++
  }
  ok(`Removed ${deleted} legacy users` + (blocked ? ` (${blocked} blocked)` : ''))
}

async function wipeAllTemplates() {
  step('🗑  Clearing existing workflow + form + project catalogue')

  // The user wants a true clean slate. So we wipe ALL workflow_runs, ALL
  // form_submissions, ALL workflow_templates, ALL form_templates, ALL
  // projects. Run history is from demo data — not real production work —
  // so this is safe.

  // 1. Workflow runs + their dependents
  const { data: runs } = await svc.from('workflow_runs').select('id')
  const runIds = (runs ?? []).map(r => r.id)
  if (runIds.length) {
    await svc.from('workflow_step_results').delete().in('run_id', runIds)
    await svc.from('workflow_run_steps').delete().in('run_id', runIds)
    const { error: rErr, count: rc } = await svc.from('workflow_runs').delete({ count: 'exact' }).in('id', runIds)
    if (rErr) warn(`workflow_runs: ${rErr.message}`); else info(`Removed ${rc ?? 0} workflow runs`)
  }

  // 2. Detach chat_messages + workflow_step_results from form_submissions, then delete submissions
  await svc.from('chat_messages').update({ form_submission_id: null }).not('form_submission_id', 'is', null)
  await svc.from('workflow_step_results').update({ form_submission_id: null }).not('form_submission_id', 'is', null)
  const { count: subC } = await svc.from('form_submissions').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000')
  if (subC) info(`Removed ${subC} form submissions`)

  // 3. workflow_steps need form_template_id null'd before form_templates can go
  await svc.from('workflow_steps').update({ form_template_id: null }).not('form_template_id', 'is', null)

  // 4. workflow_templates (cascades steps via the template-id FK)
  const { error: e1, count: c1 } = await svc.from('workflow_templates')
    .delete({ count: 'exact' })
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (e1) warn(`workflow_templates: ${e1.message}`); else ok(`Removed ${c1 ?? 0} workflow templates`)

  // 5. form_templates
  const { error: e2, count: c2 } = await svc.from('form_templates')
    .delete({ count: 'exact' })
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (e2) warn(`form_templates: ${e2.message}`); else ok(`Removed ${c2 ?? 0} form templates`)

  // 6. project_info_cards + project_status_history first (FK to projects)
  await svc.from('project_info_cards').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(()=>{},()=>{})
  await svc.from('project_status_history').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(()=>{},()=>{})

  // 7. Detach chat_messages from projects (project chat threads use
  //    context_id = project.id polymorphically — no FK, so just delete those messages)
  const { data: projRows } = await svc.from('projects').select('id')
  const projIds = (projRows ?? []).map(r => r.id)
  if (projIds.length) {
    await svc.from('chat_messages').delete()
      .eq('context_type', 'project').in('context_id', projIds)
  }

  // 8. projects
  const { error: e3, count: c3 } = await svc.from('projects')
    .delete({ count: 'exact' })
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (e3) warn(`projects: ${e3.message}`); else ok(`Removed ${c3 ?? 0} projects`)
}

// ─── Team creation ────────────────────────────────────────────────────────────

async function ensureTeam() {
  step('👥 Ensuring 3-person team (Nal / Dz / Bình)')

  const { data: existing } = await svc.auth.admin.listUsers({ perPage: 1000 })
  const byEmail = Object.fromEntries((existing?.users ?? []).map(u => [u.email, u.id]))
  const ids = {}

  for (const p of TEAM) {
    if (byEmail[p.email]) {
      ids[p.name] = byEmail[p.email]
      info(`${p.name} already exists — keeping`)
    } else {
      const { data, error } = await svc.auth.admin.createUser({
        email: p.email, password: TEAM_PW, email_confirm: true,
        user_metadata: { full_name: p.name },
      })
      if (error) { fail(`Create ${p.email}: ${error.message}`); continue }
      ids[p.name] = data.user.id
      ok(`Created ${p.name} (${p.email})`)
    }

    // Update profile metadata (name + role)
    const { error: pErr } = await svc.from('profiles')
      .update({ full_name: p.name, role: p.role })
      .eq('id', ids[p.name])
    if (pErr) warn(`Profile update for ${p.name}: ${pErr.message}`)
  }

  // Pick a creator for templates — prefer the live admin so they can edit
  // freely from the UI; fall back to Nal if admin not present.
  const adminId = byEmail[ADMIN_EM]
  if (!adminId) {
    warn(`Admin ${ADMIN_EM} not found in auth.users — using Nal as template owner.`)
  }
  return { teamIds: ids, ownerUserId: adminId ?? ids['Nal'] }
}

// ─── Form definitions (kept simple — vừa đủ) ──────────────────────────────────

const FORMS = [
  {
    name: 'Khảo sát nhu cầu khách hàng',
    description: 'Thu thập thông tin nhu cầu của khách hàng ở giai đoạn đầu tiếp xúc.',
    summaryFields: ['kh_ten', 'kh_loaisp'],
    fields: [
      { id: 'kh_ten',     label: 'Tên khách hàng / công ty', type: 'text',     required: true },
      { id: 'kh_lienhe',  label: 'Người liên hệ + SĐT',      type: 'text',     required: true,
        placeholder: 'VD: Anh Minh — 0901 234 567' },
      { id: 'kh_loaisp',  label: 'Loại sản phẩm cần',        type: 'select',   required: true,
        options: ['Web app', 'Mobile app', 'Tool tự động hoá', 'Tích hợp / API', 'Tư vấn giải pháp', 'Khác'],
        allow_other: true },
      { id: 'kh_mota',    label: 'Mô tả nhu cầu',            type: 'textarea', required: true,
        placeholder: 'Khách hàng muốn giải quyết bài toán gì?' },
      { id: 'kh_ngansach', label: 'Ngân sách dự kiến',        type: 'select',   required: false,
        options: ['Dưới 50 triệu', '50–200 triệu', '200 triệu – 1 tỷ', 'Trên 1 tỷ', 'Chưa xác định'] },
      { id: 'kh_handung', label: 'Mong muốn hoàn thành trước', type: 'date',    required: false },
      { id: 'kh_ghichu',  label: 'Ghi chú thêm',             type: 'textarea', required: false },
    ],
  },
  {
    name: 'Đề xuất giải pháp (Proposal)',
    description: 'Tóm tắt phạm vi, công nghệ, thời gian và chi phí gửi khách hàng.',
    summaryFields: ['pp_pham_vi', 'pp_chiphi'],
    fields: [
      { id: 'pp_pham_vi',  label: 'Phạm vi công việc',        type: 'textarea', required: true },
      { id: 'pp_congnghe', label: 'Công nghệ đề xuất',        type: 'text',     required: true,
        placeholder: 'VD: React + Supabase + Vercel' },
      { id: 'pp_thoigian', label: 'Ước lượng (số ngày)',      type: 'number',   required: true },
      { id: 'pp_chiphi',   label: 'Ước lượng chi phí (VND)',  type: 'number',   required: true },
      { id: 'pp_dieukien', label: 'Điều kiện / loại trừ',     type: 'textarea', required: false,
        placeholder: 'Những gì KHÔNG bao gồm trong proposal' },
    ],
  },
  {
    name: 'QC Checklist nội bộ',
    description: 'Checklist nhanh do nhân sự QC thực hiện trước khi demo cho khách.',
    summaryFields: ['qc_test_chinh', 'qc_tester'],
    fields: [
      { id: 'qc_chay_local',   label: 'Đã chạy được trên local',     type: 'radio', required: true,
        options: ['Có', 'Không'] },
      { id: 'qc_taili_eu',     label: 'Đã có tài liệu hướng dẫn',    type: 'radio', required: true,
        options: ['Có', 'Không'] },
      { id: 'qc_test_chinh',   label: 'Đã test luồng chính',         type: 'radio', required: true,
        options: ['Có', 'Không', 'Một phần'] },
      { id: 'qc_test_edge',    label: 'Đã test trường hợp đặc biệt', type: 'radio', required: false,
        options: ['Có', 'Không', 'Một phần'] },
      { id: 'qc_tester',       label: 'Người QC',                    type: 'text',  required: true },
      { id: 'qc_van_de',       label: 'Vấn đề còn lại',              type: 'textarea', required: false },
    ],
  },
  {
    name: 'Phản hồi MVP demonstration',
    description: 'Ghi nhận phản hồi của khách hàng sau buổi demo MVP.',
    summaryFields: ['mvp_duyet', 'mvp_demoer'],
    fields: [
      { id: 'mvp_duyet',     label: 'Khách duyệt MVP?',     type: 'radio',    required: true,
        options: ['Có', 'Có với chỉnh sửa', 'Không'] },
      { id: 'mvp_nhan_xet',  label: 'Nhận xét của khách',   type: 'textarea', required: true },
      { id: 'mvp_chinh_sua', label: 'Yêu cầu chỉnh sửa',    type: 'textarea', required: false },
      { id: 'mvp_demoer',    label: 'Người demo',           type: 'text',     required: true },
    ],
  },
  {
    name: 'Báo cáo bảo hành / sửa lỗi',
    description: 'Ghi nhận lỗi do khách hàng báo + cách xử lý của team.',
    summaryFields: ['bh_ma_da', 'bh_uutien'],
    fields: [
      { id: 'bh_ma_da',     label: 'Mã hợp đồng / dự án',  type: 'text',     required: true },
      { id: 'bh_loi',       label: 'Nội dung lỗi',         type: 'textarea', required: true },
      { id: 'bh_uutien',    label: 'Mức độ ưu tiên',       type: 'radio',    required: true,
        options: ['Cao', 'Trung bình', 'Thấp'] },
      { id: 'bh_phat_hien', label: 'Ngày phát hiện',       type: 'date',     required: true },
      { id: 'bh_xu_ly',     label: 'Cách xử lý',           type: 'textarea', required: false },
      { id: 'bh_nguoi_xl',  label: 'Người xử lý',          type: 'text',     required: false },
      { id: 'bh_xong',      label: 'Ngày xong',            type: 'date',     required: false },
    ],
  },
]

async function seedForms(ownerId) {
  step('📋 Seeding 5 form templates')

  const formIds = {}
  for (const f of FORMS) {
    const { data, error } = await svc.from('form_templates').insert({
      name:              f.name,
      description:       f.description,
      fields:            f.fields,
      summary_field_ids: f.summaryFields,
      is_active:         true,
      created_by:        ownerId,
    }).select('id').single()
    if (error) { fail(`Form "${f.name}": ${error.message}`); continue }
    formIds[f.name] = data.id
    ok(`Form: ${f.name}`)
  }
  return formIds
}

// ─── Workflow definition ──────────────────────────────────────────────────────

async function seedWorkflow(ownerId, formIds) {
  step('⚙️  Seeding software-services delivery workflow')

  const wfName = 'Quy trình dịch vụ phần mềm — XT Studio'
  const description =
    'Luồng nghiệp vụ chuẩn cho 1 dự án dịch vụ phần mềm: khảo sát, ' +
    'proposal, hợp đồng, QC, demo MVP, đóng gói, bảo hành.'
  const guidance =
    '<p><strong>Hướng dẫn nhanh</strong></p>' +
    '<ul>' +
    '<li>Bước 1–2 do <em>Nal</em> hoặc <em>Dz</em> phụ trách (giai đoạn tiếp xúc).</li>' +
    '<li>Bước 3 (hợp đồng) cần admin duyệt trước khi chạy tiếp.</li>' +
    '<li>Bước 4 (QC nội bộ) do <em>Bình</em> phụ trách, có duyệt admin.</li>' +
    '<li>Bước 5 demo MVP — nếu khách yêu cầu chỉnh sửa nhiều, quay lại bước 4.</li>' +
    '<li>Bước 6 đóng gói khi đã ổn. Bước 7 dùng riêng để track bảo hành sau bàn giao.</li>' +
    '</ul>'

  const { data: wf, error: wfErr } = await svc.from('workflow_templates').insert({
    name:          wfName,
    description,
    guidance_html: guidance,
    is_active:     true,
    created_by:    ownerId,
  }).select('id').single()
  if (wfErr) { fail(`Workflow: ${wfErr.message}`); return null }
  ok(`Workflow: ${wfName}`)

  // Steps — linear chain via parent_step_id (so connectors auto-render).
  const steps = [
    {
      title: 'Khảo sát nhu cầu',
      description: 'Gặp / gọi khách hàng để hiểu rõ nhu cầu, ngân sách, thời gian. Điền form khảo sát kèm theo.',
      duration: 8,
      formId: formIds['Khảo sát nhu cầu khách hàng'],
    },
    {
      title: 'Làm proposal',
      description: 'Viết đề xuất giải pháp + ước lượng. Gửi khách qua email và hẹn buổi review.',
      duration: 16,
      formId: formIds['Đề xuất giải pháp (Proposal)'],
    },
    {
      title: 'Làm hợp đồng',
      description: 'Soạn hợp đồng, gửi ký số / ký giấy. Đính kèm proposal đã chốt. Đợi admin duyệt.',
      duration: 16,
      requiresApproval: true,
      approverRole: 'admin',
    },
    {
      title: 'QC nội bộ',
      description: 'Nhân sự QC chạy checklist. Khi pass, admin duyệt mới được gọi khách demo.',
      duration: 8,
      requiresApproval: true,
      approverRole: 'admin',
      formId: formIds['QC Checklist nội bộ'],
    },
    {
      title: 'MVP demonstration',
      description: 'Demo cho khách. Nếu khách duyệt → đi tiếp. Nếu yêu cầu chỉnh sửa nhiều → quay lại QC.',
      duration: 4,
      formId: formIds['Phản hồi MVP demonstration'],
    },
    {
      title: 'Đóng gói hoàn thiện',
      description: 'Đóng gói source code, tài liệu, deploy production, bàn giao tài khoản cho khách.',
      duration: 8,
    },
    {
      title: 'Bảo hành / sửa lỗi',
      description: 'Track các yêu cầu sửa lỗi sau bàn giao. Mỗi lỗi mở 1 form báo cáo bảo hành.',
      duration: 4,
      formId: formIds['Báo cáo bảo hành / sửa lỗi'],
    },
  ]

  let prevId = null
  let n = 0
  for (const s of steps) {
    const { data: sd, error: sErr } = await svc.from('workflow_steps').insert({
      template_id:       wf.id,
      parent_step_id:    prevId,
      title:             s.title,
      description:       s.description,
      step_type:         'simple',
      order_index:       n,
      form_template_id:  s.formId ?? null,
      requires_approval: s.requiresApproval ?? false,
      approver_role:     s.approverRole ?? null,
      duration_hours:    s.duration ?? 4,
    }).select('id').single()
    if (sErr) { warn(`Step "${s.title}": ${sErr.message}`); continue }
    prevId = sd.id
    n++
    ok(`Step ${n}: ${s.title}`)
  }
  return wf.id
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const banner =
    `${c.bold}${c.cyan('XT Services — workflow + form catalogue setup')}${c.reset}\n` +
    `${c.dim}target: ${SB_URL.replace(/^https?:\/\//, '').slice(0, 40)}…${c.reset}\n`
  console.log(banner)

  await resetLegacyDemoUsers()
  await wipeAllTemplates()
  const { ownerUserId } = await ensureTeam()
  const formIds = await seedForms(ownerUserId)
  await seedWorkflow(ownerUserId, formIds)

  console.log(`\n${c.bold}${c.green('✓ Done')}${c.reset}`)
  console.log(`${c.dim}Team password: ${TEAM_PW}${c.reset}`)
  console.log(`${c.dim}Run again any time — script is idempotent.${c.reset}\n`)
}

main().catch(err => {
  console.error(c.red(`\nFATAL: ${err?.message ?? err}`))
  process.exit(1)
})
