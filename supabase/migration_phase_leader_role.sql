-- migration_phase_leader_role.sql
-- Adds a new "leader" role. Semantics:
--   • Can CREATE channels and projects
--   • Can MANAGE (update / delete / member-CRUD) only resources they own
--   • Sees only what they own + are member of (NO blanket SELECT bypass)
--   • Role rank: admin > editor > leader > user
--
-- Existing helper `auth_is_admin_or_editor()` is left untouched; we add a new
-- helper `auth_can_create_resources()` that returns true for admin/editor/leader.
-- For SELECT (read), leader uses the exact same paths regular users do
-- (owner/member/portal-anon). So no leak.

-- ─── 1. Allow 'leader' in profiles.role check ────────────────────────────────
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'editor', 'leader', 'user'));

-- ─── 2. Helper: can the caller create channels/projects? ─────────────────────
create or replace function public.auth_can_create_resources()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'editor', 'leader')
  );
$$;

grant execute on function public.auth_can_create_resources() to authenticated;

-- ─── 3. chat_channels: INSERT for admin/editor/leader ───────────────────────
drop policy if exists "Admin/Editor can insert team channels" on public.chat_channels;

create policy "Manage-role can insert team channels"
  on public.chat_channels for insert
  with check (
    channel_type <> 'dm'
    and public.auth_can_create_resources() = true
  );

-- ─── 4. chat_channels: UPDATE for admin/editor OR channel owner ─────────────
drop policy if exists "Admin/Editor can update team channels" on public.chat_channels;

create policy "Owner or admin/editor can update team channels"
  on public.chat_channels for update
  using (
    channel_type <> 'dm'
    and (
      public.auth_is_admin_or_editor() = true
      or owner_id   = auth.uid()
      or created_by = auth.uid()
    )
  )
  with check (
    channel_type <> 'dm'
    and (
      public.auth_is_admin_or_editor() = true
      or owner_id   = auth.uid()
      or created_by = auth.uid()
    )
  );

-- ─── 5. chat_channels: DELETE for admin/editor OR channel owner ─────────────
drop policy if exists "Admin/Editor can delete team channels" on public.chat_channels;

create policy "Owner or admin/editor can delete team channels"
  on public.chat_channels for delete
  using (
    channel_type <> 'dm'
    and (
      public.auth_is_admin_or_editor() = true
      or owner_id   = auth.uid()
      or created_by = auth.uid()
    )
  );

-- ─── 6. projects: split the legacy "Admin/Editor can manage projects" ALL ───
-- The old policy was `for all (admin or editor)` — covered INSERT/UPDATE/DELETE/SELECT.
-- We replace it with cmd-specific policies that also let leaders create + manage own.
drop policy if exists "Admin/Editor can manage projects" on public.projects;

create policy "Manage-role can insert projects"
  on public.projects for insert
  with check (public.auth_can_create_resources() = true);

create policy "Owner or admin/editor can update projects"
  on public.projects for update
  using (
    public.auth_is_admin_or_editor() = true
    or created_by  = auth.uid()
    or assigned_to = auth.uid()
  )
  with check (
    public.auth_is_admin_or_editor() = true
    or created_by  = auth.uid()
    or assigned_to = auth.uid()
  );

create policy "Owner or admin/editor can delete projects"
  on public.projects for delete
  using (
    public.auth_is_admin_or_editor() = true
    or created_by = auth.uid()
  );

-- ─── 7. project_members: extend auth_is_project_manager to include leader ────
-- Re-create the function so leader-as-creator can manage project_members.
-- (Existing definition already covered created_by/assigned_to/owner — and admin/editor.
--  Leader naturally inherits the created_by/assigned_to branch.)
-- No code change needed; documenting for clarity.

notify pgrst, 'reload schema';
