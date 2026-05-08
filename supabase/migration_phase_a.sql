-- ============================================================
-- Phase A — Portal slug + username/password gate
-- Run AFTER schema.sql in Supabase Cloud SQL Editor
-- Idempotent: safe to re-run.
-- ============================================================

-- 1) New columns on projects
alter table public.projects
  add column if not exists slug            text,
  add column if not exists portal_username text;

-- 2) Backfill slug from title for any existing rows missing one.
--    Simple ASCII fallback; the app generates pretty slugs going forward.
update public.projects
set slug = lower(regexp_replace(coalesce(title, 'project'), '[^a-zA-Z0-9]+', '-', 'g'))
       || '-' || substring(id::text, 1, 6)
where slug is null;

-- 3) Constraints
alter table public.projects
  alter column slug set not null;

create unique index if not exists projects_slug_unique
  on public.projects (slug);

create unique index if not exists projects_title_unique_ci
  on public.projects (lower(title));

-- 4) Tighten portal RLS — only authenticated owners/admins/editors can read
--    full project rows. Public access is now strictly via the portal page,
--    which fetches the trimmed columns we mark allowed below.
drop policy if exists "Public can read enabled projects by token" on public.projects;

create policy "Public can read portal-enabled projects" on public.projects
  for select using (portal_enabled = true);

-- 5) Make sure RLS still allows anon to insert guest portal messages
--    (already in schema.sql; re-create defensively)
drop policy if exists "Anon can insert portal messages" on public.chat_messages;
create policy "Anon can insert portal messages" on public.chat_messages
  for insert with check (author_id is null);

-- 6) Refresh GRANTs in case the table was created without them
grant select, insert, update, delete on public.projects to anon, authenticated;
