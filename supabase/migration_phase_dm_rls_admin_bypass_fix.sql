-- ── Migration: close DM privacy gaps left by schema.sql base policies ────────
-- Two base policies from schema.sql were never dropped by later migrations,
-- allowing any authenticated user to post to any channel and giving
-- admin/editor full access to DM channels:
--
--   "Admin/Editor can manage channels"  — for ALL on chat_channels
--     → admins/editors could read/write every DM channel
--
--   "Users can post messages"           — for INSERT on chat_messages
--     → any authenticated user could post to any channel (DM or not)
--
-- Fix:
--   1. Replace the blanket channel management policy so admin/editor override
--      only applies to non-DM channels.
--   2. Replace the blanket INSERT policy so DM channels only accept messages
--      from the two participants (owner_id / dm_partner_id).
--   3. Re-apply the SELECT policy using SECURITY DEFINER helpers (from #28b)
--      with the DM admin-bypass exclusion — avoids 42P17 recursion.
--
-- Requires migration_phase_chat_channel_members_fix.sql (#28b) to have run
-- (provides auth_is_channel_member + auth_is_admin_or_editor functions).
--
-- Run this ONCE in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. chat_channels: replace blanket admin/editor ALL policy ────────────────
drop policy if exists "Admin/Editor can manage channels"    on public.chat_channels;
drop policy if exists "Public + members can view channels"  on public.chat_channels;

-- SELECT: DM only visible to owner + partner; team channels visible to admin/editor
create policy "Public + members can view channels"
  on public.chat_channels for select
  using (
    is_private = false
    or owner_id = auth.uid()
    or dm_partner_id = auth.uid()
    or public.auth_is_channel_member(chat_channels.id) = true
    -- Admin/editor can see team channels (not DMs)
    or (channel_type <> 'dm' and public.auth_is_admin_or_editor() = true)
  );

-- INSERT/UPDATE/DELETE on channels: admin/editor manage team channels only
create policy "Admin/Editor can manage team channels"
  on public.chat_channels for all
  using (
    channel_type <> 'dm'
    and public.auth_is_admin_or_editor() = true
  )
  with check (
    channel_type <> 'dm'
    and public.auth_is_admin_or_editor() = true
  );

-- ── 2. chat_messages: replace blanket INSERT policy ──────────────────────────
drop policy if exists "Users can post messages"             on public.chat_messages;
drop policy if exists "Members can view channel + DM messages" on public.chat_messages;

-- SELECT: DM messages only visible to the two participants
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
            or (c.channel_type <> 'dm' and public.auth_is_admin_or_editor() = true)
          )
      )
    )
  );

-- INSERT: gate by channel type
create policy "Users can post messages"
  on public.chat_messages for insert
  with check (
    author_id = auth.uid()
    and (
      -- Non-channel contexts (project threads, portal) — allow as before
      context_type <> 'channel'
      or exists (
        select 1 from public.chat_channels c
        where c.id = chat_messages.context_id
          and (
            -- DM: only the two participants
            (c.channel_type = 'dm'
              and (c.owner_id = auth.uid() or c.dm_partner_id = auth.uid()))
            -- Personal: only the channel owner
            or (c.channel_type = 'personal' and c.owner_id = auth.uid())
            -- Team channels: member or admin/editor
            or (c.channel_type not in ('dm', 'personal')
              and (
                public.auth_is_channel_member(c.id) = true
                or public.auth_is_admin_or_editor() = true
              ))
          )
      )
    )
  );

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';
