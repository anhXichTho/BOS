-- migration_phase_quick_tasks.sql (round-9 — migration #31)
--
-- Quick TODO center: lightweight tasks lighter than full workflows.
-- Each task: title + optional rich-text description + assignee (user OR
-- group) + optional source chat_message link + status + optional due date.
--
-- Visibility: creator + assignee + group members + admin/editor.
-- Notification: when a user is assigned, a 'task_assigned' notification fires.
--
-- Idempotent — safe to re-run.

-- ── 1. Quick tasks table ────────────────────────────────────────────────────
create table if not exists public.quick_tasks (
  id                  uuid default uuid_generate_v4() primary key,
  title               text not null,
  description_html    text,                          -- rich text optional
  created_by          uuid references public.profiles(id),
  assignee_user_id    uuid references public.profiles(id),
  assignee_group_id   uuid references public.user_groups(id),
  source_message_id   uuid references public.chat_messages(id) on delete set null,
  status              text not null default 'open'
                      check (status in ('open','done','cancelled')),
  due_date            date,
  completed_at        timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- One assignee dimension required (idempotent: only add once)
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quick_tasks_assignee_required'
  ) then
    alter table public.quick_tasks
      add constraint quick_tasks_assignee_required
      check ((assignee_user_id is not null) or (assignee_group_id is not null));
  end if;
end $$;

create index if not exists quick_tasks_assignee_user_idx
  on public.quick_tasks (assignee_user_id, status, due_date);
create index if not exists quick_tasks_creator_idx
  on public.quick_tasks (created_by, status);
create index if not exists quick_tasks_assignee_group_idx
  on public.quick_tasks (assignee_group_id) where assignee_group_id is not null;

alter table public.quick_tasks enable row level security;

-- ── 2. RLS policies ─────────────────────────────────────────────────────────
drop policy if exists "view tasks" on public.quick_tasks;
create policy "view tasks" on public.quick_tasks for select using (
  created_by = auth.uid()
  or assignee_user_id = auth.uid()
  or (assignee_group_id is not null and exists (
        select 1 from public.user_group_members
        where group_id = assignee_group_id and user_id = auth.uid()))
  or exists (select 1 from public.profiles
              where id = auth.uid() and role in ('admin','editor'))
);

drop policy if exists "create tasks" on public.quick_tasks;
create policy "create tasks" on public.quick_tasks for insert
  with check (created_by = auth.uid());

drop policy if exists "update tasks" on public.quick_tasks;
create policy "update tasks" on public.quick_tasks for update using (
  created_by = auth.uid()
  or assignee_user_id = auth.uid()
  or (assignee_group_id is not null and exists (
        select 1 from public.user_group_members
        where group_id = assignee_group_id and user_id = auth.uid()))
  or exists (select 1 from public.profiles
              where id = auth.uid() and role in ('admin','editor'))
);

drop policy if exists "delete tasks" on public.quick_tasks;
create policy "delete tasks" on public.quick_tasks for delete using (
  created_by = auth.uid()
  or exists (select 1 from public.profiles
              where id = auth.uid() and role in ('admin','editor'))
);

grant select, insert, update, delete on public.quick_tasks to authenticated;
grant select, insert, update, delete on public.quick_tasks to service_role;

-- ── 3. Extend notifications kind enum ───────────────────────────────────────
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention','project_assigned','workflow_assigned','workflow_completed',
  'approval_requested','schedule_fired','form_submitted','doc_shared','generic',
  'task_assigned','task_completed'
));

-- ── 4. Trigger: fan out task assignment to user (group ones stay quiet) ────
create or replace function public.fan_out_task_assignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare creator_name text;
begin
  -- Only notify on individual user assignment (group assignment would spam)
  if new.assignee_user_id is null or new.assignee_user_id = new.created_by then
    return new;
  end if;
  select coalesce(full_name, 'Ai đó') into creator_name
    from public.profiles where id = new.created_by;
  insert into public.notifications (user_id, kind, title, body, payload)
  values (
    new.assignee_user_id, 'task_assigned',
    'Bạn có việc mới: ' || new.title,
    creator_name || ' giao việc cho bạn',
    jsonb_build_object('task_id', new.id, 'source_message_id', new.source_message_id)
  );
  return new;
end $$;

drop trigger if exists trg_fan_out_task_assignment on public.quick_tasks;
create trigger trg_fan_out_task_assignment after insert on public.quick_tasks
  for each row execute function public.fan_out_task_assignment();

-- ── 5. Reload PostgREST schema cache ───────────────────────────────────────
notify pgrst, 'reload schema';
