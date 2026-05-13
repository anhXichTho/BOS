-- migration_phase_project_members.sql
-- Adds per-project membership table — mirror of chat_channel_members (#28).
-- Lets owners + admin/editor invite specific users to a project, and lets the
-- @all mention picker fan-out to project members only (instead of all users).
--
-- Visibility is ADDITIVE: members + existing assigned_to + subordinates +
-- admin/editor can view. Doesn't break existing projects.

-- ── 1. Table ─────────────────────────────────────────────────────────────────

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member',  -- 'owner' | 'member'
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.project_members enable row level security;

grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, update, delete on public.project_members to service_role;

create index if not exists project_members_user_idx on public.project_members(user_id);

-- ── 2. SECURITY DEFINER helpers (avoid RLS recursion) ─────────────────────────

create or replace function public.auth_is_project_member(p_project_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;

create or replace function public.auth_is_project_manager(p_project_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (p.assigned_to = auth.uid() or p.created_by = auth.uid())
  ) or exists (
    select 1 from public.project_members
    where project_id = p_project_id
      and user_id = auth.uid()
      and role = 'owner'
  ) or exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'editor')
  );
$$;

grant execute on function public.auth_is_project_member(uuid) to authenticated;
grant execute on function public.auth_is_project_manager(uuid) to authenticated;

-- ── 3. RLS policies on project_members ──────────────────────────────────────

drop policy if exists "project_members select"  on public.project_members;
drop policy if exists "project_members manage"  on public.project_members;

create policy "project_members select"
  on public.project_members for select
  using (
    public.auth_is_project_member(project_id)
    or public.auth_is_project_manager(project_id)
  );

create policy "project_members manage"
  on public.project_members for all
  using (public.auth_is_project_manager(project_id))
  with check (public.auth_is_project_manager(project_id));

-- ── 4. Widen projects SELECT policy to include members ───────────────────────
--
-- The existing policy was: assigned_to = auth.uid() OR subordinates OR
-- admin/editor. We KEEP all those paths and ADD a membership path so existing
-- projects continue to work for their current owners.

drop policy if exists "Projects visible to assignee/subs/managers/members" on public.projects;

create policy "Projects visible to assignee/subs/managers/members"
  on public.projects for select
  using (
    assigned_to = auth.uid()
    or assigned_to in (select public.get_all_subordinates(auth.uid()))
    or created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'editor')
    )
    or public.auth_is_project_member(id)
  );

-- ── 5. add_project_member RPC ────────────────────────────────────────────────

create or replace function public.add_project_member(
  p_project_id uuid,
  p_user_id    uuid,
  p_role       text default 'member'
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.auth_is_project_manager(p_project_id) then
    raise exception 'Only the project owner/assignee or admin/editor can manage members'
      using errcode = '42501';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, p_user_id, coalesce(p_role, 'member'))
  on conflict (project_id, user_id) do update set role = excluded.role;
end;
$$;

grant execute on function public.add_project_member(uuid, uuid, text) to authenticated;

-- ── 6. Backfill: every project's assigned_to becomes an 'owner' member ───────

insert into public.project_members (project_id, user_id, role)
select id, assigned_to, 'owner'
from public.projects
where assigned_to is not null
on conflict (project_id, user_id) do update set role = 'owner';

-- ── 7. Tell PostgREST about the new table + RPCs ────────────────────────────

notify pgrst, 'reload schema';
