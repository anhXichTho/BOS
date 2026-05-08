-- ─── Phase 3: Self-chat (one personal channel per user) ─────────────────────
--
-- Run AFTER migration_phase_form_drafts.sql.
-- All statements are idempotent (safe to re-run).

-- 1. Add owner_id to chat_channels.
--    NULL = team channel (current behavior preserved).
alter table public.chat_channels
  add column if not exists owner_id uuid references public.profiles(id) on delete cascade;

-- 2. Each user can have at most one personal channel.
create unique index if not exists chat_channels_owner_unique
  on public.chat_channels (owner_id) where owner_id is not null;

-- 3. Replace the broad "All users can view channels" policy with one that
--    hides personal channels from non-owners.
--    Team channels (owner_id IS NULL) remain visible to all authenticated users.
drop policy if exists "All users can view channels" on public.chat_channels;
drop policy if exists "View team channels and own personal channel" on public.chat_channels;
create policy "View team channels and own personal channel" on public.chat_channels
  for select using (
    auth.uid() is not null
    and (owner_id is null or owner_id = auth.uid())
  );

-- 4. Tighten the chat_messages SELECT policy to respect personal channel ownership.
--    Non-channel messages (context_type <> 'channel') and team channel messages
--    remain accessible as before.
drop policy if exists "All users can view messages" on public.chat_messages;
drop policy if exists "View messages with channel scoping" on public.chat_messages;
create policy "View messages with channel scoping" on public.chat_messages
  for select using (
    auth.uid() is not null
    and (
      context_type <> 'channel'
      or exists (
        select 1 from public.chat_channels c
         where c.id = chat_messages.context_id
           and (c.owner_id is null or c.owner_id = auth.uid())
      )
    )
  );

-- 5. Auto-create the personal channel on first call.
--    SECURITY DEFINER so we can bypass the "manage channels" policy.
create or replace function public.get_or_create_self_chat()
returns public.chat_channels
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ch public.chat_channels;
begin
  -- Try to find the existing personal channel for this user.
  select * into ch
    from public.chat_channels
   where owner_id = auth.uid() and channel_type = 'personal';

  if not found then
    insert into public.chat_channels (name, description, channel_type, owner_id, created_by)
    values (
      'Cá nhân',
      'Kênh riêng — drafts, bot, ghi chú không ai thấy.',
      'personal',
      auth.uid(),
      auth.uid()
    )
    returning * into ch;
  end if;

  return ch;
end $$;

grant execute on function public.get_or_create_self_chat() to authenticated;
