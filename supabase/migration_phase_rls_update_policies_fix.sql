-- migration_phase_rls_update_policies_fix.sql (round-8 — migration #30)
--
-- Two RLS gaps surfaced by the round-8 sequential test suite:
--
-- 1. `form_submissions` had no UPDATE policy. RLS silently blocked the
--    progressive form-fill UPSERT path in StepFormModal.submit (gotcha #54),
--    so users saw "Đã cập nhật" toasts even though the row never changed.
--
-- 2. `workflow_runs` UPDATE was gated by `for all using (run_by = auth.uid())`,
--    so an admin/editor (or final-step approver) marking a run completed via
--    WorkflowRunPanel.completeRun never actually flipped status — they were
--    not the run_by, so RLS silently filtered the UPDATE to 0 rows.
--
-- Fix: allow submitter + admin/editor to UPDATE form_submissions, and
-- allow admin/editor to UPDATE any workflow_run.
--
-- Idempotent — safe to re-run.

-- ─── 1. form_submissions UPDATE policy ────────────────────────────────────────
drop policy if exists "Users can update own submissions" on public.form_submissions;
create policy "Users can update own submissions" on public.form_submissions
  for update using (
    submitted_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin','editor')
    )
  );

-- ─── 2. workflow_runs — split monolithic `for all` policy ─────────────────────
-- The original `"Users can create and update own runs" for all using (run_by = auth.uid())`
-- bundled INSERT/UPDATE/DELETE under a single check. Splitting lets us widen
-- UPDATE for admins/editors without giving them DELETE rights they don't need.

drop policy if exists "Users can create and update own runs" on public.workflow_runs;

drop policy if exists "Users can create own runs" on public.workflow_runs;
create policy "Users can create own runs" on public.workflow_runs
  for insert with check (run_by = auth.uid());

drop policy if exists "Users can update runs (owner or admin/editor)" on public.workflow_runs;
create policy "Users can update runs (owner or admin/editor)" on public.workflow_runs
  for update using (
    run_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin','editor')
    )
  );

drop policy if exists "Users can delete own runs" on public.workflow_runs;
create policy "Users can delete own runs" on public.workflow_runs
  for delete using (
    run_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin','editor')
    )
  );

-- ─── 3. Reload PostgREST schema cache ─────────────────────────────────────────
notify pgrst, 'reload schema';
