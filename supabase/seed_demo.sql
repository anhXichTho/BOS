-- ============================================================
-- Demo data — run AFTER schema.sql + migration_phase_a.sql
-- Idempotent: safe to re-run; uses on-conflict guards.
-- Requires at least one admin profile to exist (used as creator).
-- ============================================================

do $$
declare
  v_admin     uuid;
  v_channel_general uuid;
  v_channel_dev     uuid;
  v_channel_design  uuid;
  v_project_web     uuid;
  v_project_mobile  uuid;
  v_project_infra   uuid;
  v_project_brand   uuid;
  v_template_brief  uuid;
  v_template_bug    uuid;
  v_workflow_launch uuid;
  v_step_kickoff    uuid;
  v_step_design     uuid;
  v_step_dev        uuid;
  v_step_qa         uuid;
  v_step_release    uuid;
begin
  -- ─── Resolve the admin user ─────────────────────────────────
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    raise exception 'Demo seed needs an admin profile. Set role=''admin'' on a profile first.';
  end if;

  -- ─── Channels ───────────────────────────────────────────────
  -- Channels have no unique constraint, so use a guard.
  insert into public.chat_channels (name, description, created_by)
  select 'general', 'Kênh chung của cả team', v_admin
  where not exists (select 1 from public.chat_channels where name = 'general');

  insert into public.chat_channels (name, description, created_by)
  select 'dev', 'Trao đổi kỹ thuật, code review', v_admin
  where not exists (select 1 from public.chat_channels where name = 'dev');

  insert into public.chat_channels (name, description, created_by)
  select 'design', 'Thảo luận thiết kế, UI/UX', v_admin
  where not exists (select 1 from public.chat_channels where name = 'design');

  select id into v_channel_general from public.chat_channels where name = 'general' limit 1;
  select id into v_channel_dev     from public.chat_channels where name = 'dev'     limit 1;
  select id into v_channel_design  from public.chat_channels where name = 'design'  limit 1;

  -- ─── Projects ───────────────────────────────────────────────
  insert into public.projects (title, slug, description, status, assigned_to, due_date, created_by)
  values
    ('Website Redesign Q3',  'website-redesign-q3',  'Thiết kế lại landing page và dashboard nội bộ.', 'in_progress', v_admin, current_date + 30, v_admin),
    ('Mobile App Launch',    'mobile-app-launch',    'Phát hành phiên bản iOS và Android v1.0.',         'open',        v_admin, current_date + 60, v_admin),
    ('Infra Upgrade',        'infra-upgrade',        'Chuyển hạ tầng sang Kubernetes có HA.',            'review',      v_admin, current_date + 14, v_admin),
    ('Brand Refresh',        'brand-refresh',        'Cập nhật logo và bộ nhận diện thương hiệu.',       'completed',   v_admin, null,              v_admin)
  on conflict (slug) do nothing;

  select id into v_project_web    from public.projects where slug = 'website-redesign-q3';
  select id into v_project_mobile from public.projects where slug = 'mobile-app-launch';
  select id into v_project_infra  from public.projects where slug = 'infra-upgrade';
  select id into v_project_brand  from public.projects where slug = 'brand-refresh';

  -- ─── Form templates ─────────────────────────────────────────
  insert into public.form_templates (name, description, fields, is_active, created_by)
  select 'Project Brief', 'Form khởi tạo dự án mới', $json$[
    {"id":"f1","label":"Tên dự án","type":"text","required":true,"placeholder":"VD: Website Q4"},
    {"id":"f2","label":"Mô tả ngắn","type":"textarea","required":true,"placeholder":"Mục tiêu, phạm vi…"},
    {"id":"f3","label":"Loại dự án","type":"select","required":true,"options":["Website","Mobile","Infra","Marketing"]},
    {"id":"f4","label":"Ngân sách (triệu VND)","type":"number","required":false,"validation":{"min":0}},
    {"id":"f5","label":"Deadline mong muốn","type":"date","required":false}
  ]$json$::jsonb, true, v_admin
  where not exists (select 1 from public.form_templates where name = 'Project Brief');

  insert into public.form_templates (name, description, fields, is_active, created_by)
  select 'Bug Report', 'Báo cáo lỗi sản phẩm', $json$[
    {"id":"b1","label":"Tiêu đề","type":"text","required":true,"placeholder":"Mô tả ngắn lỗi"},
    {"id":"b2","label":"Mức độ","type":"select","required":true,"options":["Thấp","Trung bình","Cao","Khẩn cấp"]},
    {"id":"b3","label":"Bước tái hiện","type":"textarea","required":true,"placeholder":"1.\n2.\n3."},
    {"id":"b4","label":"Có chặn release không?","type":"checkbox","required":false}
  ]$json$::jsonb, true, v_admin
  where not exists (select 1 from public.form_templates where name = 'Bug Report');

  select id into v_template_brief from public.form_templates where name = 'Project Brief';
  select id into v_template_bug   from public.form_templates where name = 'Bug Report';

  -- ─── Workflow templates ─────────────────────────────────────
  insert into public.workflow_templates (name, description, is_active, created_by)
  select 'Quy trình phát hành sản phẩm', 'Từ kickoff tới release', true, v_admin
  where not exists (select 1 from public.workflow_templates where name = 'Quy trình phát hành sản phẩm');

  select id into v_workflow_launch from public.workflow_templates where name = 'Quy trình phát hành sản phẩm';

  -- Steps (only insert if no steps exist for this template)
  if not exists (select 1 from public.workflow_steps where template_id = v_workflow_launch) then
    insert into public.workflow_steps (template_id, parent_step_id, branch_condition, title, description, step_type, branch_options, order_index)
    values (v_workflow_launch, null, null, 'Kickoff & lập kế hoạch',  'Họp khởi động, xác định scope.',           'simple', null, 0)
    returning id into v_step_kickoff;

    insert into public.workflow_steps (template_id, parent_step_id, branch_condition, title, description, step_type, branch_options, order_index)
    values (v_workflow_launch, null, null, 'Thiết kế UI/UX',           'Wireframe, mockup, prototype.',            'simple', null, 1)
    returning id into v_step_design;

    insert into public.workflow_steps (template_id, parent_step_id, branch_condition, title, description, step_type, branch_options, order_index)
    values (v_workflow_launch, null, null, 'Phát triển',                'Implement frontend + backend.',            'simple', null, 2)
    returning id into v_step_dev;

    insert into public.workflow_steps (template_id, parent_step_id, branch_condition, title, description, step_type, branch_options, order_index)
    values (v_workflow_launch, null, null, 'QA',                        'Test chức năng, regression.',              'branch', array['Pass','Fail'], 3)
    returning id into v_step_qa;

    insert into public.workflow_steps (template_id, parent_step_id, branch_condition, title, description, step_type, branch_options, order_index)
    values (v_workflow_launch, null, null, 'Release',                   'Deploy production, public announce.',      'simple', null, 4)
    returning id into v_step_release;

    -- Branch children: if QA fails, fix bugs
    insert into public.workflow_steps (template_id, parent_step_id, branch_condition, title, description, step_type, branch_options, order_index)
    values (v_workflow_launch, v_step_qa, 'Fail', 'Fix bugs & re-test', 'Khắc phục issue rồi quay lại QA.',         'simple', null, 0);
  end if;

  -- ─── Demo chat messages ─────────────────────────────────────
  -- Only seed if channels are empty (avoid re-spamming on re-runs)
  if not exists (select 1 from public.chat_messages where context_id = v_channel_general) then
    insert into public.chat_messages (context_type, context_id, author_id, message_type, content) values
      ('channel', v_channel_general, v_admin, 'text', 'Chào team, đây là kênh chung — mọi người post thông báo và thảo luận chung tại đây.'),
      ('channel', v_channel_general, v_admin, 'text', 'Lưu ý: tuần sau team sẽ có buổi sync về mục tiêu Q3 vào thứ 4. Anh em chuẩn bị slide nhé.');
  end if;

  if not exists (select 1 from public.chat_messages where context_id = v_channel_dev) then
    insert into public.chat_messages (context_type, context_id, author_id, message_type, content) values
      ('channel', v_channel_dev,     v_admin, 'text', 'Mọi người review giúp PR #142 nhé, mình đã tách nhỏ commit cho dễ đọc.'),
      ('channel', v_channel_dev,     v_admin, 'text', 'CI vừa fail trên branch main, mình đang investigate. Giữ branch khoan merge.');
  end if;

  if not exists (select 1 from public.chat_messages where context_id = v_channel_design) then
    insert into public.chat_messages (context_type, context_id, author_id, message_type, content) values
      ('channel', v_channel_design,  v_admin, 'text', 'Mockup v2 cho landing đã update trên Figma, link trong project Website Redesign.');
  end if;

  -- Project thread messages
  if not exists (select 1 from public.chat_messages where context_id = v_project_web) then
    insert into public.chat_messages (context_type, context_id, author_id, message_type, content) values
      ('project', v_project_web,     v_admin, 'text', 'Khởi động dự án redesign — milestone 1 deadline 15/05.'),
      ('project', v_project_web,     v_admin, 'text', 'Đã chốt design system màu sắc và typography. Bắt đầu làm component library.');
  end if;

  raise notice 'Demo data seeded successfully (admin = %).', v_admin;
end $$;
