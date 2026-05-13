-- migration_phase_leave_channel_rpc.sql
-- RPC for self-leaving a channel atomically. Bypasses RLS via security definer
-- but enforces caller-is-self explicitly. Handles the owner case by nullifying
-- owner_id so the channel disappears from the leaver's sidebar (otherwise the
-- chat_channels SELECT policy `owner_id = auth.uid()` keeps it visible).

create or replace function public.leave_channel(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_owner_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Remove own membership row (no-op if not a member)
  delete from public.chat_channel_members
    where channel_id = p_channel_id
      and user_id = v_uid;

  -- If we were the owner, orphan the channel so it stops appearing in our
  -- sidebar (chat_channels SELECT checks owner_id = auth.uid()).
  select owner_id into v_owner_id
    from public.chat_channels where id = p_channel_id;

  if v_owner_id = v_uid then
    update public.chat_channels set owner_id = null where id = p_channel_id;
  end if;
end;
$$;

grant execute on function public.leave_channel(uuid) to authenticated;

notify pgrst, 'reload schema';
