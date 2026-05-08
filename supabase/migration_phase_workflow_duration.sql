-- migration_phase_workflow_duration.sql
-- Adds duration_hours per step (default 3) for progress-bar visualisation.
-- Idempotent: safe to re-run.

alter table public.workflow_steps
  add column if not exists duration_hours numeric not null default 3;

alter table public.workflow_run_steps
  add column if not exists duration_hours numeric not null default 3;

-- Reload PostgREST schema cache so the new column is visible immediately.
notify pgrst, 'reload schema';
