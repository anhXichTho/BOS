-- migration_phase_portal_rls_anon_only.sql
-- The legacy "Public can read portal-enabled projects" policy was too broad:
-- `using (portal_enabled = true)` granted EVERY authenticated user read access
-- to every project where portal_enabled=true — bypassing assigned_to /
-- subordinate / membership checks.
--
-- Intent: serve the public customer-portal page (/portal/:slug) for anonymous
-- visitors. Restrict the policy to anonymous sessions only — authenticated
-- users must satisfy one of the other SELECT policies (assignee / subordinate
-- / member / admin/editor).

drop policy if exists "Public can read portal-enabled projects" on public.projects;

create policy "Public can read portal-enabled projects"
  on public.projects for select
  using (portal_enabled = true and auth.uid() is null);

notify pgrst, 'reload schema';
