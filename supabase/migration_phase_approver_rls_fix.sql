-- migration_phase_approver_rls_fix.sql
--
-- Fixes infinite RLS recursion that breaks MessageFeed for ALL users.
--
-- Root cause:
--   "Approvers can view assigned runs"  (workflow_runs)
--     → reads workflow_run_steps
--   "View snapshot via run access"      (workflow_run_steps)
--     → reads workflow_runs
--   → PostgreSQL detects the cycle and throws 42P17
--
-- Fix: wrap the approver side-check in a SECURITY DEFINER function.
--   SECURITY DEFINER bypasses RLS on workflow_run_steps, breaking the cycle.
--
-- Run AFTER migration_phase_approver_rls.sql.
-- Idempotent (uses OR REPLACE + DROP IF EXISTS).

-- ── 1. Helper function (bypasses RLS on workflow_run_steps) ───────────────────

create or replace function public.auth_is_approver_for_run(p_run_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workflow_run_steps wrs
    where wrs.run_id = p_run_id
      and (
        wrs.approver_user_id = auth.uid()
        or (wrs.approver_role = 'admin'
            and exists (select 1 from public.profiles
                        where id = auth.uid() and role = 'admin'))
        or (wrs.approver_role = 'editor'
            and exists (select 1 from public.profiles
                        where id = auth.uid() and role in ('admin','editor')))
      )
  );
$$;

grant execute on function public.auth_is_approver_for_run(uuid) to authenticated;

-- ── 2. Replace the recursive policy with the function-based version ───────────

drop policy if exists "Approvers can view assigned runs" on public.workflow_runs;
create policy "Approvers can view assigned runs" on public.workflow_runs
  for select using (
    public.auth_is_approver_for_run(id)
  );

-- ── 3. Same fix for workflow_run_steps — its policy also checked workflow_runs  ──
--      The "Approvers can view own run steps" policy is fine (checks profiles only).
--      But the original "View snapshot via run access" also read workflow_runs.
--      Replace it with a combined policy that avoids the mutual dependency:
--      Check direct ownership conditions WITHOUT re-entering workflow_runs RLS.
--      (admin/editor role check goes to profiles only; no join back to workflow_runs.)

create or replace function public.auth_can_view_run_steps(p_run_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select
    -- Caller is the run owner
    exists (select 1 from public.workflow_runs r
            where r.id = p_run_id and r.run_by = auth.uid())
    -- Or caller is admin/editor
    or exists (select 1 from public.profiles
               where id = auth.uid() and role in ('admin','editor'))
    -- Or caller is an assigned approver on any step of this run
    or public.auth_is_approver_for_run(p_run_id);
$$;

grant execute on function public.auth_can_view_run_steps(uuid) to authenticated;

drop policy if exists "View snapshot via run access" on public.workflow_run_steps;
create policy "View snapshot via run access" on public.workflow_run_steps
  for select using (
    public.auth_can_view_run_steps(run_id)
  );

drop policy if exists "Manage snapshot via run access" on public.workflow_run_steps;
create policy "Manage snapshot via run access" on public.workflow_run_steps
  for all using (
    exists (select 1 from public.workflow_runs r
            where r.id = run_id and r.run_by = auth.uid())
    or exists (select 1 from public.profiles
               where id = auth.uid() and role in ('admin','editor'))
  );
