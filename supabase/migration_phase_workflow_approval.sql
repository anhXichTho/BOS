-- ============================================================
-- Phase: Workflow Approval + Assignment + DM Channels
--
-- Changes:
--   1. workflow_template_access  — which user groups can start a run
--   2. Approval fields on workflow_steps, workflow_run_steps
--   3. Approval state on workflow_step_results
--   4. DM channels: channel_type + dm_partner_id on chat_channels
--   5. get_or_create_dm_channel(partner_id uuid) RPC
--   6. Update notifications kind constraint (add 'approval_requested')
--   7. fan_out_approvals trigger
--   8. Update snapshot_workflow_run to copy approval fields
--
-- Run AFTER migration_phase_chat_unread.sql. Idempotent.
-- ============================================================

-- ── 1. Workflow template access control ───────────────────────────────────────
create table if not exists public.workflow_template_access (
  template_id uuid not null references public.workflow_templates(id) on delete cascade,
  group_id    uuid not null references public.user_groups(id)        on delete cascade,
  primary key (template_id, group_id)
);

alter table public.workflow_template_access enable row level security;

drop policy if exists "select wta" on public.workflow_template_access;
create policy "select wta" on public.workflow_template_access
  for select using (true);

drop policy if exists "manage wta" on public.workflow_template_access;
create policy "manage wta" on public.workflow_template_access
  for all
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin','editor')
  ));

grant select, insert, delete on public.workflow_template_access to authenticated;

-- ── 2. Approval fields on workflow_steps (template definition) ────────────────
alter table public.workflow_steps
  add column if not exists requires_approval boolean not null default false,
  add column if not exists approver_user_id  uuid    references public.profiles(id),
  add column if not exists approver_role     text    check (approver_role in ('admin','editor','specific_user'));

-- ── 3. Approval fields on workflow_run_steps (snapshot) ───────────────────────
alter table public.workflow_run_steps
  add column if not exists requires_approval boolean not null default false,
  add column if not exists approver_user_id  uuid    references public.profiles(id),
  add column if not exists approver_role     text    check (approver_role in ('admin','editor','specific_user'));

-- ── 4. Approval state on workflow_step_results ────────────────────────────────
alter table public.workflow_step_results
  add column if not exists approval_status  text    check (approval_status in ('pending','approved','rejected')),
  add column if not exists approved_by      uuid    references public.profiles(id),
  add column if not exists approval_comment text,
  add column if not exists approval_at      timestamptz;

-- ── 5. DM channels ────────────────────────────────────────────────────────────
-- Ensure self-chat columns exist (also added by migration_phase_self_chat.sql — idempotent).
alter table public.chat_channels
  add column if not exists owner_id    uuid references public.profiles(id),
  add column if not exists created_by  uuid references public.profiles(id),
  add column if not exists description text;

-- Add channel_type and dm_partner_id.
alter table public.chat_channels
  add column if not exists channel_type  text not null default 'team'
    check (channel_type in ('team','personal','dm')),
  add column if not exists dm_partner_id uuid references public.profiles(id);

-- Backfill: existing personal channels (owner_id IS NOT NULL) → 'personal'
update public.chat_channels set channel_type = 'personal'
  where owner_id is not null and channel_type = 'team';

-- Unique constraint: at most one DM between any two users.
create unique index if not exists uniq_dm_pair
  on public.chat_channels (
    least(owner_id::text, dm_partner_id::text),
    greatest(owner_id::text, dm_partner_id::text)
  )
  where channel_type = 'dm';

-- Expand the RLS so DM partners can read the channel.
drop policy if exists "View team channels and own personal channel" on public.chat_channels;
create policy "View team channels and own personal channel" on public.chat_channels
  for select using (
    auth.uid() is not null
    and (
      channel_type = 'team'
      or owner_id = auth.uid()
      or dm_partner_id = auth.uid()
    )
  );

-- Expand chat_messages RLS to allow DM partners to read messages.
drop policy if exists "View messages with channel scoping" on public.chat_messages;
create policy "View messages with channel scoping" on public.chat_messages
  for select using (
    auth.uid() is not null
    and (
      context_type <> 'channel'
      or exists (
        select 1 from public.chat_channels c
         where c.id = chat_messages.context_id
           and (
             c.channel_type = 'team'
             or c.owner_id = auth.uid()
             or c.dm_partner_id = auth.uid()
           )
      )
    )
  );

-- ── 6. RPC: get_or_create_dm_channel ──────────────────────────────────────────
create or replace function public.get_or_create_dm_channel(partner_id uuid)
returns public.chat_channels
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ch public.chat_channels;
begin
  -- Look for an existing DM channel between current user and partner (either direction)
  select * into ch
    from public.chat_channels
   where channel_type = 'dm'
     and (
       (owner_id = auth.uid() and dm_partner_id = partner_id)
       or (owner_id = partner_id and dm_partner_id = auth.uid())
     );

  if not found then
    insert into public.chat_channels (name, channel_type, owner_id, dm_partner_id, created_by)
    values ('DM', 'dm', auth.uid(), partner_id, auth.uid())
    returning * into ch;
  end if;

  return ch;
end $$;

grant execute on function public.get_or_create_dm_channel(uuid) to authenticated;

-- ── 7. Update notifications kind constraint ───────────────────────────────────
alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'mention','project_assigned','workflow_assigned','workflow_completed',
    'approval_requested','schedule_fired','form_submitted','doc_shared','generic'
  ));

-- ── 8. fan_out_approvals trigger ──────────────────────────────────────────────
create or replace function public.fan_out_approvals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  approver_id  uuid;
  step_title   text;
  run_row      public.workflow_runs;
  personal_ch  public.chat_channels;
  creator_name text;
begin
  -- Only fire when approval_status transitions TO 'pending'
  if new.approval_status is distinct from 'pending' then
    return new;
  end if;
  -- Don't re-notify if it was already pending before this update
  if TG_OP = 'UPDATE' and OLD.approval_status = 'pending' then
    return new;
  end if;

  -- Resolve approver_id from snapshot (new runs) or template step (legacy)
  if new.snapshot_id is not null then
    select wrs.approver_user_id, wrs.title
      into approver_id, step_title
      from public.workflow_run_steps wrs
     where wrs.id = new.snapshot_id;
  else
    select ws.approver_user_id, ws.title
      into approver_id, step_title
      from public.workflow_steps ws
     where ws.id = new.step_id;
  end if;

  if approver_id is null then
    return new;
  end if;

  -- Fetch the run info
  select * into run_row from public.workflow_runs where id = new.run_id;
  if run_row is null then return new; end if;

  -- Fetch creator display name
  select coalesce(full_name, 'Unknown') into creator_name
    from public.profiles where id = run_row.run_by;

  -- Get or create the approver's personal channel
  select * into personal_ch
    from public.chat_channels
   where owner_id = approver_id and channel_type = 'personal';

  if not found then
    insert into public.chat_channels (name, description, channel_type, owner_id, created_by)
    values ('Cá nhân', 'Kênh riêng', 'personal', approver_id, approver_id)
    returning * into personal_ch;
  end if;

  -- Post approval-request rich card to the approver's personal channel
  insert into public.chat_messages (
    context_type, context_id, author_id, message_type, content, payload
  ) values (
    'channel',
    personal_ch.id,
    run_row.run_by,
    'rich_card',
    null,
    jsonb_build_object(
      'kind',           'approval_request',
      'run_id',         run_row.id,
      'run_name',       run_row.template_name,
      'step_result_id', new.id,
      'step_title',     coalesce(step_title, '(bước không tên)'),
      'requester_id',   run_row.run_by,
      'requester_name', creator_name,
      'requested_at',   now()
    )
  );

  -- Post a notifications row for the in-app bell
  insert into public.notifications (user_id, kind, title, body, payload)
  values (
    approver_id,
    'approval_requested',
    'Cần duyệt: ' || run_row.template_name,
    creator_name || ' yêu cầu bạn duyệt bước: ' || coalesce(step_title, ''),
    jsonb_build_object('run_id', run_row.id, 'step_result_id', new.id)
  );

  return new;
end $$;

drop trigger if exists trg_fan_out_approvals on public.workflow_step_results;
create trigger trg_fan_out_approvals
  after insert or update of approval_status
  on public.workflow_step_results
  for each row execute function public.fan_out_approvals();

-- ── 9. Update snapshot_workflow_run to copy approval fields ───────────────────
create or replace function public.snapshot_workflow_run(p_run uuid)
returns integer as $$
declare
  v_template uuid;
  v_count integer := 0;
  v_old_to_new jsonb := '{}'::jsonb;
  s record;
  v_new_id uuid;
begin
  -- Already snapshotted? skip.
  if exists (select 1 from public.workflow_run_steps where run_id = p_run) then
    return 0;
  end if;

  select template_id into v_template
    from public.workflow_runs where id = p_run;
  if v_template is null then
    raise exception 'Workflow run % not found', p_run;
  end if;

  -- Roots first, then children, so parent_snapshot_id is resolvable.
  for s in
    select * from public.workflow_steps
    where template_id = v_template
    order by case when parent_step_id is null then 0 else 1 end, order_index
  loop
    insert into public.workflow_run_steps (
      run_id, source_step_id, parent_snapshot_id, branch_condition,
      title, description, step_type, branch_options, order_index,
      helper_panel_id, form_template_id,
      requires_approval, approver_user_id, approver_role
    ) values (
      p_run,
      s.id,
      case
        when s.parent_step_id is null then null
        else (v_old_to_new ->> s.parent_step_id::text)::uuid
      end,
      s.branch_condition,
      s.title,
      s.description,
      s.step_type,
      s.branch_options,
      s.order_index,
      s.helper_panel_id,
      s.form_template_id,
      s.requires_approval,
      s.approver_user_id,
      s.approver_role
    ) returning id into v_new_id;

    v_old_to_new := v_old_to_new || jsonb_build_object(s.id::text, v_new_id::text);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$ language plpgsql security definer;
