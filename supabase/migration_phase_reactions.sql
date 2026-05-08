-- ============================================================
-- Phase: Message Reactions
--
-- Adds emoji reactions to chat messages.
-- Emoji set: 👍 😮 😢 😂 ❤️ 💔 😎
--
-- Run AFTER migration_phase_workflow_approval.sql. Idempotent.
-- ============================================================

create table if not exists public.chat_message_reactions (
  id         uuid        primary key default gen_random_uuid(),
  message_id uuid        not null references public.chat_messages(id) on delete cascade,
  user_id    uuid        not null references public.profiles(id)      on delete cascade,
  emoji      text        not null,
  created_at timestamptz not null default now(),
  unique(message_id, user_id, emoji)
);

alter table public.chat_message_reactions enable row level security;

drop policy if exists "view reactions" on public.chat_message_reactions;
create policy "view reactions" on public.chat_message_reactions
  for select using (true);

drop policy if exists "manage own reactions" on public.chat_message_reactions;
create policy "manage own reactions" on public.chat_message_reactions
  for all using (user_id = auth.uid());

grant select, insert, delete on public.chat_message_reactions to authenticated;

-- Add to realtime publication so reaction changes are pushed to clients
do $$
begin
  alter publication supabase_realtime add table public.chat_message_reactions;
exception when others then null; -- already in publication or publication absent
end $$;
