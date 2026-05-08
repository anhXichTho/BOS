-- migration_phase_task_push_nav.sql
-- Fix fan_out_push: route task_assigned / task_completed to /tasks?id=<task_id>
-- so tapping a push notification opens the task drawer directly.

create or replace function public.fan_out_push()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  edge_url text;
  svc_key  text;
  nav_url  text;
  run_id   text;
  task_id  text;
begin
  select decrypted_secret into edge_url
    from vault.decrypted_secrets where name = 'push_edge_url' limit 1;
  select decrypted_secret into svc_key
    from vault.decrypted_secrets where name = 'push_service_key' limit 1;

  if edge_url is null or svc_key is null then return new; end if;

  run_id  := coalesce(new.payload->>'run_id', '');
  task_id := coalesce(new.payload->>'task_id', '');

  nav_url := case new.kind
    when 'mention' then
      '/chat?ctx_type=' || coalesce(new.payload->>'context_type', 'channel')
      || '&ctx_id='     || coalesce(new.payload->>'context_id', '')
      || '&msg_id='     || coalesce(new.payload->>'message_id', '')
    when 'dm_message'
      then '/chat?dm=' || coalesce(new.payload->>'channel_id', '')
    when 'approval_requested'
      then case when run_id <> '' then '/workflows?open_run=' || run_id else '/workflows' end
    when 'step_approved'
      then case when run_id <> '' then '/workflows?open_run=' || run_id else '/workflows' end
    when 'step_rejected'
      then case when run_id <> '' then '/workflows?open_run=' || run_id else '/workflows' end
    when 'workflow_assigned'
      then case when run_id <> '' then '/workflows?open_run=' || run_id else '/workflows' end
    when 'workflow_completed'
      then case when run_id <> '' then '/workflows?open_run=' || run_id else '/workflows' end
    when 'task_assigned'
      then case when task_id <> '' then '/tasks?id=' || task_id else '/tasks' end
    when 'task_completed'
      then case when task_id <> '' then '/tasks?id=' || task_id else '/tasks' end
    when 'project_assigned' then '/projects'
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
