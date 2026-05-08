-- migration_phase_quick_task_project_link.sql
-- Round-10. Adds optional project linkage to quick_tasks so the project
-- workspace panel can list project-scoped tasks. Idempotent.

alter table public.quick_tasks
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_quick_tasks_project on public.quick_tasks (project_id, status);

notify pgrst, 'reload schema';
