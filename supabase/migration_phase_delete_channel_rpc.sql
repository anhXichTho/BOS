-- migration_phase_delete_channel_rpc.sql
-- RPC to safely delete a team channel along with its messages, reactions, and
-- attachments in one transaction. Bypasses RLS via security definer, but
-- enforces authorization explicitly: caller must be the channel owner OR an
-- admin/editor.
--
-- DM and personal channels are NOT deletable through this function — they are
-- managed by their own lifecycle (DMs auto-created, personal channel = 1 per
-- user).

create or replace function public.delete_channel(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_id    uuid := auth.uid();
  v_caller_role  text;
  v_channel      record;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Load channel + verify it's a team channel
  select id, channel_type, owner_id, created_by
    into v_channel
    from public.chat_channels
    where id = p_channel_id;

  if v_channel.id is null then
    raise exception 'Channel not found' using errcode = '02000';
  end if;

  if v_channel.channel_type in ('dm', 'personal') then
    raise exception 'Cannot delete a DM or personal channel' using errcode = '22023';
  end if;

  -- Authorization: owner OR admin/editor
  select role into v_caller_role from public.profiles where id = v_caller_id;

  if  v_channel.owner_id   <> v_caller_id
  and v_channel.created_by <> v_caller_id
  and v_caller_role not in ('admin', 'editor')
  then
    raise exception 'Only the channel owner or an admin/editor can delete this channel' using errcode = '42501';
  end if;

  -- Cascade delete (chat_messages.context_id has no FK to chat_channels)
  delete from public.chat_message_reactions
    where message_id in (
      select id from public.chat_messages
        where context_type = 'channel' and context_id = p_channel_id
    );

  delete from public.chat_attachments
    where message_id in (
      select id from public.chat_messages
        where context_type = 'channel' and context_id = p_channel_id
    );

  delete from public.chat_last_read where context_id = p_channel_id;

  delete from public.chat_messages
    where context_type = 'channel' and context_id = p_channel_id;

  -- chat_channel_members CASCADE via FK
  delete from public.chat_channels where id = p_channel_id;
end;
$$;

grant execute on function public.delete_channel(uuid) to authenticated;

notify pgrst, 'reload schema';
