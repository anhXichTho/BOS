-- migration_phase_mention_member_filter.sql
-- Defense-in-depth: fan_out_mentions trigger now drops mentioned user IDs that
-- are NOT members of the target channel/project. The frontend already filters
-- the picker, but this catches the case where:
--   • A client posts with hand-crafted mentions[] (API user, postman, etc.)
--   • A user was removed from the channel/project between picker open + send
--   • Stale @all expansion includes since-removed members
--
-- For DM / personal / portal contexts, no extra check — those flows handle
-- membership through other means (channel_type='dm', etc.).

create or replace function public.fan_out_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.mentions is null or array_length(new.mentions, 1) is null then
    return new;
  end if;

  insert into public.notifications (user_id, kind, title, body, link, payload)
  select
    m,
    'mention',
    'Bạn được nhắc trong chat',
    left(coalesce(new.content, ''), 160),
    '/chat?ctx_type=' || new.context_type
      || '&ctx_id='   || new.context_id
      || '&msg_id='   || new.id,
    jsonb_build_object(
      'context_type', new.context_type,
      'context_id',   new.context_id,
      'message_id',   new.id,
      'author_id',    new.author_id
    )
  from unnest(new.mentions) as m
  where
    -- Skip self-mention
    m != coalesce(new.author_id, '00000000-0000-0000-0000-000000000000'::uuid)
    -- Membership gate: channel → chat_channel_members; project → project_members.
    -- Public channels (is_private=false) are exempt — anyone can be mentioned.
    and (
      case new.context_type
        when 'channel' then exists (
          select 1 from public.chat_channels c
          where c.id = new.context_id
            and (
              c.is_private = false
              or exists (
                select 1 from public.chat_channel_members
                where channel_id = c.id and user_id = m
              )
            )
        )
        when 'project' then exists (
          select 1 from public.project_members
          where project_id = new.context_id and user_id = m
        )
        else true
      end
    );

  return new;
end;
$$;

notify pgrst, 'reload schema';
