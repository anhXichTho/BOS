-- migration_phase_push_subscriptions.sql
-- PWA push notification subscriptions + DB trigger to fan-out pushes.
-- Run in Supabase SQL Editor. Idempotent.
--
-- ── Prerequisites (per project, run ONCE) ────────────────────────────────────
--
--   1. Enable the pg_net extension:
--      Dashboard → Database → Extensions → "pg_net" → Enable
--
--   2. Store project-specific secrets in Supabase Vault (never hardcoded):
--      select vault.create_secret(
--        'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-push',
--        'push_edge_url'
--      );
--      select vault.create_secret(
--        'eyJ...YOUR_SERVICE_ROLE_KEY...',
--        'push_service_key'
--      );
--
--   3. Deploy the send-push Edge Function (supabase/functions/send-push/index.ts).
--
--   4. Set VAPID secrets in Dashboard → Project Settings → Edge Functions → Secrets:
--        VAPID_PUBLIC_KEY=...
--        VAPID_PRIVATE_KEY=...
--        VAPID_SUBJECT=mailto:your@email.com
--
--   5. Add VITE_VAPID_PUBLIC_KEY=... to .env and Vercel env vars.
--
-- This file is identical for every client project — only the vault.create_secret
-- values above differ per instance.

-- ── 1. push_subscriptions table ───────────────────────────────────────────────

create table if not exists public.push_subscriptions (
  id         uuid        default gen_random_uuid() primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  endpoint   text        not null,
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

do $$ begin
  create policy "owner manages push subscriptions"
    on public.push_subscriptions for all
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- ── 2. fan_out_push() trigger function ────────────────────────────────────────
--    Reads edge URL + service key from Vault (set per-project in prerequisites).
--    pg_net call is async — never blocks the notifications INSERT.

create or replace function public.fan_out_push()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  edge_url text;
  svc_key  text;
  nav_url  text;
begin
  -- Read per-project secrets from Vault (set once via vault.create_secret above)
  select decrypted_secret into edge_url
    from vault.decrypted_secrets where name = 'push_edge_url' limit 1;
  select decrypted_secret into svc_key
    from vault.decrypted_secrets where name = 'push_service_key' limit 1;

  -- If secrets not configured yet, skip silently — never fail the INSERT
  if edge_url is null or svc_key is null then return new; end if;

  nav_url := case new.kind
    when 'mention'            then '/chat'
    when 'approval_requested' then '/workflows'
    when 'project_assigned'   then '/projects'
    when 'workflow_assigned'  then '/workflows'
    when 'workflow_completed' then '/workflows'
    else '/'
  end;

  perform net.http_post(
    url     := edge_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || svc_key
    ),
    body    := jsonb_build_object(
      'user_id', new.user_id,
      'title',   new.title,
      'body',    coalesce(new.body, ''),
      'url',     nav_url,
      'tag',     new.kind
    )
  );

  return new;
exception when others then
  return new; -- pg_net unavailable or any error — never block notification row
end;
$$;

-- ── 3. Attach trigger ─────────────────────────────────────────────────────────

drop trigger if exists trg_fan_out_push on public.notifications;
create trigger trg_fan_out_push
  after insert on public.notifications
  for each row execute function public.fan_out_push();
