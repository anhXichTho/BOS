-- migration_phase_editor_manage_users.sql
-- Lets editor (in addition to admin) update other users' profiles — for
-- managing role / renaming people. Editors CANNOT promote anyone to admin
-- (gate enforced at WITH CHECK below + in the UI).

drop policy if exists "Admin can manage profiles" on public.profiles;

create policy "Admin or editor can manage profiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'editor')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'editor')
    )
    -- Editor cannot promote anyone to admin. Admin can do anything.
    and (
      role <> 'admin'
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
      )
    )
  );

notify pgrst, 'reload schema';
