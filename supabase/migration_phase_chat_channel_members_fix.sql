-- migration_phase_chat_channel_members_fix.sql (round-7b/2 follow-up)
--
-- Fixes 42P17 "infinite recursion detected in policy for relation
-- chat_channel_members" introduced by the original migration #28.
-- The "Members can read own rows" policy contained a self-referencing
-- subquery (`exists select 1 from chat_channel_members ...`), which
-- triggers Postgres's policy-evaluation cycle detector — same pattern
-- as gotcha #48 (workflow_runs ↔ workflow_run_steps).
--
-- Fix: replace the recursive policies with SECURITY DEFINER helper
-- functions that bypass RLS on the table they read, then re-create the
-- policies in terms of those functions.
--
-- This migration is IDEMPOTENT — safe to re-run. Run AFTER #28.

-- ─── 1. Helper function: am I a member of channel X? ───────────────────────
create or replace function public.auth_is_channel_member(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from chat_channel_members
    where channel_id = p_channel_id and user_id = auth.uid()
  );
$$;

grant execute on function public.auth_is_channel_member(uuid) to authenticated;

-- ─── 2. Helper function: am I admin / editor? ──────────────────────────────
create or replace function public.auth_is_admin_or_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from profiles
    where id = auth.uid() and role in ('admin', 'editor')
  );
$$;

grant execute on function public.auth_is_admin_or_editor() to authenticated;

-- ─── 3. Replace the recursive members-table policies ──────────────────────
drop policy if exists "Members can read own rows"      on public.chat_channel_members;
drop policy if exists "Channel owner / admin can manage members" on public.chat_channel_members;

create policy "Members read"
  on public.chat_channel_members for select
  using (
    user_id = auth.uid()
    or public.auth_is_channel_member(chat_channel_members.channel_id) = true
    or public.auth_is_admin_or_editor() = true
  );

create policy "Manage members"
  on public.chat_channel_members for all
  using (
    public.auth_is_admin_or_editor() = true
    or exists (
      select 1 from public.chat_channels c
      where c.id = chat_channel_members.channel_id
        and (c.owner_id = auth.uid() or c.created_by = auth.uid())
    )
  )
  with check (
    public.auth_is_admin_or_editor() = true
    or exists (
      select 1 from public.chat_channels c
      where c.id = chat_channel_members.channel_id
        and (c.owner_id = auth.uid() or c.created_by = auth.uid())
    )
  );

-- ─── 4. Replace chat_channels SELECT policy with SECURITY DEFINER calls ──
drop policy if exists "Public + members can view channels" on public.chat_channels;

create policy "Public + members can view channels"
  on public.chat_channels for select
  using (
    is_private = false
    or owner_id = auth.uid()
    or dm_partner_id = auth.uid()
    or public.auth_is_channel_member(chat_channels.id) = true
    or public.auth_is_admin_or_editor() = true
  );

-- ─── 5. Replace chat_messages SELECT policy similarly ────────────────────
drop policy if exists "Members can view channel + DM messages" on public.chat_messages;

create policy "Members can view channel + DM messages"
  on public.chat_messages for select
  using (
    auth.uid() is not null
    and (
      context_type <> 'channel'
      or exists (
        select 1 from public.chat_channels c
        where c.id = chat_messages.context_id
          and (
            c.is_private = false
            or c.owner_id = auth.uid()
            or c.dm_partner_id = auth.uid()
            or public.auth_is_channel_member(c.id) = true
            or public.auth_is_admin_or_editor() = true
          )
      )
    )
  );

-- ─── 6. Reload PostgREST schema cache ────────────────────────────────────
notify pgrst, 'reload schema';
