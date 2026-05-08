-- migration_phase_workflow_guidance.sql (migration #23)
-- Adds rich-text guidance/notes column to workflow_templates.
-- Used in WorkflowEditPage left panel for detailed how-to / common-mistakes /
-- support guidance — separate from the short `description` shown in run cards.
-- Idempotent — safe to re-run.

alter table public.workflow_templates
  add column if not exists guidance_html text;

-- PostgREST schema reload so the new column is visible immediately.
notify pgrst, 'reload schema';
