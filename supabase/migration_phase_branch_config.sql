-- migration_phase_branch_config.sql (round-5 phase B follow-up — migration #26)
--
-- Adds branch_config + show_when jsonb columns to workflow_steps + the
-- run-snapshot copy in workflow_run_steps. Both are nullable; legacy templates
-- continue to use the existing branch_options/branch_condition + condition_*
-- columns at runtime. The editor UI writes the new shapes; the runtime
-- evaluator port to read them is a follow-up commit.
--
-- Shape (TypeScript-side `BranchConfig` / `ShowWhen` in src/components/workflow-edit/types.ts):
--
-- branch_config (only set when step_type='branch'):
--   {
--     "source_kind": "outcome" | "field",
--     "source_step_id": "<workflow_steps.id>",
--     "source_field_id": "<form_template.fields[*].id>" | null,
--     "cases": [
--       { "id": "<uuid>", "label": "string", "operator": "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains", "value": "string" }
--     ]
--   }
--
-- show_when (any step):
--   {
--     "source_kind": "outcome" | "field",
--     "source_step_id": "<workflow_steps.id>",
--     "source_field_id": "<form_template.fields[*].id>" | null,
--     "operator": "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains",
--     "value": "string"
--   } | null   (null ⇒ always show)

alter table public.workflow_steps
  add column if not exists branch_config jsonb,
  add column if not exists show_when     jsonb;

alter table public.workflow_run_steps
  add column if not exists branch_config jsonb,
  add column if not exists show_when     jsonb;

-- Reload PostgREST so the new columns are visible immediately.
notify pgrst, 'reload schema';
