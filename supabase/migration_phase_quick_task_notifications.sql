-- migration_phase_quick_task_notifications.sql (round-9b — migration #32)
--
-- Extends task notification coverage:
--   0. fan_out_task_assignment update — also notify on self-assignment so
--      users get a bell reminder for tasks they created for themselves.
--   1. fan_out_task_completed  — notify creator when a task is marked done
--   2. fan_out_task_assignment_group — notify each group member when a task
--      is assigned to their group (was silent before; grouped into bell + push)
--   3. Widens notifications_kind_check to include dm_message / step_approved /
--      step_rejected so those kinds don't fail the constraint on insert.
--
-- Idempotent — safe to re-run.

-- ── 0. Update fan_out_task_assignment to include self-assignment ────────────
-- Original trigger (migration #31) skipped self-assignment. Users who create
-- tasks for themselves now get a bell notification as a reminder.

create or replace function public.fan_out_task_assignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  creator_name text;
begin
  -- Only handle user-assignee rows; group fan-out handled by separate trigger
  if new.assignee_user_id is null then
    return new;
  end if;

  select coalesce(full_name, 'Ai đó') into creator_name
    from public.profiles where id = new.created_by;

  insert into public.notifications (user_id, kind, title, body, payload)
  values (
    new.assignee_user_id,
    'task_assigned',
    'Bạn có việc mới: ' || new.title,
    case
      when new.assignee_user_id = new.created_by then 'Việc bạn tự giao cho mình'
      else coalesce(creator_name, 'Ai đó') || ' giao việc cho bạn'
    end,
    jsonb_build_object(
      'task_id',           new.id,
      'source_message_id', new.source_message_id
    )
  );

  return new;
end $$;

-- ── 1. task_completed trigger ───────────────────────────────────────────────
-- Fires when `status` changes TO 'done'.
-- Notifies the task CREATOR (if they didn't complete it themselves) and the
-- direct ASSIGNEE (if different from creator and completer).

create or replace function public.fan_out_task_completed()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  completer_id   uuid;
  completer_name text;
begin
  -- Completer is the authenticated user who ran the UPDATE.
  -- auth.uid() may be null when called from service-role scripts; guard below.
  completer_id := auth.uid();

  select coalesce(full_name, 'Ai đó') into completer_name
    from public.profiles where id = completer_id;

  -- Notify creator (skip if they completed it themselves)
  if new.created_by is not null
     and (completer_id is null or new.created_by != completer_id)
  then
    insert into public.notifications (user_id, kind, title, body, payload)
    values (
      new.created_by,
      'task_completed',
      'Việc đã xong: ' || new.title,
      coalesce(completer_name, 'Ai đó') || ' đã hoàn thành việc',
      jsonb_build_object('task_id', new.id)
    );
  end if;

  -- Notify direct assignee if they're different from the creator
  -- (avoids double notification to the same person)
  if new.assignee_user_id is not null
     and (completer_id is null or new.assignee_user_id != completer_id)
     and new.assignee_user_id is distinct from new.created_by
  then
    insert into public.notifications (user_id, kind, title, body, payload)
    values (
      new.assignee_user_id,
      'task_completed',
      'Việc đã được đánh dấu xong: ' || new.title,
      coalesce(completer_name, 'Ai đó') || ' đã hoàn thành việc',
      jsonb_build_object('task_id', new.id)
    );
  end if;

  return new;
end $$;

drop trigger if exists trg_fan_out_task_completed on public.quick_tasks;
create trigger trg_fan_out_task_completed
  after update on public.quick_tasks
  for each row
  when (old.status is distinct from new.status and new.status = 'done')
  execute function public.fan_out_task_completed();

-- ── 2. Group assignment fan-out ─────────────────────────────────────────────
-- When a task is assigned to a user_group, every group member (except the
-- creator) gets a task_assigned notification → shows in bell + triggers push.

create or replace function public.fan_out_task_assignment_group()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  creator_name text;
  group_name   text;
  member_id    uuid;
begin
  if new.assignee_group_id is null then
    return new;
  end if;

  select coalesce(full_name, 'Ai đó') into creator_name
    from public.profiles where id = new.created_by;

  select coalesce(name, 'nhóm') into group_name
    from public.user_groups where id = new.assignee_group_id;

  for member_id in
    select user_id from public.user_group_members
    where group_id = new.assignee_group_id
      and user_id is distinct from new.created_by
  loop
    insert into public.notifications (user_id, kind, title, body, payload)
    values (
      member_id,
      'task_assigned',
      'Nhóm ' || group_name || ' có việc mới: ' || new.title,
      creator_name || ' giao việc cho nhóm',
      jsonb_build_object(
        'task_id',          new.id,
        'source_message_id', new.source_message_id
      )
    );
  end loop;

  return new;
end $$;

drop trigger if exists trg_fan_out_task_assignment_group on public.quick_tasks;
create trigger trg_fan_out_task_assignment_group
  after insert on public.quick_tasks
  for each row
  execute function public.fan_out_task_assignment_group();

-- ── 3. Widen notifications_kind_check ──────────────────────────────────────
-- Previous constraint (migration #31) was missing dm_message / step_approved /
-- step_rejected, which would cause INSERT errors for those kinds.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention',
  'dm_message',
  'project_assigned',
  'workflow_assigned',
  'workflow_completed',
  'approval_requested',
  'step_approved',
  'step_rejected',
  'schedule_fired',
  'form_submitted',
  'doc_shared',
  'generic',
  'task_assigned',
  'task_completed'
));

-- ── 4. remind_task RPC ──────────────────────────────────────────────────────
-- Called by the frontend "Nhắc" button. Immediately inserts a notification
-- for the assignee (user) or all group members.
-- Only the task creator, or an admin/editor, may call this.

create or replace function public.remind_task(p_task_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  t           record;
  caller_name text;
  member_id   uuid;
  grp_name    text;
  is_allowed  boolean;
begin
  select * into t from public.quick_tasks where id = p_task_id;
  if not found then return; end if;

  -- Only creator or admin/editor can send a reminder
  select (t.created_by = auth.uid())
      or exists (
           select 1 from public.profiles
           where id = auth.uid() and role in ('admin', 'editor')
         )
    into is_allowed;

  if not is_allowed then
    raise exception 'unauthorized';
  end if;

  select coalesce(full_name, 'Ai đó') into caller_name
    from public.profiles where id = auth.uid();

  -- Remind user assignee
  if t.assignee_user_id is not null then
    insert into public.notifications (user_id, kind, title, body, payload)
    values (
      t.assignee_user_id,
      'task_assigned',
      '🔔 Nhắc việc: ' || t.title,
      caller_name || ' nhắc bạn về việc này',
      jsonb_build_object('task_id', t.id)
    );
  end if;

  -- Remind group members (skip the caller so they don't notify themselves)
  if t.assignee_group_id is not null then
    select coalesce(name, 'nhóm') into grp_name
      from public.user_groups where id = t.assignee_group_id;

    for member_id in
      select user_id from public.user_group_members
      where group_id = t.assignee_group_id
        and user_id is distinct from auth.uid()
    loop
      insert into public.notifications (user_id, kind, title, body, payload)
      values (
        member_id,
        'task_assigned',
        '🔔 Nhắc việc: ' || t.title,
        caller_name || ' nhắc nhóm ' || grp_name,
        jsonb_build_object('task_id', t.id)
      );
    end loop;
  end if;
end $$;

grant execute on function public.remind_task(uuid) to authenticated;

notify pgrst, 'reload schema';
