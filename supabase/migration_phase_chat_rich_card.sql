-- ─── Phase 1: Flexible chat payload + per-template summary fields ─────────────
--
-- Run this in Supabase SQL Editor BEFORE deploying the matching client code.
-- All statements are idempotent (safe to re-run).

-- 1. Drop the rigid CHECK constraint added in migration_phase_chat_workflow.sql.
--    Adding new card kinds in TypeScript no longer requires a migration.
alter table public.chat_messages
  drop constraint if exists chat_messages_message_type_check;

-- 2. Re-add as an open list.  New kinds (bot_action_summary, etc.) are TS-only changes.
alter table public.chat_messages
  add constraint chat_messages_message_type_check
  check (message_type in ('text', 'form_submission', 'workflow_run_link', 'rich_card'));

-- 3. New payload column — drives all rich_card variants; legacy types ignore it.
alter table public.chat_messages
  add column if not exists payload jsonb;

-- 4. Per-template summary fields for the chat-card preview (max 3).
alter table public.form_templates
  add column if not exists summary_field_ids text[] not null default '{}';

-- 5. Ensure chat_messages is in the realtime publication.
--    Wrapped in DO block so it's safe to re-run if already added.
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception
  when duplicate_object then null;
end $$;
