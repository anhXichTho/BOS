-- ─── Phase 2: form_drafts table ────────────────────────────────────────────────
--
-- Owner-only drafts for the side-panel form editor.
-- Run AFTER migration_phase_chat_rich_card.sql.
-- All statements are idempotent (safe to re-run).

-- 1. Table
create table if not exists public.form_drafts (
  id                  uuid default uuid_generate_v4() primary key,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  template_id         uuid references public.form_templates(id) on delete set null,
  template_name       text not null,                    -- snapshot: survives template delete
  template_snapshot   jsonb not null default '[]',      -- field schema at save time
  partial_data        jsonb not null default '{}',
  bot_messages        jsonb not null default '[]',      -- reserved for Phase 6
  initial_template_id uuid,                             -- if user pivoted forms mid-draft
  context_type        text check (context_type in ('channel', 'project', 'standalone', 'personal')),
  context_id          uuid,
  updated_at          timestamptz default now(),
  created_at          timestamptz default now()
);

-- 2. Indexes
create index if not exists form_drafts_user_idx
  on public.form_drafts (user_id, updated_at desc);

create index if not exists form_drafts_template_idx
  on public.form_drafts (template_id);

-- 3. RLS — strictly owner-only (never shared)
alter table public.form_drafts enable row level security;

drop policy if exists "Owner-only drafts" on public.form_drafts;
create policy "Owner-only drafts" on public.form_drafts
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 4. Grants
grant select, insert, update, delete on public.form_drafts to authenticated;
