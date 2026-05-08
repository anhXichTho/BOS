-- ── Migration: DM channels must be private ───────────────────────────────────
-- get_or_create_dm_channel did not set is_private = true on INSERT, so all
-- existing DM channels have is_private = false.  The RLS policy
-- "Public + members can view channels" grants SELECT to everyone when
-- is_private = false, exposing DM content to all authenticated users.
--
-- Fix:
--   1. Backfill existing DM channels → is_private = true
--   2. Replace get_or_create_dm_channel to always create with is_private = true
--
-- Run this ONCE in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Backfill: mark all existing DM channels as private
update public.chat_channels
set is_private = true
where channel_type = 'dm';

-- 2. Replace RPC so future DM channels are also private
create or replace function public.get_or_create_dm_channel(partner_id uuid)
returns public.chat_channels
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ch public.chat_channels;
begin
  -- Look for an existing DM channel between current user and partner (either direction)
  select * into ch
    from public.chat_channels
   where channel_type = 'dm'
     and (
       (owner_id = auth.uid() and dm_partner_id = partner_id)
       or (owner_id = partner_id and dm_partner_id = auth.uid())
     );

  if not found then
    insert into public.chat_channels
      (name, channel_type, owner_id, dm_partner_id, created_by, is_private)
    values
      ('DM', 'dm', auth.uid(), partner_id, auth.uid(), true)
    returning * into ch;
  end if;

  return ch;
end $$;

grant execute on function public.get_or_create_dm_channel(uuid) to authenticated;

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';
