-- migration_phase_workflow_steps_fk_fix.sql (round-7g — migration #29)
--
-- The workflow editor save flow is wipe-and-replace: it DELETEs all
-- workflow_steps rows for a template and re-INSERTs from the in-memory
-- draft. Three FK constraints silently blocked this when the workflow
-- had been RUN before:
--
--   workflow_steps.parent_step_id   → workflow_steps(id)         NO ACTION
--   workflow_step_results.step_id   → workflow_steps(id)         NO ACTION
--   workflow_run_steps.source_step_id → workflow_steps(id)       NO ACTION (likely)
--
-- The supabase-js client returns errors as `{ data, error }` instead of
-- throwing, so the save flow continued past the failed DELETE, the new
-- INSERTs collided or were skipped, and the user saw "không lưu được"
-- with no toast.
--
-- This migration sets the right ON DELETE behaviours:
--   • parent_step_id   → CASCADE   (self-ref: deleting parent deletes
--                                   its descendants in the same template)
--   • step_id          → SET NULL  (preserve run history, just drop the
--                                   broken pointer)
--   • source_step_id   → SET NULL  (same reason — snapshot stays, ref
--                                   becomes null)
--
-- Idempotent — safe to re-run.

-- ─── 1. workflow_steps.parent_step_id → CASCADE ───────────────────────────
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'workflow_steps_parent_step_id_fkey'
  ) then
    alter table public.workflow_steps
      drop constraint workflow_steps_parent_step_id_fkey;
  end if;
end $$;

alter table public.workflow_steps
  add constraint workflow_steps_parent_step_id_fkey
  foreign key (parent_step_id) references public.workflow_steps(id)
  on delete cascade;

-- ─── 2. workflow_step_results.step_id → SET NULL ──────────────────────────
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'workflow_step_results_step_id_fkey'
  ) then
    alter table public.workflow_step_results
      drop constraint workflow_step_results_step_id_fkey;
  end if;
end $$;

alter table public.workflow_step_results
  add constraint workflow_step_results_step_id_fkey
  foreign key (step_id) references public.workflow_steps(id)
  on delete set null;

-- ─── 3. workflow_run_steps.source_step_id → SET NULL (if table exists) ────
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'workflow_run_steps'
  ) then
    if exists (
      select 1 from pg_constraint
      where conname = 'workflow_run_steps_source_step_id_fkey'
    ) then
      execute 'alter table public.workflow_run_steps drop constraint workflow_run_steps_source_step_id_fkey';
    end if;
    execute 'alter table public.workflow_run_steps
             add constraint workflow_run_steps_source_step_id_fkey
             foreign key (source_step_id) references public.workflow_steps(id)
             on delete set null';
  end if;
end $$;

-- ─── 4. Reload PostgREST schema cache ─────────────────────────────────────
notify pgrst, 'reload schema';
