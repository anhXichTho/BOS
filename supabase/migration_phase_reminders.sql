-- migration_phase_reminders.sql
-- Round-10 follow-up. Reminders ("Nhắc việc") — user schedules a future ping
-- linked to a chat message; pg_cron fires it at that time.
--
-- On fire:
--   1. A notifications row (kind='reminder') is inserted for the recipient.
--   2. A chat_messages row (rich_card / kind='reminder_card') is posted in
--      the SAME chat where the reminder was created (falls back to the
--      recipient's personal channel if no source chat is recorded).
--
-- Idempotent — safe to re-run.

create table if not exists public.reminders (
  id                  uuid default uuid_generate_v4() primary key,
  recipient_id        uuid not null references public.profiles(id) on delete cascade,
  created_by          uuid references public.profiles(id),
  title               text not null,
  fire_at             timestamptz not null,
  source_message_id   uuid references public.chat_messages(id) on delete set null,
  source_context_type text check (source_context_type in ('channel','project') or source_context_type is null),
  source_context_id   uuid,
  fired_at            timestamptz,
  created_at          timestamptz default now()
);

create index if not exists idx_reminders_due
  on public.reminders (fire_at)
  where fired_at is null;

create index if not exists idx_reminders_recipient
  on public.reminders (recipient_id, fire_at);

alter table public.reminders enable row level security;

drop policy if exists "reminders view"   on public.reminders;
drop policy if exists "reminders create" on public.reminders;
drop policy if exists "reminders manage" on public.reminders;

create policy "reminders view" on public.reminders for select
  using (
    recipient_id = auth.uid()
    or created_by = auth.uid()
    or exists (select 1 from public.profiles
                where id = auth.uid() and role in ('admin','editor'))
  );

create policy "reminders create" on public.reminders for insert
  with check (created_by = auth.uid());

create policy "reminders manage" on public.reminders for update
  using (
    recipient_id = auth.uid()
    or created_by = auth.uid()
    or exists (select 1 from public.profiles
                where id = auth.uid() and role in ('admin','editor'))
  );

drop policy if exists "reminders delete" on public.reminders;
create policy "reminders delete" on public.reminders for delete
  using (
    recipient_id = auth.uid()
    or created_by = auth.uid()
    or exists (select 1 from public.profiles
                where id = auth.uid() and role in ('admin','editor'))
  );

grant select, insert, update, delete on public.reminders to authenticated;
grant select, insert, update, delete on public.reminders to service_role;

-- ─── Notification kind enum extension ────────────────────────────────────────

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention','project_assigned','workflow_assigned','workflow_completed',
  'approval_requested','schedule_fired','form_submitted','doc_shared','generic',
  'task_assigned','task_completed','reminder'
));

-- ─── Fire-due-reminders function ─────────────────────────────────────────────

create or replace function public.fire_due_reminders()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r              public.reminders%rowtype;
  ctx_type       text;
  ctx_id         uuid;
begin
  for r in
    select * from public.reminders
     where fired_at is null and fire_at <= now()
     order by fire_at asc
     limit 100
  loop
    -- 1. Bell notification
    insert into public.notifications (user_id, kind, title, body, payload)
    values (
      r.recipient_id,
      'reminder',
      'Nhắc việc: ' || r.title,
      coalesce(r.title, ''),
      jsonb_build_object(
        'reminder_id',         r.id,
        'source_message_id',   r.source_message_id,
        'source_context_type', r.source_context_type,
        'source_context_id',   r.source_context_id
      )
    );

    -- 2. Chat card in the source chat (or personal as fallback)
    ctx_type := r.source_context_type;
    ctx_id   := r.source_context_id;

    if ctx_type is null or ctx_id is null then
      select id into ctx_id
        from public.chat_channels
       where channel_type = 'personal' and owner_id = r.recipient_id
       limit 1;
      ctx_type := 'channel';
    end if;

    if ctx_id is not null then
      insert into public.chat_messages (
        context_type, context_id, author_id, message_type, content, payload
      ) values (
        ctx_type, ctx_id, null, 'rich_card', null,
        jsonb_build_object(
          'kind',              'reminder_card',
          'reminder_id',       r.id,
          'title',             r.title,
          'fire_at',           r.fire_at,
          'source_message_id', r.source_message_id
        )
      );
    end if;

    update public.reminders set fired_at = now() where id = r.id;
  end loop;
end;
$$;

revoke all on function public.fire_due_reminders() from public;
grant execute on function public.fire_due_reminders() to service_role;

-- ─── pg_cron job (every minute) — idempotent ────────────────────────────────

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'fire_due_reminders') then
      perform cron.schedule('fire_due_reminders', '* * * * *',
                            $cron$select public.fire_due_reminders();$cron$);
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
