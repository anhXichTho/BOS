-- migration_phase_open_channel_creation.sql
-- Open channel creation to ALL authenticated users (was admin/editor/leader).
-- Project creation remains restricted to admin/editor/leader.
--
-- Authors still become owner_id+created_by, so UPDATE/DELETE policies (which
-- check `owner_id = auth.uid() or admin/editor`) continue to gate management
-- correctly — a regular user can manage only their own channels.

drop policy if exists "Manage-role can insert team channels" on public.chat_channels;

create policy "Authenticated can insert team channels"
  on public.chat_channels for insert
  with check (
    channel_type <> 'dm'
    and auth.uid() is not null
  );

notify pgrst, 'reload schema';
