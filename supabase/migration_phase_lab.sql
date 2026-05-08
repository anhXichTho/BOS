-- ============================================================
-- Lab phase — per-step helper/form attachments
-- Run AFTER previous migrations. Idempotent.
-- ============================================================

-- 1) Per-step attachments: helper panel + form template
alter table public.workflow_steps
  add column if not exists helper_panel_id  uuid references public.helper_panels(id),
  add column if not exists form_template_id uuid references public.form_templates(id);

-- 2) Step results can reference a form submission used to complete the step
alter table public.workflow_step_results
  add column if not exists form_submission_id uuid references public.form_submissions(id);

-- 3) Index for quick lookup of steps by attached helper/form
create index if not exists workflow_steps_helper_idx on public.workflow_steps (helper_panel_id) where helper_panel_id is not null;
create index if not exists workflow_steps_form_idx   on public.workflow_steps (form_template_id) where form_template_id is not null;

-- 4) Permissions refresh (defensive)
grant select, insert, update, delete on public.workflow_steps        to anon, authenticated;
grant select, insert, update, delete on public.workflow_step_results to anon, authenticated;
