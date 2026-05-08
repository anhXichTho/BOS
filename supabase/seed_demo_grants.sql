-- seed_demo_grants.sql
-- Run ONCE in Supabase SQL Editor before running: npm run seed:demo
-- Grants service_role the table-level privileges it needs to bypass RLS
-- and write demo data directly.  Idempotent — safe to re-run.

grant select, insert, update, delete on public.profiles              to service_role;
grant select, insert, update, delete on public.user_groups           to service_role;
grant select, insert, update, delete on public.user_group_members    to service_role;
grant select, insert, update, delete on public.chat_channels         to service_role;
grant select, insert, update, delete on public.chat_messages         to service_role;
grant select, insert, update, delete on public.projects              to service_role;
grant select, insert, update, delete on public.form_templates        to service_role;
grant select, insert, update, delete on public.workflow_templates    to service_role;
grant select, insert, update, delete on public.workflow_steps        to service_role;
grant select, insert, update, delete on public.workflow_template_access to service_role;
grant select, insert, update, delete on public.workflow_runs         to service_role;
grant select, insert, update, delete on public.workflow_run_steps    to service_role;
grant select, insert, update, delete on public.workflow_step_results to service_role;
-- Round-8 additions: needed for seed-demo's admin notification scenarios + reactions
grant select, insert, update, delete on public.notifications            to service_role;
grant select, insert, update, delete on public.chat_message_reactions   to service_role;
grant select, insert, update, delete on public.form_submissions         to service_role;
