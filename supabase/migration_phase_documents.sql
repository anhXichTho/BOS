-- ============================================================
-- Phase: Document Library
-- Standalone documents (folders + tags + optional project link).
-- Run AFTER previous migrations. Idempotent.
-- ============================================================

-- 1) documents table
create table if not exists public.documents (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null,
  description text,
  file_url    text not null,
  file_name   text not null,
  file_type   text,
  file_size   bigint,
  folder_path text not null default '/',
  tags        text[] not null default '{}',
  project_id  uuid references public.projects(id) on delete set null,
  uploaded_by uuid references public.profiles(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists documents_folder_idx  on public.documents (folder_path);
create index if not exists documents_tags_idx    on public.documents using gin (tags);
create index if not exists documents_project_idx on public.documents (project_id);
create index if not exists documents_fts_idx     on public.documents
  using gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(file_name,'')));

-- 2) RLS
alter table public.documents enable row level security;

drop policy if exists "All can view documents" on public.documents;
create policy "All can view documents" on public.documents
  for select using (auth.uid() is not null);

drop policy if exists "Uploader/Admin/Editor manage documents" on public.documents;
create policy "Uploader/Admin/Editor manage documents" on public.documents
  for all using (
    uploaded_by = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
  );

grant select, insert, update, delete on public.documents to anon, authenticated;

-- 3) Storage bucket — public (read), authenticated (write).
--    Idempotent: ON CONFLICT in case bucket already exists.
insert into storage.buckets (id, name, public)
  values ('documents', 'documents', true)
  on conflict (id) do nothing;

-- 4) Storage policies for the documents bucket
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Authenticated upload to documents'
  ) then
    create policy "Authenticated upload to documents"
      on storage.objects for insert
      with check (bucket_id = 'documents' and auth.uid() is not null);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Public read documents'
  ) then
    create policy "Public read documents"
      on storage.objects for select
      using (bucket_id = 'documents');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Authenticated delete documents'
  ) then
    create policy "Authenticated delete documents"
      on storage.objects for delete
      using (bucket_id = 'documents' and auth.uid() is not null);
  end if;
end $$;
