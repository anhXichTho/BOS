-- migration_phase_ai_conversation.sql (round-6 — migration #27)
--
-- Persists per-template AI assistant conversations. One row per template;
-- messages array grows. Trimmed to last 50 turns by the edge function.
--
-- Each entry in `messages` jsonb array:
--   { "role": "user" | "assistant",
--     "stage": "skeleton" | "details" | "review",
--     "content": string,
--     "applied"?: boolean,           -- only for assistant messages
--     "focus_s_code"?: string,       -- only for stage='details'
--     "created_at": "2024-..." }

create table if not exists public.workflow_ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.workflow_templates(id) on delete cascade,
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- One conversation row per template.
create unique index if not exists workflow_ai_conversations_template_idx
  on public.workflow_ai_conversations (template_id);

alter table public.workflow_ai_conversations enable row level security;

-- Idempotency for re-runs.
drop policy if exists "AI conv read"  on public.workflow_ai_conversations;
drop policy if exists "AI conv write" on public.workflow_ai_conversations;

-- Anyone who can SELECT the parent template can read its conversation. We
-- piggyback off the workflow_templates RLS — if you can't see the template,
-- the join below returns 0 rows so this policy returns false.
create policy "AI conv read"
  on public.workflow_ai_conversations for select
  using (exists(
    select 1 from public.workflow_templates t where t.id = template_id
  ));

-- Owner / admin / editor can write. Falls back open for service_role since
-- it bypasses RLS.
create policy "AI conv write"
  on public.workflow_ai_conversations for all
  using (
    auth.uid() = (select created_by from public.workflow_templates where id = template_id)
    or exists(select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
  )
  with check (
    auth.uid() = (select created_by from public.workflow_templates where id = template_id)
    or exists(select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
  );

grant select, insert, update, delete on public.workflow_ai_conversations to authenticated;
grant select, insert, update, delete on public.workflow_ai_conversations to service_role;

notify pgrst, 'reload schema';
