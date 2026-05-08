-- migration_phase_reminders.sql
-- Bảng nhắc việc: owner + admin/editor có thể xem, chỉ owner mới được tạo/xoá.

create table if not exists public.reminders (
  id                   uuid primary key default gen_random_uuid(),
  recipient_id         uuid not null references public.profiles(id) on delete cascade,
  created_by           uuid not null references public.profiles(id) on delete cascade,
  title                text not null,
  fire_at              timestamptz not null,
  fired_at             timestamptz,
  source_message_id    uuid,
  source_context_type  text,
  source_context_id    uuid,
  created_at           timestamptz default now() not null
);

create index if not exists reminders_fire_at_idx on public.reminders (fire_at)
  where fired_at is null;

alter table public.reminders enable row level security;

do $$ begin
  create policy "Owner or admin sees reminders"
    on public.reminders for select
    using (
      recipient_id = auth.uid() or created_by = auth.uid()
      or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Users create own reminders"
    on public.reminders for insert
    with check (created_by = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Owner or admin updates reminders"
    on public.reminders for update
    using (
      created_by = auth.uid()
      or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Owner or admin deletes reminders"
    on public.reminders for delete
    using (
      created_by = auth.uid()
      or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
    );
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.reminders to authenticated;
grant select, insert, update, delete on public.reminders to service_role;

notify pgrst, 'reload schema';
