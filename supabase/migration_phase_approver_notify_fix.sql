-- migration_phase_approver_notify_fix.sql  (migration #32)
--
-- Fix: fan_out_approvals now correctly notifies role-based approvers.
--
-- Bug: when a workflow step is configured with approver_role = 'admin' or 'editor'
-- (and no specific approver_user_id), the old trigger resolved approver_id as NULL
-- and returned immediately without sending any notification.
--
-- Fix: use a FOR loop that UNION-ALLs both cases:
--   • specific user   → the single approver_user_id
--   • role-based      → all profiles with role = approver_role (excluding the runner)

create or replace function public.fan_out_approvals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_approver_id   uuid;
  v_approver_role text;
  v_step_title    text;
  v_run_row       public.workflow_runs;
  v_personal_ch   public.chat_channels;
  v_creator_name  text;
  v_target_id     uuid;
begin
  -- Only fire when approval_status transitions TO 'pending'
  if new.approval_status is distinct from 'pending' then
    return new;
  end if;
  -- Don't re-notify if approval_status was already 'pending' (avoid duplicate on re-save)
  if TG_OP = 'UPDATE' and OLD.approval_status = 'pending' then
    return new;
  end if;

  -- Resolve approver from snapshot row (new runs) or template step (legacy runs)
  if new.snapshot_id is not null then
    select wrs.approver_user_id, wrs.approver_role, wrs.title
      into v_approver_id, v_approver_role, v_step_title
      from public.workflow_run_steps wrs
     where wrs.id = new.snapshot_id;
  else
    select ws.approver_user_id, ws.approver_role, ws.title
      into v_approver_id, v_approver_role, v_step_title
      from public.workflow_steps ws
     where ws.id = new.step_id;
  end if;

  -- Nothing useful configured (specific_user selected but no user picked, or null)
  if v_approver_id is null and (v_approver_role is null or v_approver_role = 'specific_user') then
    return new;
  end if;

  -- Fetch the run row
  select * into v_run_row from public.workflow_runs where id = new.run_id;
  if v_run_row is null then return new; end if;

  -- Fetch creator display name
  select coalesce(full_name, 'Unknown') into v_creator_name
    from public.profiles where id = v_run_row.run_by;

  -- Fan out to: the specific user OR every user with the configured role
  for v_target_id in
    -- Case 1: specific approver_user_id
    select v_approver_id
     where v_approver_id is not null
    union all
    -- Case 2: all profiles matching approver_role (skip the runner to avoid self-notify)
    select p.id
      from public.profiles p
     where v_approver_id is null
       and v_approver_role in ('admin', 'editor')
       and p.role = v_approver_role
       and p.id  != v_run_row.run_by
  loop

    -- Get or create the approver's personal channel
    select * into v_personal_ch
      from public.chat_channels
     where owner_id = v_target_id and channel_type = 'personal';

    if not found then
      insert into public.chat_channels (name, description, channel_type, owner_id, created_by)
      values ('Cá nhân', 'Kênh riêng', 'personal', v_target_id, v_target_id)
      returning * into v_personal_ch;
    end if;

    -- Post approval-request rich card to the approver's personal channel
    insert into public.chat_messages (
      context_type, context_id, author_id, message_type, content, payload
    ) values (
      'channel',
      v_personal_ch.id,
      v_run_row.run_by,
      'rich_card',
      null,
      jsonb_build_object(
        'kind',           'approval_request',
        'run_id',         v_run_row.id,
        'run_name',       v_run_row.template_name,
        'step_result_id', new.id,
        'step_title',     coalesce(v_step_title, '(bước không tên)'),
        'requester_id',   v_run_row.run_by,
        'requester_name', v_creator_name,
        'requested_at',   now()
      )
    );

    -- Post a notifications row for the in-app bell
    insert into public.notifications (user_id, kind, title, body, payload)
    values (
      v_target_id,
      'approval_requested',
      'Cần duyệt: ' || v_run_row.template_name,
      v_creator_name || ' yêu cầu bạn duyệt bước: ' || coalesce(v_step_title, ''),
      jsonb_build_object('run_id', v_run_row.id, 'step_result_id', new.id)
    );

  end loop;

  return new;
end $$;

-- Re-create trigger (idempotent)
drop trigger if exists trg_fan_out_approvals on public.workflow_step_results;
create trigger trg_fan_out_approvals
  after insert or update of approval_status
  on public.workflow_step_results
  for each row execute function public.fan_out_approvals();
