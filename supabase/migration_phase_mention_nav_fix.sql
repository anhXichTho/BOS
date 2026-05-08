-- migration_phase_mention_nav_fix.sql
-- Fix mention notification routing: include ctx_type, ctx_id, msg_id in the link
-- so clicking a notification navigates directly to the right channel/project thread.

-- ── 1. Fix fan_out_mentions: build context-aware link ────────────────────────
create or replace function public.fan_out_mentions()
returns trigger as $$
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
  where m != coalesce(new.author_id, '00000000-0000-0000-0000-000000000000'::uuid);

  return new;
end;
$$ language plpgsql security definer;

-- ── 2. Fix fan_out_push: mention URL includes context params ─────────────────
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
    when 'mention' then
      '/chat?ctx_type=' || coalesce(new.payload->>'context_type', 'channel')
      || '&ctx_id='     || coalesce(new.payload->>'context_id', '')
      || '&msg_id='     || coalesce(new.payload->>'message_id', '')
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
