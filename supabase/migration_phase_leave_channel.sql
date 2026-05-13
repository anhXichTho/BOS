-- migration_phase_leave_channel.sql
-- Lets any member self-remove from a channel (delete their own chat_channel_members
-- row). Owner CAN also leave — channel stays alive; admin/editor can take over.

create policy "Self can leave channel"
  on public.chat_channel_members for delete
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
