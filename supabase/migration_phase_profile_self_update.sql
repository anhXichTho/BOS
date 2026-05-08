-- ── Migration: profiles self-update ─────────────────────────────────────────
-- Allow authenticated users to update their own profile row so that
-- preferences (font, sidebar pin) can be persisted.
--
-- Safety: WITH CHECK ensures role cannot be changed by a non-admin
-- (the subquery reads the current committed role, so escalation is blocked).
--
-- Run this ONCE in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

do $$ begin
  create policy "Users can update own profile" on public.profiles
    for update
    using (id = auth.uid())
    with check (
      id = auth.uid()
      -- Prevent self-escalation: new role must equal the current committed role
      and role = (select role from public.profiles where id = auth.uid())
    );
exception when duplicate_object then null;
end $$;

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';
