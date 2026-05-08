-- migration_phase_approval_result_notify.sql
-- 1. Notify runner when their step is approved or rejected
-- 2. Fix fan_out_push URLs for approval/workflow notifications to include run_id

-- ── 1. Extend notifications.kind CHECK ───────────────────────────────────────
alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'mention','project_assigned','workflow_assigned','workflow_completed',
    'approval_requested','schedule_fired','form_submitted','doc_shared','generic',
    'task_assigned','task_completed','reminder','dm_message',
    'step_approved','step_rejected'
  ));

-- ── 2. Trigger: notify runner when approval_status → approved | rejected ──────
create or replace function public.fan_out_approval_result()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_run_by      uuid;
  v_run_name    text;
  v_step_title  text;
  v_approver    text;
  v_kind        text;
  v_title       text;
  v_body        text;
begin
  -- Only fire when transitioning TO approved or rejected
  if NEW.approval_status not in ('approved', 'rejected') then return NEW; end if;
  if OLD.approval_status = NEW.approval_status then return NEW; end if;

  -- Get run details
  select r.run_by, r.template_name
    into v_run_by, v_run_name
    from public.workflow_runs r
   where r.id = NEW.run_id;
  if not found then return NEW; end if;

  -- Don't self-notify (approver = runner)
  if v_run_by = auth.uid() then return NEW; end if;

  -- Get step title (snapshot-mode first, legacy fallback)
  if NEW.snapshot_id is not null then
    select title into v_step_title
      from public.workflow_run_steps where id = NEW.snapshot_id;
  end if;
  if v_step_title is null and NEW.step_id is not null then
    select title into v_step_title
      from public.workflow_steps where id = NEW.step_id;
  end if;

  -- Get approver display name from current session user
  select coalesce(full_name, 'Người duyệt') into v_approver
    from public.profiles where id = auth.uid();

  v_kind  := case NEW.approval_status when 'approved' then 'step_approved' else 'step_rejected' end;
  v_title := case NEW.approval_status
    when 'approved'
      then coalesce(v_approver, 'Người duyệt') || ' đã duyệt: ' || coalesce(v_step_title, 'bước')
    else
          coalesce(v_approver, 'Người duyệt') || ' đã từ chối: ' || coalesce(v_step_title, 'bước')
  end;
  v_body := 'Nghiệp vụ: ' || coalesce(v_run_name, '');

  insert into public.notifications (user_id, kind, title, body, payload)
  values (
    v_run_by,
    v_kind,
    v_title,
    v_body,
    jsonb_build_object(
      'run_id',         NEW.run_id,
      'step_result_id', NEW.id,
      'run_name',       coalesce(v_run_name, ''),
      'step_title',     coalesce(v_step_title, '')
    )
  );

  return NEW;
exception when others then
  return NEW;
end;
$$;

grant execute on function public.fan_out_approval_result() to authenticated;

drop trigger if exists trg_fan_out_approval_result on public.workflow_step_results;
create trigger trg_fan_out_approval_result
  after update of approval_status on public.workflow_step_results
  for each row execute function public.fan_out_approval_result();

-- ── 3. Fix fan_out_push: include run_id in URL for workflow/approval kinds ────
create or replace function public.fan_out_push()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  edge_url text;
  svc_key  text;
  nav_url  text;
  run_id   text;
begin
  select decrypted_secret into edge_url
    from vault.decrypted_secrets where name = 'push_edge_url' limit 1;
  select decrypted_secret into svc_key
    from vault.decrypted_secrets where name = 'push_service_key' limit 1;

  if edge_url is null or svc_key is null then return new; end if;

  run_id := coalesce(new.payload->>'run_id', '');

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
    when 'project_assigned' then '/projects'
    when 'task_assigned'    then '/tasks'
    when 'task_completed'   then '/tasks'
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
