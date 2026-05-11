-- migration_phase_reminder_fire.sql (round-10b)
--
-- Adds the missing fire mechanism for reminders:
--   1. fire_due_reminders() — checks reminders WHERE fire_at <= now() AND fired_at IS NULL,
--      creates notifications for the creator + ALL members of the source channel/project,
--      then marks the reminder as fired.
--   2. pg_cron job every minute (same cadence as workflow schedules).
--
-- Idempotent — safe to re-run.

create or replace function public.fire_due_reminders()
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  r          record;
  member_id  uuid;
  ch_is_private boolean;
begin
  for r in
    select * from public.reminders
    where fire_at <= now()
      and fired_at is null
  loop
    -- Always notify the creator (the person who set the reminder)
    insert into public.notifications (user_id, kind, title, body, payload)
    values (
      r.created_by,
      'reminder',
      '🔔 ' || r.title,
      'Nhắc việc của bạn đã đến giờ',
      jsonb_build_object(
        'source_context_type', r.source_context_type,
        'source_context_id',   r.source_context_id,
        'source_message_id',   r.source_message_id
      )
    );

    -- Fan out to other channel members when the reminder has a channel context
    if r.source_context_type = 'channel' and r.source_context_id is not null then

      select coalesce(is_private, false) into ch_is_private
        from public.chat_channels where id = r.source_context_id;

      if ch_is_private then
        -- Private channel: notify explicit member list (skip creator, already notified)
        for member_id in
          select user_id from public.chat_channel_members
          where channel_id = r.source_context_id
            and user_id is distinct from r.created_by
        loop
          insert into public.notifications (user_id, kind, title, body, payload)
          values (
            member_id,
            'reminder',
            '🔔 ' || r.title,
            'Nhắc việc trong nhóm chat',
            jsonb_build_object(
              'source_context_type', r.source_context_type,
              'source_context_id',   r.source_context_id,
              'source_message_id',   r.source_message_id
            )
          );
        end loop;

      else
        -- Public channel: notify all profiles (skip creator)
        for member_id in
          select id from public.profiles
          where id is distinct from r.created_by
        loop
          insert into public.notifications (user_id, kind, title, body, payload)
          values (
            member_id,
            'reminder',
            '🔔 ' || r.title,
            'Nhắc việc trong nhóm chat',
            jsonb_build_object(
              'source_context_type', r.source_context_type,
              'source_context_id',   r.source_context_id,
              'source_message_id',   r.source_message_id
            )
          );
        end loop;
      end if;

    end if;

    -- Mark as fired
    update public.reminders set fired_at = now() where id = r.id;

  end loop;
end $$;

grant execute on function public.fire_due_reminders() to authenticated;
grant execute on function public.fire_due_reminders() to service_role;

-- pg_cron: every minute (same cadence as run_due_schedules)
select cron.unschedule('fire_due_reminders') where exists (
  select 1 from cron.job where jobname = 'fire_due_reminders'
);
select cron.schedule(
  'fire_due_reminders',
  '* * * * *',
  $$select public.fire_due_reminders();$$
);

notify pgrst, 'reload schema';
