-- migration_phase_quick_task_notifications.sql (round-9b — migration #32)
--
-- Extends task notification coverage:
--   1. fan_out_task_completed  — notify creator when a task is marked done
--   2. fan_out_task_assignment_group — notify each group member when a task
--      is assigned to their group (was silent before; grouped into bell + push)
--   3. Widens notifications_kind_check to include dm_message / step_approved /
--      step_rejected so those kinds don't fail the constraint on insert.
--
-- Idempotent — safe to re-run.

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

notify pgrst, 'reload schema';
