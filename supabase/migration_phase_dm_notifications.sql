-- migration_phase_dm_notifications.sql
-- Push notifications for DM messages: when user A sends a message to a DM channel,
-- user B gets an in-app notification (and a push notification via the existing
-- fan_out_push trigger on the notifications table).

-- ── 1. Extend notifications.kind CHECK ───────────────────────────────────────
alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'mention','project_assigned','workflow_assigned','workflow_completed',
    'approval_requested','schedule_fired','form_submitted','doc_shared','generic',
    'task_assigned','task_completed','reminder','dm_message'
  ));

-- ── 2. Trigger function: notify DM recipient on new message ──────────────────
create or replace function public.fan_out_dm_message()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  ch          record;
  recipient   uuid;
  sender_name text;
  msg_preview text;
begin
  -- Only channel messages from a real user
  if NEW.context_type <> 'channel' then return NEW; end if;
  if NEW.author_id is null then return NEW; end if;
  -- Skip system cards (workflow links, bot responses, stickers etc.)
  if NEW.message_type in ('workflow_run_link', 'rich_card') then return NEW; end if;

  -- Look up channel
  select channel_type, owner_id, dm_partner_id
    into ch
    from public.chat_channels
   where id = NEW.context_id;

  if not found or ch.channel_type <> 'dm' then return NEW; end if;

  -- Determine recipient (the other person in the DM)
  if NEW.author_id = ch.owner_id then
    recipient := ch.dm_partner_id;
  else
    recipient := ch.owner_id;
  end if;

  if recipient is null or recipient = NEW.author_id then return NEW; end if;

  -- Sender display name
  select coalesce(full_name, '—') into sender_name
    from public.profiles where id = NEW.author_id;

  -- Strip basic HTML tags and truncate for the body
  msg_preview := left(
    regexp_replace(coalesce(NEW.content, ''), '<[^>]+>', '', 'g'),
    120
  );
  if msg_preview = '' then msg_preview := '📎 Tệp đính kèm'; end if;

  insert into public.notifications (user_id, kind, title, body, payload)
  values (
    recipient,
    'dm_message',
    coalesce(sender_name, 'Ai đó') || ' nhắn tin cho bạn',
    msg_preview,
    jsonb_build_object(
      'channel_id', NEW.context_id,
      'message_id', NEW.id,
      'sender_id',  NEW.author_id
    )
  );

  return NEW;
exception when others then
  return NEW; -- never block the INSERT
end;
$$;

grant execute on function public.fan_out_dm_message() to authenticated;

drop trigger if exists trg_fan_out_dm_message on public.chat_messages;
create trigger trg_fan_out_dm_message
  after insert on public.chat_messages
  for each row execute function public.fan_out_dm_message();

-- ── 3. Update fan_out_push to route dm_message to the right DM channel ───────
create or replace function public.fan_out_push()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  edge_url text;
  svc_key  text;
  nav_url  text;
begin
  select decrypted_secret into edge_url
    from vault.decrypted_secrets where name = 'push_edge_url' limit 1;
  select decrypted_secret into svc_key
    from vault.decrypted_secrets where name = 'push_service_key' limit 1;

  if edge_url is null or svc_key is null then return new; end if;

  nav_url := case new.kind
    when 'mention'            then '/chat'
    when 'dm_message'         then '/chat?dm=' || coalesce(new.payload->>'channel_id', '')
    when 'approval_requested' then '/workflows'
    when 'project_assigned'   then '/projects'
    when 'workflow_assigned'  then '/workflows'
    when 'workflow_completed' then '/workflows'
    when 'task_assigned'      then '/tasks'
    when 'task_completed'     then '/tasks'
    else '/'
  end;

  perform net.http_post(
    url     := edge_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || svc_key
    ),
    body    := jsonb_build_object(
      'user_id', new.user_id,
      'title',   new.title,
      'body',    coalesce(new.body, ''),
      'url',     nav_url,
      'tag',     new.kind
    )
  );

  return new;
exception when others then
  return new;
end;
$$;
