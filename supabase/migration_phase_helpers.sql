-- ============================================================
-- Helper panels — FAQ list + chatbot preset
-- Run AFTER schema.sql + migration_phase_a.sql
-- Idempotent: safe to re-run.
-- ============================================================

-- 1) Helper panel definitions (managed in Settings → Helpers)
create table if not exists public.helper_panels (
  id          uuid default uuid_generate_v4() primary key,
  type        text not null check (type in ('faq', 'chatbot')),
  name        text not null,
  description text,
  config      jsonb not null default '{}',
  created_by  uuid references public.profiles(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists helper_panels_type_idx on public.helper_panels (type);

-- 2) FAQ items (only used when helper is type='faq')
create table if not exists public.helper_faq_items (
  id          uuid default uuid_generate_v4() primary key,
  panel_id    uuid references public.helper_panels(id) on delete cascade,
  question    text not null,
  answer      text not null,
  order_index integer not null default 0,
  created_at  timestamptz default now()
);

create index if not exists helper_faq_items_panel_idx on public.helper_faq_items (panel_id, order_index);

-- 3) Optional Postgres full-text index for FAQ semantic-ish search
create index if not exists helper_faq_items_fts on public.helper_faq_items
  using gin (to_tsvector('simple', coalesce(question,'') || ' ' || coalesce(answer,'')));

-- 4) Attach helper panel to workflow templates
alter table public.workflow_templates
  add column if not exists helper_panel_id uuid references public.helper_panels(id);

-- 5) RLS
alter table public.helper_panels    enable row level security;
alter table public.helper_faq_items enable row level security;

drop policy if exists "All can view helpers" on public.helper_panels;
create policy "All can view helpers" on public.helper_panels
  for select using (auth.uid() is not null);

drop policy if exists "Admin/Editor manage helpers" on public.helper_panels;
create policy "Admin/Editor manage helpers" on public.helper_panels
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
  );

drop policy if exists "All can view faq items" on public.helper_faq_items;
create policy "All can view faq items" on public.helper_faq_items
  for select using (auth.uid() is not null);

drop policy if exists "Admin/Editor manage faq items" on public.helper_faq_items;
create policy "Admin/Editor manage faq items" on public.helper_faq_items
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
  );

-- 6) Grants
grant select, insert, update, delete on public.helper_panels    to anon, authenticated;
grant select, insert, update, delete on public.helper_faq_items to anon, authenticated;
