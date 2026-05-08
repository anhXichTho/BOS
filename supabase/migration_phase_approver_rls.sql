-- migration_phase_approver_rls.sql
-- Allows non-owner approvers to SELECT the run data they need and UPDATE
-- approval fields on workflow_step_results.
-- Run AFTER migration_phase_workflow_approval.sql.

-- ── 1. Approvers can SELECT workflow_runs they have approval steps on ─────────

drop policy if exists "Approvers can view assigned runs" on public.workflow_runs;
create policy "Approvers can view assigned runs" on public.workflow_runs
  for select using (
    exists (
      select 1 from public.workflow_run_steps wrs
      where wrs.run_id = workflow_runs.id
        and (
          wrs.approver_user_id = auth.uid()
          or (wrs.approver_role = 'admin'  and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
          or (wrs.approver_role = 'editor' and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor')))
        )
    )
  );

-- ── 2. Approvers can SELECT the run steps they are assigned to ────────────────

drop policy if exists "Approvers can view own run steps" on public.workflow_run_steps;
create policy "Approvers can view own run steps" on public.workflow_run_steps
  for select using (
    approver_user_id = auth.uid()
    or (approver_role = 'admin'  and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
    or (approver_role = 'editor' and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor')))
  );

-- ── 3. Approvers can SELECT step results for their assigned steps ─────────────

drop policy if exists "Approvers can view step results" on public.workflow_step_results;
create policy "Approvers can view step results" on public.workflow_step_results
  for select using (
    exists (
      select 1 from public.workflow_run_steps wrs
      where wrs.id = workflow_step_results.snapshot_id
        and (
          wrs.approver_user_id = auth.uid()
          or (wrs.approver_role = 'admin'  and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
          or (wrs.approver_role = 'editor' and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor')))
        )
    )
  );

-- ── 4. Approvers can UPDATE approval fields on step results ───────────────────

drop policy if exists "Approvers can update approval fields" on public.workflow_step_results;
create policy "Approvers can update approval fields" on public.workflow_step_results
  for update using (
    exists (
      select 1 from public.workflow_run_steps wrs
      where wrs.id = workflow_step_results.snapshot_id
        and wrs.run_id = workflow_step_results.run_id
        and (
          wrs.approver_user_id = auth.uid()
          or (wrs.approver_role = 'admin'  and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
          or (wrs.approver_role = 'editor' and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor')))
        )
    )
  );
