-- migration_phase_ai_usage_log.sql
-- Tracks every call to the personal-bot edge function.
-- Run after migration_phase_helpers.sql (helper_panels must exist).

create table if not exists public.ai_usage_logs (
  id           uuid        primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  panel_id     uuid        references public.helper_panels(id) on delete set null,
  bot_name     text        not null default 'Bot',
  user_id      uuid        references public.profiles(id) on delete set null,
  context_type text,
  context_id   text,
  query        text        not null,
  reply        text        not null,
  model        text
);

alter table public.ai_usage_logs enable row level security;

-- Users see their own logs; admins and editors see all
create policy "owner or admin sees logs" on public.ai_usage_logs
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'editor')
    )
  );

grant select on public.ai_usage_logs to authenticated;
grant select, insert on public.ai_usage_logs to service_role;
