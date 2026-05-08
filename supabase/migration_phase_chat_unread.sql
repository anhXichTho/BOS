-- ─── Phase Chat Unread: per-context last-read tracking ───────────────────────
--
-- Run AFTER migration_phase_notifications.sql.
-- All statements are idempotent (safe to re-run).

-- ── 1. Table ──────────────────────────────────────────────────────────────────
-- Stores when each user last read each chat context (channel or project thread).
create table if not exists public.chat_last_read (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  context_type text not null check (context_type in ('channel', 'project')),
  context_id   uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, context_id)
);

create index if not exists chat_last_read_user_idx
  on public.chat_last_read (user_id);

-- ── 2. RLS ────────────────────────────────────────────────────────────────────
alter table public.chat_last_read enable row level security;

drop policy if exists "Owner-only last-read" on public.chat_last_read;
create policy "Owner-only last-read" on public.chat_last_read
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.chat_last_read to authenticated;

-- ── 3. RPC: per-context unread counts ────────────────────────────────────────
-- Returns one row per context that has ≥1 unread message for the caller.
-- Own messages (author_id = caller) are never counted as unread.
-- Contexts with 0 unread are omitted (absent in result = 0).
create or replace function public.get_chat_unread_counts(p_context_ids uuid[])
returns table(context_id uuid, unread_count bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select m.context_id, count(*) as unread_count
  from public.chat_messages m
  where m.context_id = any(p_context_ids)
    and m.parent_id is null
    and m.author_id != auth.uid()
    and m.created_at > coalesce(
      (select r.last_read_at
         from public.chat_last_read r
        where r.user_id = auth.uid()
          and r.context_id = m.context_id),
      '-infinity'::timestamptz
    )
  group by m.context_id
  having count(*) > 0
$$;

grant execute on function public.get_chat_unread_counts(uuid[]) to authenticated;

-- ── 4. RPC: total unread across all contexts ──────────────────────────────────
-- Used by the nav-tab dot to show any unread activity without needing context IDs.
create or replace function public.get_chat_total_unread()
returns bigint
language sql stable security definer set search_path = public, pg_temp
as $$
  select count(*)
  from public.chat_messages m
  where m.parent_id is null
    and m.author_id != auth.uid()
    and m.created_at > coalesce(
      (select r.last_read_at
         from public.chat_last_read r
        where r.user_id = auth.uid()
          and r.context_id = m.context_id),
      '-infinity'::timestamptz
    )
$$;

grant execute on function public.get_chat_total_unread() to authenticated;
