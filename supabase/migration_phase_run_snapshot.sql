-- ============================================================
-- Phase: Workflow run snapshots (C2 sorry-decision)
-- Snapshots the step tree at run creation so template edits don't
-- corrupt in-flight runs. Run AFTER previous migrations. Idempotent.
-- ============================================================

-- 1) Snapshot table — mirrors workflow_steps but bound to a specific run.
create table if not exists public.workflow_run_steps (
  id               uuid default uuid_generate_v4() primary key,
  run_id           uuid references public.workflow_runs(id) on delete cascade,
  /* Optional: keep a pointer to the original step so existing step_results
     (referencing workflow_steps.id) still wire up cleanly during the
     transition. New runs use snapshot_id; legacy runs continue to work. */
  source_step_id   uuid references public.workflow_steps(id),
  parent_snapshot_id uuid references public.workflow_run_steps(id),
  branch_condition text,
  title            text not null,
  description      text,
  step_type        text not null check (step_type in ('simple','branch')),
  branch_options   text[],
  order_index      integer not null default 0,
  helper_panel_id  uuid references public.helper_panels(id),
  form_template_id uuid references public.form_templates(id),
  created_at       timestamptz default now()
);

create index if not exists workflow_run_steps_run_idx on public.workflow_run_steps (run_id, order_index);
create index if not exists workflow_run_steps_parent_idx on public.workflow_run_steps (parent_snapshot_id);

-- 2) workflow_step_results gains an optional pointer to the snapshot row.
--    Legacy rows keep using step_id (workflow_steps.id); new rows use snapshot_id.
alter table public.workflow_step_results
  add column if not exists snapshot_id uuid references public.workflow_run_steps(id) on delete cascade;

create index if not exists workflow_step_results_snapshot_idx
  on public.workflow_step_results (snapshot_id);

-- 3) Stored procedure: clone the live step tree into snapshot rows for a run.
--    Returns count of rows created. Idempotent: skips if snapshot already exists.
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
      helper_panel_id, form_template_id
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
      s.form_template_id
    ) returning id into v_new_id;

    v_old_to_new := v_old_to_new || jsonb_build_object(s.id::text, v_new_id::text);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$ language plpgsql security definer;

-- 4) RLS: same access as workflow_runs (run_by + admin/editor + project subord).
alter table public.workflow_run_steps enable row level security;

drop policy if exists "View snapshot via run access" on public.workflow_run_steps;
create policy "View snapshot via run access" on public.workflow_run_steps
  for select using (
    exists (
      select 1 from public.workflow_runs r
      where r.id = workflow_run_steps.run_id
        and (
          r.run_by = auth.uid()
          or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
          or r.run_by in (select public.get_all_subordinates(auth.uid()))
        )
    )
  );

drop policy if exists "Manage snapshot via run access" on public.workflow_run_steps;
create policy "Manage snapshot via run access" on public.workflow_run_steps
  for all using (
    exists (
      select 1 from public.workflow_runs r
      where r.id = workflow_run_steps.run_id
        and (
          r.run_by = auth.uid()
          or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
        )
    )
  );

grant select, insert, update, delete on public.workflow_run_steps to anon, authenticated;
