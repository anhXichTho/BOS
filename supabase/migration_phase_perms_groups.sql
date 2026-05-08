-- ============================================================
-- Phase: Permissions unification + User Groups + User Preferences
-- Run AFTER previous migrations. Idempotent.
-- ============================================================

-- 1) Per-user preferences (sidebar pin, notification mute, theme, …)
alter table public.profiles
  add column if not exists preferences jsonb not null default '{}';

-- 2) User groups (tag-based ACL, independent of role)
create table if not exists public.user_groups (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null unique,
  description text,
  color       text,                                          -- e.g. '#3d559a'
  created_by  uuid references public.profiles(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists public.user_group_members (
  group_id  uuid references public.user_groups(id) on delete cascade,
  user_id   uuid references public.profiles(id)    on delete cascade,
  added_at  timestamptz default now(),
  primary key (group_id, user_id)
);

create index if not exists user_group_members_user_idx on public.user_group_members (user_id);

-- 3) Polymorphic resource ↔ group access list
--    Any resource (project / workflow_template / document / helper_panel)
--    that a group is attached to is visible/editable to that group's members.
create table if not exists public.resource_group_acl (
  resource_type text not null check (resource_type in (
    'project','workflow_template','form_template','document','helper_panel'
  )),
  resource_id   uuid not null,
  group_id      uuid references public.user_groups(id) on delete cascade,
  primary key (resource_type, resource_id, group_id)
);

create index if not exists resource_group_acl_resource_idx on public.resource_group_acl (resource_type, resource_id);
create index if not exists resource_group_acl_group_idx    on public.resource_group_acl (group_id);

-- 4) Helper: list a user's group ids — usable inside RLS policies.
create or replace function public.user_group_ids(p_user uuid)
returns setof uuid as $$
  select group_id from public.user_group_members where user_id = p_user;
$$ language sql stable security definer;

-- 5) Centralised permission check.
--    Used by future RLS policies. Returns true if the user has access to
--    the given resource via role, ownership, leader-member hierarchy, or group ACL.
create or replace function public.can(
  p_user        uuid,
  p_action      text,                  -- 'view' | 'edit' | 'manage'
  p_resource_type text,                -- 'project' | 'workflow_template' | 'document' | 'helper_panel' | 'form_template'
  p_resource_id uuid
) returns boolean as $$
declare
  v_role text;
begin
  if p_user is null then return false; end if;

  select role into v_role from public.profiles where id = p_user;
  -- Admin/Editor can do anything (Editor cannot delete admin actions but
  -- that's a separate concern; for now treat them as full-access).
  if v_role in ('admin','editor') then return true; end if;

  -- Anyone in a group attached to the resource has at least 'view' + 'edit'.
  if exists (
    select 1
      from public.resource_group_acl acl
      join public.user_group_members m on m.group_id = acl.group_id
     where acl.resource_type = p_resource_type
       and acl.resource_id   = p_resource_id
       and m.user_id         = p_user
  ) then
    return true;
  end if;

  -- Project: assignee or subordinates of leader = view+edit
  if p_resource_type = 'project' then
    if exists (
      select 1 from public.projects
       where id = p_resource_id
         and (
           assigned_to = p_user
           or assigned_to in (select public.get_all_subordinates(p_user))
         )
    ) then return true; end if;
  end if;

  return false;
end;
$$ language plpgsql stable security definer;

-- 6) RLS
alter table public.user_groups        enable row level security;
alter table public.user_group_members enable row level security;
alter table public.resource_group_acl enable row level security;

drop policy if exists "All can view groups" on public.user_groups;
create policy "All can view groups" on public.user_groups
  for select using (auth.uid() is not null);

drop policy if exists "Admin/Editor manage groups" on public.user_groups;
create policy "Admin/Editor manage groups" on public.user_groups
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
  );

drop policy if exists "All can view group members" on public.user_group_members;
create policy "All can view group members" on public.user_group_members
  for select using (auth.uid() is not null);

drop policy if exists "Admin/Editor manage group members" on public.user_group_members;
create policy "Admin/Editor manage group members" on public.user_group_members
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
  );

drop policy if exists "All can view ACL" on public.resource_group_acl;
create policy "All can view ACL" on public.resource_group_acl
  for select using (auth.uid() is not null);

drop policy if exists "Admin/Editor manage ACL" on public.resource_group_acl;
create policy "Admin/Editor manage ACL" on public.resource_group_acl
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
  );

-- 7) Grants
grant select, insert, update, delete on public.user_groups        to anon, authenticated;
grant select, insert, update, delete on public.user_group_members to anon, authenticated;
grant select, insert, update, delete on public.resource_group_acl to anon, authenticated;

-- 8) Extend project SELECT policy: anyone in an attached group can see the project.
drop policy if exists "Group members view projects" on public.projects;
create policy "Group members view projects" on public.projects
  for select using (
    exists (
      select 1 from public.resource_group_acl acl
      where acl.resource_type = 'project'
        and acl.resource_id   = projects.id
        and acl.group_id in (select public.user_group_ids(auth.uid()))
    )
  );
