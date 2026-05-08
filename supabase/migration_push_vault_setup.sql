-- ── Migration: Push notification vault setup + get_vapid_keys() RPC ──────────
-- Run ONCE in Supabase SQL Editor per project instance.
--
-- Sets up:
--   1. Vault secrets used by the fan_out_push trigger
--   2. get_vapid_keys() SECURITY DEFINER RPC used by the send-push Edge Function
--
-- The fan_out_push trigger reads two vault secrets:
--   push_edge_url    — URL of the send-push Edge Function
--   push_service_key — service_role key to authenticate the function call
--
-- The send-push Edge Function reads three vault secrets via get_vapid_keys():
--   vapid_public_key   — set in Supabase Dashboard → Edge Functions → Secrets
--   vapid_private_key  — (same)
--   vapid_subject      — (same, e.g. mailto:your@email.com)
--
-- If push_edge_url or push_service_key are missing the trigger silently skips.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Store per-project vault secrets ───────────────────────────────────────
-- Replace the placeholder values with your project's actual values
-- (found in Supabase Dashboard → Settings → API)

do $$
begin
  -- push_edge_url: URL of your deployed send-push Edge Function
  if not exists (select 1 from vault.decrypted_secrets where name = 'push_edge_url') then
    perform vault.create_secret(
      'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-push',
      'push_edge_url'
    );
    raise notice 'Created push_edge_url';
  else
    raise notice 'push_edge_url already exists (skip)';
  end if;

  -- push_service_key: service_role JWT from Dashboard → Settings → API → service_role key
  if not exists (select 1 from vault.decrypted_secrets where name = 'push_service_key') then
    perform vault.create_secret(
      'eyJ...YOUR_SERVICE_ROLE_KEY...',
      'push_service_key'
    );
    raise notice 'Created push_service_key';
  else
    raise notice 'push_service_key already exists (skip)';
  end if;
end $$;

-- ── 2. Verify vault secrets ───────────────────────────────────────────────────
select name, length(decrypted_secret) as secret_len, created_at
from vault.decrypted_secrets
where name in ('push_edge_url', 'push_service_key')
order by name;

-- ── 3. get_vapid_keys() SECURITY DEFINER function ───────────────────────────
-- The send-push Edge Function cannot read vault directly via PostgREST
-- (vault schema is not exposed). This SECURITY DEFINER function runs as the
-- function owner (postgres) and can access vault.decrypted_secrets, bridging
-- the gap. It is ONLY callable by service_role (the Edge Function's role).
--
-- Note: VAPID keys themselves are stored as Edge Function Secrets in the
-- Supabase Dashboard (not in vault). This function reads them from vault
-- only if they were stored there via vault.create_secret(). The send-push
-- function falls back to the Edge Function Secrets env vars if this RPC
-- returns null values, so storing VAPID keys in vault is optional.

create or replace function public.get_vapid_keys()
returns jsonb
language sql
security definer
stable
set search_path = public, vault, pg_temp
as $$
  select coalesce(
    (
      select jsonb_object_agg(name, decrypted_secret)
      from vault.decrypted_secrets
      where name in ('vapid_public_key', 'vapid_private_key', 'vapid_subject')
    ),
    '{}'::jsonb
  );
$$;

-- Restrict: only service_role can call this (Edge Function uses service_role key)
revoke execute on function public.get_vapid_keys() from public;
revoke execute on function public.get_vapid_keys() from anon;
revoke execute on function public.get_vapid_keys() from authenticated;
grant execute on function public.get_vapid_keys() to service_role;

-- ── 4. Smoke test ─────────────────────────────────────────────────────────────
-- After running steps 1-3, test end-to-end (replace <your-user-id>):
--
-- insert into public.notifications (user_id, kind, title, body)
-- values ('<your-user-id>', 'mention', 'Test push', 'Thông báo Windows native test');
--
-- Then check the pg_net outbound request:
-- select id, status_code, error_msg, created
-- from net._http_response
-- order by created desc limit 5;
--
-- And check Edge Function logs:
-- Dashboard → Edge Functions → send-push → Logs
-- Look for: [send-push] sent=1 user=...
