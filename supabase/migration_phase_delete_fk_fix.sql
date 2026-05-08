-- ── Migration: delete FK fix ─────────────────────────────────────────────────
-- Allows deleting workflow_templates and projects without cascade-destroying
-- run history. Uses ON DELETE SET NULL so run/schedule rows survive with a
-- null foreign key rather than being hard-blocked by RESTRICT (the default).
--
-- Run this ONCE in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. workflow_runs.template_id: RESTRICT → SET NULL
--    Deleting a template preserves all run history; template_id becomes null.
alter table public.workflow_runs
  drop constraint if exists workflow_runs_template_id_fkey;
alter table public.workflow_runs
  add constraint workflow_runs_template_id_fkey
    foreign key (template_id) references public.workflow_templates(id)
    on delete set null;

-- 2. workflow_runs.project_id: RESTRICT → SET NULL
--    Deleting a project preserves all run history; project_id becomes null.
alter table public.workflow_runs
  drop constraint if exists workflow_runs_project_id_fkey;
alter table public.workflow_runs
  add constraint workflow_runs_project_id_fkey
    foreign key (project_id) references public.projects(id)
    on delete set null;

-- 3. workflow_schedules.project_id: RESTRICT → SET NULL
--    Deleting a project keeps its schedules (disabled/orphaned); project_id null.
alter table public.workflow_schedules
  drop constraint if exists workflow_schedules_project_id_fkey;
alter table public.workflow_schedules
  add constraint workflow_schedules_project_id_fkey
    foreign key (project_id) references public.projects(id)
    on delete set null;

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';
