-- migration_phase_project_info_cards.sql (migration #25)
-- Notes / commentary cards attached to a project's customer-portal area.
-- Staff (admin/editor) can add chronological notes. Visible in the project's
-- Cổng KH tab (NOT exposed to the customer portal itself — internal only).
-- Idempotent — safe to re-run.

create table if not exists public.project_info_cards (
  id          uuid       primary key default gen_random_uuid(),
  project_id  uuid       not null references public.projects(id) on delete cascade,
  author_id   uuid       references public.profiles(id) on delete set null,
  body_html   text       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists project_info_cards_project_idx
  on public.project_info_cards (project_id, created_at desc);

alter table public.project_info_cards enable row level security;

-- Read: any authenticated user can read.
do $$ begin
  create policy "members read info cards"
    on public.project_info_cards for select
    using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

-- Insert/Update/Delete: admin/editor OR the author themselves.
do $$ begin
  create policy "admin/editor or author manages info cards"
    on public.project_info_cards for all
    using (
      author_id = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'editor'))
    )
    with check (
      author_id = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'editor'))
    );
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.project_info_cards to authenticated;
grant select, insert, update, delete on public.project_info_cards to service_role;

notify pgrst, 'reload schema';
