-- ============================================================
-- Phase: Notifications
-- In-app notifications + realtime triggers for mentions, project
-- assignment, and workflow completion.
-- Run AFTER previous migrations. Idempotent.
-- ============================================================

-- 1) notifications table
create table if not exists public.notifications (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references public.profiles(id) on delete cascade,
  kind       text not null check (kind in (
    'mention','project_assigned','workflow_assigned',
    'workflow_completed','schedule_fired','form_submitted',
    'doc_shared','generic'
  )),
  title      text not null,
  body       text,
  link       text,                          -- e.g. /projects/<slug>
  payload    jsonb,                         -- type-specific extras
  read_at    timestamptz,
  created_at timestamptz default now()
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read_at, created_at desc);

-- 2) RLS — users see + mark-read their own only.
alter table public.notifications enable row level security;

drop policy if exists "Users see own notifications" on public.notifications;
create policy "Users see own notifications" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "Users mark own notifications" on public.notifications;
create policy "Users mark own notifications" on public.notifications
  for update using (user_id = auth.uid());

-- INSERTs go through DB triggers (security definer), not user-facing.
grant select, update on public.notifications to anon, authenticated;

-- 3) Trigger: fan out mentions in chat messages.
create or replace function public.fan_out_mentions()
returns trigger as $$
begin
  if new.mentions is null or array_length(new.mentions, 1) is null then
    return new;
  end if;

  insert into public.notifications (user_id, kind, title, body, link, payload)
  select
    m,
    'mention',
    'Bạn được nhắc trong chat',
    left(coalesce(new.content, ''), 160),
    case
      when new.context_type = 'channel' then '/chat'
      when new.context_type = 'project' then '/chat'
      else '/chat'
    end,
    jsonb_build_object(
      'context_type', new.context_type,
      'context_id',   new.context_id,
      'message_id',   new.id,
      'author_id',    new.author_id
    )
  from unnest(new.mentions) as m
  where m != coalesce(new.author_id, '00000000-0000-0000-0000-000000000000'::uuid);

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists chat_mention_notify on public.chat_messages;
create trigger chat_mention_notify
  after insert on public.chat_messages
  for each row
  execute procedure public.fan_out_mentions();

-- 4) Trigger: notify newly-assigned project owner.
create or replace function public.notify_project_assigned()
returns trigger as $$
declare
  v_assignee_changed boolean;
begin
  v_assignee_changed := (
    TG_OP = 'INSERT' and new.assigned_to is not null
  ) or (
    TG_OP = 'UPDATE'
    and new.assigned_to is distinct from old.assigned_to
    and new.assigned_to is not null
  );

  if not v_assignee_changed then
    return new;
  end if;

  -- Don't notify the creator if they assigned themselves.
  if new.assigned_to = coalesce(new.created_by, '00000000-0000-0000-0000-000000000000'::uuid) then
    return new;
  end if;

  insert into public.notifications (user_id, kind, title, body, link, payload)
  values (
    new.assigned_to,
    'project_assigned',
    'Bạn được giao dự án',
    new.title,
    '/projects/' || new.slug,
    jsonb_build_object('project_id', new.id, 'slug', new.slug)
  );

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists project_assigned_notify on public.projects;
create trigger project_assigned_notify
  after insert or update of assigned_to on public.projects
  for each row
  execute procedure public.notify_project_assigned();

-- 5) Trigger: notify project owner when workflow run completes.
create or replace function public.notify_workflow_completed()
returns trigger as $$
declare
  v_owner uuid;
  v_slug  text;
  v_title text;
begin
  if not (TG_OP = 'UPDATE' and old.status != 'completed' and new.status = 'completed') then
    return new;
  end if;

  if new.project_id is null then
    return new;
  end if;

  select assigned_to, slug, title
    into v_owner, v_slug, v_title
    from public.projects
   where id = new.project_id;

  if v_owner is null or v_owner = new.run_by then
    return new;
  end if;

  insert into public.notifications (user_id, kind, title, body, link, payload)
  values (
    v_owner,
    'workflow_completed',
    'Workflow đã hoàn thành',
    new.template_name || (case when v_title is not null then ' — ' || v_title else '' end),
    '/workflows/runs/' || new.id,
    jsonb_build_object('run_id', new.id, 'project_id', new.project_id)
  );

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists workflow_completed_notify on public.workflow_runs;
create trigger workflow_completed_notify
  after update of status on public.workflow_runs
  for each row
  execute procedure public.notify_workflow_completed();

-- 6) Realtime: enable for client subscriptions.
alter publication supabase_realtime add table public.notifications;
