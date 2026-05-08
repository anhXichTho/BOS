-- migration_phase_chat_channel_members.sql (round-7b — migration #28)
--
-- Per-channel membership ACL. Up to round-7 every team channel was visible
-- to every authenticated user (gotcha #47). Round-7b introduces an opt-in
-- private-channel model:
--
--   chat_channels.is_private = false  → public; anyone authenticated sees it
--                                       (legacy behaviour for existing rows)
--   chat_channels.is_private = true   → only rows in chat_channel_members
--                                       for that user can see + post
--
-- The new "Tạo kênh" UI sets is_private=true by default and inserts the
-- creator as the first member. UI for managing members lives in a small
-- channel-settings modal.
--
-- DM and personal channels (channel_type ∈ 'dm' | 'personal') keep their
-- existing RLS — gated by owner_id / dm_partner_id checks. They are NOT
-- governed by chat_channel_members.

-- ─── 1. is_private flag (default false ⇒ existing rows stay public) ─────────
alter table public.chat_channels
  add column if not exists is_private boolean not null default false;

-- ─── 2. Members table ───────────────────────────────────────────────────────
create table if not exists public.chat_channel_members (
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id    uuid not null references public.profiles(id)      on delete cascade,
  role       text default 'member'  check (role in ('owner', 'member')),
  added_at   timestamptz default now(),
  primary key (channel_id, user_id)
);

create index if not exists chat_channel_members_user_idx
  on public.chat_channel_members (user_id);

alter table public.chat_channel_members enable row level security;

-- Idempotency on re-run.
drop policy if exists "Members can read own rows"      on public.chat_channel_members;
drop policy if exists "Channel owner / admin can manage members" on public.chat_channel_members;

-- A user can SEE the membership rows of a channel they themselves belong to
-- (so the UI can list co-members), OR rows where they ARE the user_id.
create policy "Members can read own rows"
  on public.chat_channel_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.chat_channel_members m
      where m.channel_id = chat_channel_members.channel_id and m.user_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'editor')
    )
  );

-- The channel owner OR any admin/editor can INSERT/UPDATE/DELETE members.
create policy "Channel owner / admin can manage members"
  on public.chat_channel_members for all
  using (
    exists (
      select 1 from public.chat_channels c
      where c.id = chat_channel_members.channel_id
        and (c.owner_id = auth.uid() or c.created_by = auth.uid())
    )
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'editor')
    )
  )
  with check (
    exists (
      select 1 from public.chat_channels c
      where c.id = chat_channel_members.channel_id
        and (c.owner_id = auth.uid() or c.created_by = auth.uid())
    )
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'editor')
    )
  );

grant select, insert, update, delete on public.chat_channel_members to authenticated;
grant select, insert, update, delete on public.chat_channel_members to service_role;

-- ─── 3. Tighten chat_channels SELECT to respect is_private ──────────────────
-- Replace the legacy "All users can view channels" policy with one that
-- gates private channels on membership. Public channels stay open.
drop policy if exists "All users can view channels" on public.chat_channels;

create policy "Public + members can view channels"
  on public.chat_channels for select
  using (
    -- Public channels (legacy + opt-in)
    is_private = false
    -- DM / personal channels: existing channel_type-based logic kicks in via
    -- the policies below; here we just allow the row to be read by the owner.
    or owner_id = auth.uid()
    or dm_partner_id = auth.uid()
    -- Private team channels: must be a member.
    or exists (
      select 1 from public.chat_channel_members
      where channel_id = chat_channels.id and user_id = auth.uid()
    )
    -- Admin / editor sees everything for moderation.
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'editor')
    )
  );

-- ─── 4. Tighten chat_messages SELECT to respect channel privacy ─────────────
-- Channel messages: visible only when the underlying channel is visible.
-- DM messages: only owner / partner / admin see (already enforced via the
-- channel policy above + a sub-check here).
-- Project / portal messages: untouched; they have their own context-based RLS.

drop policy if exists "All users can view messages" on public.chat_messages;

create policy "Members can view channel + DM messages"
  on public.chat_messages for select
  using (
    auth.uid() is not null
    and (
      context_type <> 'channel'
      -- Project + portal contexts pass through (existing policies handle them)
      or exists (
        select 1 from public.chat_channels c
        where c.id = chat_messages.context_id
          and (
            c.is_private = false
            or c.owner_id = auth.uid()
            or c.dm_partner_id = auth.uid()
            or exists (
              select 1 from public.chat_channel_members m
              where m.channel_id = c.id and m.user_id = auth.uid()
            )
            or exists (
              select 1 from public.profiles
              where id = auth.uid() and role in ('admin', 'editor')
            )
          )
      )
    )
  );

-- ─── 5. Helper RPC: invite a user (admin/editor or channel owner only) ──────
create or replace function public.add_channel_member(
  p_channel_id uuid,
  p_user_id    uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Permission check up-front for clarity; the underlying policy also enforces.
  if not (
    exists (select 1 from chat_channels c
            where c.id = p_channel_id
              and (c.owner_id = auth.uid() or c.created_by = auth.uid()))
    or exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'editor'))
  ) then
    raise exception 'Permission denied: only channel owner / admin / editor can invite members';
  end if;

  insert into chat_channel_members (channel_id, user_id, role)
  values (p_channel_id, p_user_id, 'member')
  on conflict (channel_id, user_id) do nothing;
end;
$$;

grant execute on function public.add_channel_member(uuid, uuid) to authenticated;

-- ─── 6. Reload PostgREST schema cache ───────────────────────────────────────
notify pgrst, 'reload schema';
