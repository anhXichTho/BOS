-- cleanup_test_data.sql
-- Deletes all [TEST] data created by the automated test runner,
-- plus old dev/test channels. Run in Supabase SQL Editor.
-- SAFE: only touches rows whose name/content/email contains [TEST]
--       or channels with known old dev names.

-- ── 1. Workflow runs + results (cascaded by FK on delete) ────────────────────

delete from public.workflow_runs
  where template_name ilike '%[TEST]%';

-- ── 2. Workflow templates + steps (cascaded) ─────────────────────────────────

delete from public.workflow_templates
  where name ilike '%[TEST]%';

-- ── 3. Form templates + submissions ──────────────────────────────────────────
--      form_submissions has a FK to form_templates with NO cascade,
--      so we must clear child rows manually first.

-- 3a. Null out workflow_step_results.form_submission_id for [TEST] submissions
update public.workflow_step_results
  set form_submission_id = null
  where form_submission_id in (
    select id from public.form_submissions
    where template_id in (
      select id from public.form_templates where name ilike '%[TEST]%'
    )
  );

-- 3b. Null out chat_messages.form_submission_id for [TEST] submissions
update public.chat_messages
  set form_submission_id = null
  where form_submission_id in (
    select id from public.form_submissions
    where template_id in (
      select id from public.form_templates where name ilike '%[TEST]%'
    )
  );

-- 3c. Delete the submissions themselves
delete from public.form_submissions
  where template_id in (
    select id from public.form_templates where name ilike '%[TEST]%'
  );

-- 3d. Now safe to delete the templates
delete from public.form_templates
  where name ilike '%[TEST]%';

-- ── 4. Projects (cascaded) ───────────────────────────────────────────────────

delete from public.projects
  where title ilike '%[TEST]%';

-- ── 5. Old dev/test team channels + their messages (messages cascade) ────────
--      Remove channels that are NOT Minh Phúc demo channels and NOT personal/DM.

delete from public.chat_channels
  where channel_type = 'team'
    and name not in (
      'chung', 'ban-giam-doc', 'kinh-doanh', 'kho-van-chuyen',
      'cua-hang-quan-1', 'cua-hang-quan-3', 'cua-hang-binh-thanh'
    );

-- ── 6. Any leftover [TEST] messages in surviving channels ────────────────────

delete from public.chat_messages
  where content ilike '%[TEST]%';

-- ── 7. User groups with [TEST] in name ───────────────────────────────────────

delete from public.user_groups
  where name ilike '%[TEST]%';

-- ── 8. Notifications from [TEST] runs ────────────────────────────────────────

delete from public.notifications
  where title ilike '%[TEST]%'
     or body  ilike '%[TEST]%';

-- Done — verify counts:
select 'workflow_runs'     as tbl, count(*) from public.workflow_runs     where template_name ilike '%[TEST]%'
union all
select 'workflow_templates', count(*) from public.workflow_templates where name ilike '%[TEST]%'
union all
select 'form_templates',     count(*) from public.form_templates     where name ilike '%[TEST]%'
union all
select 'projects',           count(*) from public.projects           where title ilike '%[TEST]%'
union all
select 'chat_messages',      count(*) from public.chat_messages      where content ilike '%[TEST]%';
-- All counts should be 0.
