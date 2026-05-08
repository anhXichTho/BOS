-- ============================================================
-- BOS Project Manager — Full Database Schema
-- Run this in Supabase Cloud → SQL Editor (in order)
-- ============================================================

-- ─── Extensions ────────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── PHASE 1: Auth & Profiles ─────────────────────────────────────────────────

create table public.profiles (
  id         uuid references auth.users on delete cascade primary key,
  full_name  text not null,
  avatar_url text,
  role       text not null default 'user' check (role in ('admin', 'editor', 'user')),
  created_at timestamptz default now()
);

-- Organisational hierarchy (leader → member)
create table public.leader_members (
  id        uuid default uuid_generate_v4() primary key,
  leader_id uuid references public.profiles(id) on delete cascade,
  member_id uuid references public.profiles(id) on delete cascade,
  unique(leader_id, member_id)
);

-- Recursive helper: all subordinates of a leader
create or replace function public.get_all_subordinates(p_leader_id uuid)
returns setof uuid as $$
  with recursive subordinates as (
    select member_id from public.leader_members where leader_id = p_leader_id
    union
    select lm.member_id from public.leader_members lm
    inner join subordinates s on lm.leader_id = s.member_id
  )
  select member_id from subordinates;
$$ language sql security definer;

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RLS
alter table public.profiles      enable row level security;
alter table public.leader_members enable row level security;

create policy "Users can view all profiles" on public.profiles
  for select using (auth.uid() is not null);

create policy "Admin can manage profiles" on public.profiles
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin can manage leader_members" on public.leader_members
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ─── PHASE 2: Chat ────────────────────────────────────────────────────────────

create table public.chat_channels (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null,
  description text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz default now()
);

create table public.chat_messages (
  id                 uuid default uuid_generate_v4() primary key,
  context_type       text not null check (context_type in ('channel', 'project')),
  context_id         uuid not null,
  parent_id          uuid references public.chat_messages(id),
  author_id          uuid references public.profiles(id),
  message_type       text not null default 'text'
                     check (message_type in ('text', 'form_submission')),
  content            text,
  form_submission_id uuid,           -- FK added later after form_submissions table
  mentions           uuid[] default '{}',
  edited_at          timestamptz,
  created_at         timestamptz default now()
);

create table public.chat_attachments (
  id             uuid default uuid_generate_v4() primary key,
  message_id     uuid references public.chat_messages(id) on delete cascade,
  file_name      text not null,
  file_url       text not null,
  file_type      text,
  file_size      bigint,
  extracted_text text,
  uploaded_at    timestamptz default now()
);

create index on public.chat_messages (context_type, context_id, created_at desc);
create index on public.chat_messages (parent_id);
create index on public.chat_attachments (message_id);

alter table public.chat_channels  enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.chat_attachments enable row level security;

create policy "All users can view channels" on public.chat_channels
  for select using (auth.uid() is not null);

create policy "Admin/Editor can manage channels" on public.chat_channels
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
  );

create policy "All users can view messages" on public.chat_messages
  for select using (auth.uid() is not null);

create policy "Users can post messages" on public.chat_messages
  for insert with check (author_id = auth.uid());

create policy "Users can edit own messages" on public.chat_messages
  for update using (author_id = auth.uid());

create policy "All users can view attachments" on public.chat_attachments
  for select using (auth.uid() is not null);

create policy "Users can insert attachments" on public.chat_attachments
  for insert with check (auth.uid() is not null);

-- ─── PHASE 2b: Forms ──────────────────────────────────────────────────────────

create table public.form_templates (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null,
  description text,
  fields      jsonb not null default '[]',
  is_active   boolean default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table public.form_submissions (
  id                uuid default uuid_generate_v4() primary key,
  template_id       uuid references public.form_templates(id),
  template_name     text not null,
  template_snapshot jsonb not null,
  submitted_by      uuid references public.profiles(id),
  context_type      text check (context_type in ('channel', 'project', 'standalone')),
  context_id        uuid,
  data              jsonb not null,
  submitted_at      timestamptz default now()
);

-- Wire up FK from chat_messages
alter table public.chat_messages
  add constraint fk_form_submission
  foreign key (form_submission_id) references public.form_submissions(id);

create index on public.form_submissions (template_id, submitted_at desc);
create index on public.form_submissions (submitted_by);
create index on public.form_submissions (context_type, context_id);

alter table public.form_templates  enable row level security;
alter table public.form_submissions enable row level security;

create policy "All users view active templates" on public.form_templates
  for select using (auth.uid() is not null and is_active = true);

create policy "Admin/Editor/Leader manage templates" on public.form_templates
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
    or exists (select 1 from public.leader_members where leader_id = auth.uid())
  );

create policy "View submissions by role" on public.form_submissions
  for select using (
    submitted_by = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
    or submitted_by in (select public.get_all_subordinates(auth.uid()))
  );

create policy "Users can submit forms" on public.form_submissions
  for insert with check (submitted_by = auth.uid());

-- Allow anon insert for portal guest messages
create policy "Anon can insert portal messages" on public.chat_messages
  for insert with check (author_id is null);

-- ─── PHASE 3: Projects ────────────────────────────────────────────────────────

create table public.projects (
  id                  uuid default uuid_generate_v4() primary key,
  title               text not null,
  slug                text not null,
  description         text,
  status              text not null default 'open'
                      check (status in ('open', 'in_progress', 'review', 'completed', 'cancelled')),
  assigned_to         uuid references public.profiles(id),
  due_date            date,
  public_token        text unique default encode(gen_random_bytes(16), 'hex'),
  portal_username     text,
  portal_password_hash text,
  portal_enabled      boolean default false,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index on public.projects (assigned_to);
create index on public.projects (public_token);
create unique index projects_slug_unique on public.projects (slug);
create unique index projects_title_unique_ci on public.projects (lower(title));

alter table public.projects enable row level security;

create policy "Access own and subordinate projects" on public.projects
  for select using (
    assigned_to = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
    or assigned_to in (select public.get_all_subordinates(auth.uid()))
  );

create policy "Admin/Editor can manage projects" on public.projects
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
  );

-- Public portal access (anon key, no auth)
create policy "Public can read enabled projects by token" on public.projects
  for select using (portal_enabled = true);

-- ─── PHASE 4: Workflow ────────────────────────────────────────────────────────

create table public.workflow_templates (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null,
  description text,
  is_active   boolean default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table public.workflow_steps (
  id               uuid default uuid_generate_v4() primary key,
  template_id      uuid references public.workflow_templates(id) on delete cascade,
  parent_step_id   uuid references public.workflow_steps(id),
  branch_condition text,
  title            text not null,
  description      text,
  step_type        text not null default 'simple'
                   check (step_type in ('simple', 'branch')),
  branch_options   text[],
  order_index      integer not null default 0,
  created_at       timestamptz default now()
);

create table public.workflow_runs (
  id            uuid default uuid_generate_v4() primary key,
  template_id   uuid references public.workflow_templates(id),
  template_name text not null,
  project_id    uuid references public.projects(id),
  run_by        uuid references public.profiles(id),
  status        text not null default 'in_progress'
                check (status in ('in_progress', 'completed', 'cancelled')),
  started_at    timestamptz default now(),
  completed_at  timestamptz
);

create table public.workflow_step_results (
  id              uuid default uuid_generate_v4() primary key,
  run_id          uuid references public.workflow_runs(id) on delete cascade,
  step_id         uuid references public.workflow_steps(id),
  is_done         boolean default false,
  branch_selected text,
  note            text,
  done_at         timestamptz
);

create index on public.workflow_runs (run_by, status);
create index on public.workflow_runs (project_id);
create index on public.workflow_step_results (run_id);

alter table public.workflow_templates     enable row level security;
alter table public.workflow_steps         enable row level security;
alter table public.workflow_runs          enable row level security;
alter table public.workflow_step_results  enable row level security;

create policy "All can view templates" on public.workflow_templates
  for select using (auth.uid() is not null);

create policy "Admin/Editor manage templates" on public.workflow_templates
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
  );

create policy "All can view steps" on public.workflow_steps
  for select using (auth.uid() is not null);

create policy "Admin/Editor manage steps" on public.workflow_steps
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
  );

create policy "View own and subordinate runs" on public.workflow_runs
  for select using (
    run_by = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
    or run_by in (select public.get_all_subordinates(auth.uid()))
  );

create policy "Users can create and update own runs" on public.workflow_runs
  for all using (run_by = auth.uid());

create policy "View step results of own runs" on public.workflow_step_results
  for select using (
    exists (select 1 from public.workflow_runs where id = run_id and run_by = auth.uid())
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'editor'))
  );

create policy "Users can manage own step results" on public.workflow_step_results
  for all using (
    exists (select 1 from public.workflow_runs where id = run_id and run_by = auth.uid())
  );

-- ─── PHASE 5: Portal — enable public read for workflow_runs ───────────────────

create policy "Public can read project runs via portal" on public.workflow_runs
  for select using (
    project_id in (select id from public.projects where portal_enabled = true)
  );

create policy "Public can read portal messages" on public.chat_messages
  for select using (
    context_id in (select id from public.projects where portal_enabled = true)
    or auth.uid() is not null
  );

-- ─── PHASE 6: Additional indexes ─────────────────────────────────────────────

-- (Already created above inline, but listed here for reference)
-- create index on public.workflow_runs (run_by, status);
-- create index on public.workflow_runs (project_id);
-- create index on public.chat_messages (context_type, context_id, created_at desc);
-- create index on public.projects (assigned_to);
-- create index on public.projects (public_token);
