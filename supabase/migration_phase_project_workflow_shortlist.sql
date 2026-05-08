-- migration_phase_project_workflow_shortlist.sql
-- Round-10 follow-up. A project keeps a curated list of "available workflows"
-- ("Nghiệp vụ khả dụng") chosen from the global workflow_templates library.
-- This is what the project workspace panel + the project-detail "Nghiệp vụ"
-- tab show, so the team isn't faced with the entire global catalogue every
-- time they want to start a run for the project.
--
-- Idempotent.

create table if not exists public.project_workflow_templates (
  project_id  uuid not null references public.projects(id)           on delete cascade,
  template_id uuid not null references public.workflow_templates(id) on delete cascade,
  added_by    uuid          references public.profiles(id),
  added_at    timestamptz default now(),
  primary key (project_id, template_id)
);

create index if not exists idx_pwt_project on public.project_workflow_templates (project_id);
create index if not exists idx_pwt_tmpl    on public.project_workflow_templates (template_id);

alter table public.project_workflow_templates enable row level security;

drop policy if exists "pwt view"   on public.project_workflow_templates;
drop policy if exists "pwt manage" on public.project_workflow_templates;

-- View: anyone authenticated (project visibility itself is gated elsewhere;
-- this table only holds template_id pointers).
create policy "pwt view" on public.project_workflow_templates for select
  using (auth.uid() is not null);

-- Manage (insert/update/delete): project creator OR assignee OR admin/editor.
create policy "pwt manage" on public.project_workflow_templates for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and (p.created_by = auth.uid() or p.assigned_to = auth.uid())
    )
    or exists (select 1 from public.profiles
                where id = auth.uid() and role in ('admin','editor'))
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and (p.created_by = auth.uid() or p.assigned_to = auth.uid())
    )
    or exists (select 1 from public.profiles
                where id = auth.uid() and role in ('admin','editor'))
  );

grant select, insert, update, delete on public.project_workflow_templates to authenticated;
grant select, insert, update, delete on public.project_workflow_templates to service_role;

notify pgrst, 'reload schema';
