-- migration_phase_document_nodes.sql
-- Round-10. New "Document" hub: file-explorer-style folder tree + note leaves.
--
-- Schema:
--   document_nodes — tree (folder | note). Notes carry content_html.
--   document_shares — per-user ACL on a node (viewer | editor).
--
-- Permission model:
--   - Default: creator-only.
--   - visibility = 'public' → everyone can read.
--   - visibility = 'shared' AND a row in document_shares matches → that user can read/edit per role.
--   - Folder share cascades to descendants UNLESS the descendant has its own
--     document_shares row (override).
--
-- Idempotent — safe to re-run.

create table if not exists public.document_nodes (
  id           uuid default uuid_generate_v4() primary key,
  parent_id    uuid references public.document_nodes(id) on delete cascade,
  type         text not null check (type in ('folder', 'note')),
  name         text not null,
  slug         text not null,
  content_html text,                                 -- only for type='note'
  created_by   uuid references public.profiles(id),
  visibility   text not null default 'private'
                  check (visibility in ('private', 'shared', 'public')),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- A slug must be unique among siblings (same parent, or both null).
create unique index if not exists uniq_doc_slug_per_parent
  on public.document_nodes (coalesce(parent_id::text, ''), slug);

create index if not exists idx_doc_nodes_parent  on public.document_nodes (parent_id);
create index if not exists idx_doc_nodes_creator on public.document_nodes (created_by);

create table if not exists public.document_shares (
  document_id uuid not null references public.document_nodes(id) on delete cascade,
  user_id     uuid not null references public.profiles(id)        on delete cascade,
  role        text not null default 'viewer' check (role in ('viewer', 'editor')),
  granted_at  timestamptz default now(),
  primary key (document_id, user_id)
);

create index if not exists idx_doc_shares_user on public.document_shares (user_id);

-- ─── Visibility helper (security definer) ────────────────────────────────────
-- Walks up the parent chain and returns the highest-resolved share role for
-- (caller, node). Returns null if no access.
create or replace function public.doc_node_role_for(p_node_id uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := auth.uid();
  cur    uuid := p_node_id;
  vis    text;
  cby    uuid;
  pid    uuid;
  shared text;
  role_admin text;
begin
  if uid is null then return null; end if;

  -- admin/editor see everything
  select role into role_admin from public.profiles where id = uid;
  if role_admin in ('admin', 'editor') then return 'editor'; end if;

  while cur is not null loop
    select visibility, created_by, parent_id into vis, cby, pid
      from public.document_nodes where id = cur;
    if not found then return null; end if;
    if cby = uid                  then return 'editor'; end if;     -- creator
    if vis = 'public'             then return 'viewer'; end if;
    if vis = 'shared' then
      select role into shared from public.document_shares
        where document_id = cur and user_id = uid;
      if shared is not null then return shared; end if;
    end if;
    cur := pid;                                                     -- climb to parent
  end loop;
  return null;
end;
$$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.document_nodes  enable row level security;
alter table public.document_shares enable row level security;

drop policy if exists "doc_nodes view"   on public.document_nodes;
drop policy if exists "doc_nodes insert" on public.document_nodes;
drop policy if exists "doc_nodes update" on public.document_nodes;
drop policy if exists "doc_nodes delete" on public.document_nodes;

create policy "doc_nodes view" on public.document_nodes for select
  using (public.doc_node_role_for(id) is not null);

create policy "doc_nodes insert" on public.document_nodes for insert
  with check (created_by = auth.uid());

create policy "doc_nodes update" on public.document_nodes for update
  using (public.doc_node_role_for(id) = 'editor')
  with check (public.doc_node_role_for(id) = 'editor');

create policy "doc_nodes delete" on public.document_nodes for delete
  using (
    created_by = auth.uid()
    or exists (select 1 from public.profiles
                where id = auth.uid() and role in ('admin', 'editor'))
  );

drop policy if exists "doc_shares view"   on public.document_shares;
drop policy if exists "doc_shares manage" on public.document_shares;

create policy "doc_shares view" on public.document_shares for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.document_nodes dn
      where dn.id = document_id and dn.created_by = auth.uid()
    )
    or exists (select 1 from public.profiles
                where id = auth.uid() and role in ('admin','editor'))
  );

create policy "doc_shares manage" on public.document_shares for all
  using (
    exists (
      select 1 from public.document_nodes dn
      where dn.id = document_id and dn.created_by = auth.uid()
    )
    or exists (select 1 from public.profiles
                where id = auth.uid() and role in ('admin','editor'))
  )
  with check (
    exists (
      select 1 from public.document_nodes dn
      where dn.id = document_id and dn.created_by = auth.uid()
    )
    or exists (select 1 from public.profiles
                where id = auth.uid() and role in ('admin','editor'))
  );

grant select, insert, update, delete on public.document_nodes  to authenticated;
grant select, insert, update, delete on public.document_shares to authenticated;
grant select, insert, update, delete on public.document_nodes  to service_role;
grant select, insert, update, delete on public.document_shares to service_role;

notify pgrst, 'reload schema';
