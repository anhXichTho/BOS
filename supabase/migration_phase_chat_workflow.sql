-- ============================================================
-- Phase 7: Workflow-from-chat
-- Allow chat messages to embed a reference to a workflow_run.
-- Run AFTER previous migrations. Idempotent.
-- ============================================================

-- 1) Extend the message_type enum to include workflow_run_link.
alter table public.chat_messages
  drop constraint if exists chat_messages_message_type_check;

alter table public.chat_messages
  add constraint chat_messages_message_type_check
  check (message_type in ('text', 'form_submission', 'workflow_run_link'));

-- 2) Optional pointer to a workflow_run (FK with on-delete set null so
--    deleting the run doesn't break the chat history).
alter table public.chat_messages
  add column if not exists workflow_run_id uuid references public.workflow_runs(id) on delete set null;

create index if not exists chat_messages_workflow_run_idx
  on public.chat_messages (workflow_run_id) where workflow_run_id is not null;
