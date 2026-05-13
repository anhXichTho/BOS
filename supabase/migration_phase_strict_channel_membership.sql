-- migration_phase_strict_channel_membership.sql
-- Tighten RLS so PRIVATE channels are strictly members-only — admin/editor lose
-- automatic read access (they must be added as members like anyone else).
--
-- Affects:
--   1) chat_channels  SELECT
--   2) chat_messages  SELECT (gated on the channel via subquery)
--   3) chat_messages  INSERT (block posting to private channels you're not in)
--   4) chat_messages  UPDATE (can only edit own messages AND must still see channel)
--
-- Admin/editor RETAIN management rights via the existing "Manage members"
-- policy on chat_channel_members — so they can add themselves to a private
-- channel when they genuinely need to read it.
--
-- Public channels and DM/personal channels are unchanged (still visible to
-- their members or to everyone respectively).

-- ─── 1. chat_channels SELECT: remove admin/editor bypass ─────────────────────
drop policy if exists "Public + members can view channels" on public.chat_channels;

create policy "Public + members can view channels"
  on public.chat_channels for select
  using (
    is_private = false
    or owner_id = auth.uid()
    or dm_partner_id = auth.uid()
    or public.auth_is_channel_member(chat_channels.id) = true
  );

-- ─── 2. chat_messages SELECT: same — only members of the channel ────────────
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
          )
      )
    )
  );

-- ─── 3. chat_messages INSERT: gate on channel visibility ────────────────────
-- Previous policy allowed anyone to post to any channel as long as they were
-- the author. That's a leak: non-members could insert into private channels
-- (PostgREST returns the row before SELECT-RLS would hide it).
drop policy if exists "Users can post messages" on public.chat_messages;

create policy "Users can post messages"
  on public.chat_messages for insert
  with check (
    author_id = auth.uid()
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
          )
      )
    )
  );

-- ─── 4. chat_messages UPDATE: same gate on channel visibility ───────────────
drop policy if exists "Users can edit own messages" on public.chat_messages;

create policy "Users can edit own messages"
  on public.chat_messages for update
  using (
    author_id = auth.uid()
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
          )
      )
    )
  );

-- ─── 5. Split the legacy "Admin/Editor can manage team channels" ALL policy ──
-- That single policy with cmd=ALL also covered SELECT, giving admin/editor a
-- silent read bypass on every team channel. Replace it with 3 separate policies
-- for INSERT / UPDATE / DELETE — manage rights stay, read does NOT.
drop policy if exists "Admin/Editor can manage team channels" on public.chat_channels;

create policy "Admin/Editor can insert team channels"
  on public.chat_channels for insert
  with check (channel_type <> 'dm' and public.auth_is_admin_or_editor() = true);

create policy "Admin/Editor can update team channels"
  on public.chat_channels for update
  using (channel_type <> 'dm' and public.auth_is_admin_or_editor() = true)
  with check (channel_type <> 'dm' and public.auth_is_admin_or_editor() = true);

create policy "Admin/Editor can delete team channels"
  on public.chat_channels for delete
  using (channel_type <> 'dm' and public.auth_is_admin_or_editor() = true);

notify pgrst, 'reload schema';
