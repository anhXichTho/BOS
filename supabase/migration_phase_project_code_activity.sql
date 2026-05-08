-- migration_phase_project_code_activity.sql (migration #24)
-- 1. Adds a unique short `code` to public.projects (auto-generated D-YYMMDD with
--    suffix on collision; user-editable later, must remain unique).
-- 2. Adds project_status_history audit table + trigger so activity feed can
--    surface status transitions.
-- 3. Adds get_project_activity_feed(p_project_id, p_limit) RPC unioning
--    workflow_runs, chat_messages, chat_attachments, form_submissions, and
--    project_status_history. Returns one ordered list of ProjectActivityEntry.
-- 4. Relaxes form_submissions.context_type CHECK to also allow 'workflow_run'
--    (introduced by migration #22 progressive fill — the CHECK constraint was
--    not relaxed there, which would have rejected workflow-run UPSERTs).
-- Idempotent — safe to re-run.

-- ── 0. Relax form_submissions.context_type CHECK ────────────────────────
-- Drop any existing CHECK on context_type (name unknown across deployments
-- since some were created via different migrations); then add a wider one.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.form_submissions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%context_type%'
  loop
    execute format('alter table public.form_submissions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.form_submissions
  add constraint form_submissions_context_type_check
  check (context_type in ('channel', 'project', 'standalone', 'workflow_run'));

-- ── 1. projects.code ──────────────────────────────────────────────────────
alter table public.projects
  add column if not exists code text;

-- Unique per project, but allow nulls during backfill window.
create unique index if not exists projects_code_unique_idx
  on public.projects (code)
  where code is not null;

-- Helper: format date as YYMMDD (using created_at when filling gaps)
create or replace function public._project_code_for_date(p_date date)
returns text language sql immutable as $$
  select 'D' || to_char(p_date, 'YYMMDD');
$$;

-- Helper: pick the next free code on a given date by appending letters/numbers.
-- Tries D{YYMMDD}, then D{YYMMDD}A..Z, then D{YYMMDD}1..9. Stays within 10 chars.
create or replace function public._next_project_code_for_date(p_date date)
returns text language plpgsql as $$
declare
  base       text := public._project_code_for_date(p_date);
  candidate  text;
  suffix     text;
  i          int;
begin
  -- Try the bare base first (D + 6 digits = 7 chars, fits).
  perform 1 from public.projects where code = base;
  if not found then return base; end if;

  -- Then A..Z, then 1..9, total 35 alternates per day. Plenty for v1.
  for i in 1..35 loop
    if i <= 26 then
      suffix := chr(64 + i);  -- A=65 → 'A'
    else
      suffix := (i - 26)::text;
    end if;
    candidate := base || suffix;
    perform 1 from public.projects where code = candidate;
    if not found then return candidate; end if;
  end loop;

  -- Fall back: D{YYMMDD}-{first 2 digits of random uuid}. Still ≤ 10 chars.
  return base || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 2);
end;
$$;

-- Auto-fill code on INSERT when not provided.
create or replace function public._projects_fill_code()
returns trigger language plpgsql as $$
begin
  if new.code is null or new.code = '' then
    new.code := public._next_project_code_for_date(coalesce(new.created_at::date, current_date));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_fill_code on public.projects;
create trigger trg_projects_fill_code
  before insert on public.projects
  for each row execute function public._projects_fill_code();

-- Backfill: any existing project without a code gets one based on its
-- created_at date. Loops because each call advances the suffix.
do $$
declare
  rec record;
  next_code text;
begin
  for rec in
    select id, created_at
      from public.projects
     where code is null
     order by created_at asc
  loop
    next_code := public._next_project_code_for_date(rec.created_at::date);
    update public.projects set code = next_code where id = rec.id;
  end loop;
end $$;

-- ── 2. project_status_history ────────────────────────────────────────────
create table if not exists public.project_status_history (
  id          uuid       primary key default gen_random_uuid(),
  project_id  uuid       not null references public.projects(id) on delete cascade,
  old_status  text,
  new_status  text       not null,
  changed_by  uuid       references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);

create index if not exists project_status_history_project_idx
  on public.project_status_history (project_id, changed_at desc);

alter table public.project_status_history enable row level security;

do $$ begin
  create policy "all members can read project status history"
    on public.project_status_history for select
    using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

grant select on public.project_status_history to authenticated;
grant select, insert, update, delete on public.project_status_history to service_role;

-- Audit trigger: log status transitions.
create or replace function public._projects_log_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_status_history (project_id, old_status, new_status, changed_by)
    values (new.id, null, new.status, new.created_by);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.project_status_history (project_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_log_status on public.projects;
create trigger trg_projects_log_status
  after insert or update of status on public.projects
  for each row execute function public._projects_log_status();

-- Backfill an initial 'created' row for projects without history yet.
insert into public.project_status_history (project_id, old_status, new_status, changed_by, changed_at)
select p.id, null, p.status, p.created_by, p.created_at
  from public.projects p
 where not exists (
   select 1 from public.project_status_history h where h.project_id = p.id
 );

-- ── 3. Activity feed RPC ─────────────────────────────────────────────────
-- Aggregates events from multiple tables for a single project (or all
-- projects when p_project_id is null) and returns a ranked list ordered by
-- created_at desc. The result columns mirror the ProjectActivityEntry TS type.
create or replace function public.get_project_activity_feed(
  p_project_id uuid default null,
  p_limit      int  default 30
)
returns table (
  kind                       text,
  created_at                 timestamptz,
  user_id                    uuid,
  user_name                  text,
  project_id                 uuid,
  project_code               text,
  project_title              text,
  summary                    text,
  target_workflow_run_id     uuid,
  target_chat_message_id     uuid,
  target_chat_channel_id     uuid,
  target_form_submission_id  uuid
) language sql stable security definer set search_path = public, pg_temp as $$
  with
  -- Workflow runs: started, completed, cancelled events derived from columns
  wf_started as (
    select
      'workflow_started'::text as kind,
      r.started_at              as created_at,
      r.run_by                  as user_id,
      p.full_name as user_name,
      r.project_id              as project_id,
      pj.code                   as project_code,
      pj.title                  as project_title,
      ('Bắt đầu nghiệp vụ: ' || coalesce(r.template_name, '?')) as summary,
      r.id                      as target_workflow_run_id,
      null::uuid                as target_chat_message_id,
      null::uuid                as target_chat_channel_id,
      null::uuid                as target_form_submission_id
    from public.workflow_runs r
    join public.projects pj on pj.id = r.project_id
    left join public.profiles p on p.id = r.run_by
    where r.project_id is not null
      and (p_project_id is null or r.project_id = p_project_id)
  ),
  wf_done as (
    select
      'workflow_completed'::text, r.completed_at,
      r.run_by, p.full_name,
      r.project_id, pj.code, pj.title,
      ('Hoàn thành nghiệp vụ: ' || coalesce(r.template_name, '?')),
      r.id, null::uuid, null::uuid, null::uuid
    from public.workflow_runs r
    join public.projects pj on pj.id = r.project_id
    left join public.profiles p on p.id = r.run_by
    where r.project_id is not null
      and r.completed_at is not null
      and r.status = 'completed'
      and (p_project_id is null or r.project_id = p_project_id)
  ),
  wf_cancel as (
    select
      'workflow_cancelled'::text, r.completed_at,
      r.run_by, p.full_name,
      r.project_id, pj.code, pj.title,
      ('Huỷ nghiệp vụ: ' || coalesce(r.template_name, '?')),
      r.id, null::uuid, null::uuid, null::uuid
    from public.workflow_runs r
    join public.projects pj on pj.id = r.project_id
    left join public.profiles p on p.id = r.run_by
    where r.project_id is not null
      and r.status = 'cancelled'
      and r.completed_at is not null
      and (p_project_id is null or r.project_id = p_project_id)
  ),
  -- Chat messages within project threads (context_type='project')
  chat as (
    select
      'chat_message'::text                       as kind,
      m.created_at,
      m.author_id                                as user_id,
      p.full_name             as user_name,
      pj.id                                      as project_id,
      pj.code                                    as project_code,
      pj.title                                   as project_title,
      ('Tin nhắn: ' || left(coalesce(nullif(m.content, ''), '(đính kèm)'), 80)) as summary,
      null::uuid                                 as target_workflow_run_id,
      m.id                                       as target_chat_message_id,
      null::uuid                                 as target_chat_channel_id,
      null::uuid                                 as target_form_submission_id
    from public.chat_messages m
    join public.projects pj on pj.id = m.context_id
    left join public.profiles p on p.id = m.author_id
    where m.context_type = 'project'
      and (p_project_id is null or m.context_id = p_project_id)
  ),
  -- File uploads (chat_attachments via their messages)
  files as (
    select
      'file_upload'::text                        as kind,
      m.created_at                               as created_at,
      m.author_id                                as user_id,
      p.full_name             as user_name,
      pj.id                                      as project_id,
      pj.code                                    as project_code,
      pj.title                                   as project_title,
      ('File đính kèm: ' || coalesce(a.file_name, '?')) as summary,
      null::uuid                                 as target_workflow_run_id,
      m.id                                       as target_chat_message_id,
      null::uuid                                 as target_chat_channel_id,
      null::uuid                                 as target_form_submission_id
    from public.chat_attachments a
    join public.chat_messages m on m.id = a.message_id
    join public.projects pj on pj.id = m.context_id
    left join public.profiles p on p.id = m.author_id
    where m.context_type = 'project'
      and (p_project_id is null or m.context_id = p_project_id)
  ),
  -- Standalone form submissions (context_type='project' — workflow-run forms covered by wf_*)
  forms as (
    select
      'form_submission'::text                    as kind,
      f.submitted_at                             as created_at,
      f.submitted_by                             as user_id,
      p.full_name             as user_name,
      pj.id                                      as project_id,
      pj.code                                    as project_code,
      pj.title                                   as project_title,
      ('Form đã nộp: ' || coalesce(f.template_name, '?')) as summary,
      null::uuid                                 as target_workflow_run_id,
      null::uuid                                 as target_chat_message_id,
      null::uuid                                 as target_chat_channel_id,
      f.id                                       as target_form_submission_id
    from public.form_submissions f
    join public.projects pj on pj.id = f.context_id
    left join public.profiles p on p.id = f.submitted_by
    where f.context_type = 'project'
      and (p_project_id is null or f.context_id = p_project_id)
  ),
  -- Status changes
  statuses as (
    select
      case when h.old_status is null then 'project_created' else 'project_status_changed' end as kind,
      h.changed_at                               as created_at,
      h.changed_by                               as user_id,
      p.full_name             as user_name,
      pj.id                                      as project_id,
      pj.code                                    as project_code,
      pj.title                                   as project_title,
      case when h.old_status is null
        then 'Tạo dự án (trạng thái: ' || h.new_status || ')'
        else 'Đổi trạng thái: ' || coalesce(h.old_status, '?') || ' → ' || h.new_status
      end                                         as summary,
      null::uuid, null::uuid, null::uuid, null::uuid
    from public.project_status_history h
    join public.projects pj on pj.id = h.project_id
    left join public.profiles p on p.id = h.changed_by
    where (p_project_id is null or h.project_id = p_project_id)
  )
  select * from (
    select * from wf_started
    union all select * from wf_done
    union all select * from wf_cancel
    union all select * from chat
    union all select * from files
    union all select * from forms
    union all select * from statuses
  ) all_events
  where created_at is not null
  order by created_at desc
  limit p_limit;
$$;

grant execute on function public.get_project_activity_feed(uuid, int) to authenticated;
grant execute on function public.get_project_activity_feed(uuid, int) to service_role;

-- ── PostgREST schema reload ──
notify pgrst, 'reload schema';
