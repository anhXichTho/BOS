-- migration_phase_form_progressive_fill.sql (migration #22)
-- Enables progressive form-fill across multiple workflow steps + per-field fill rules.
--
-- The actual field-shape changes (fill_at_step_id, fill_by_role, fill_by_user_id,
-- inherited_from_field_id) live in form_templates.fields jsonb — NO column ALTER
-- on form_templates is needed.
--
-- This migration only touches form_submissions:
--   1. Adds last_updated_by_step_id for audit (which run-step last patched the row)
--   2. Adds a partial unique index enforcing 1 submission row per (run, template)
--      for workflow-run context. Standalone form_submissions are unaffected.
-- Idempotent — safe to re-run.

-- 1. Audit column ────────────────────────────────────────────────────────────
alter table public.form_submissions
  add column if not exists last_updated_by_step_id uuid
    references public.workflow_run_steps(id) on delete set null;

-- 2. Unique partial index — one submission per (workflow_run, template) ─────
-- form_submissions.context_id holds the workflow_run id when context_type='workflow_run'.
-- (Other context_types — 'channel', 'project', 'standalone' — are excluded by the WHERE.)
create unique index if not exists uniq_form_submission_per_run
  on public.form_submissions (context_id, template_id)
  where context_type = 'workflow_run';

-- 3. PostgREST schema reload so the new column is visible immediately ───────
notify pgrst, 'reload schema';
