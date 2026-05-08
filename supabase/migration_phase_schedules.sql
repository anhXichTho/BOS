-- ============================================================
-- Phase 6: Workflow Scheduling
-- pg_cron-driven schedule runner with audit history.
-- Run AFTER previous migrations. Idempotent.
-- ============================================================

-- 1) workflow_schedules — recurring or one-shot schedules.
create table if not exists public.workflow_schedules (
  id          uuid default uuid_generate_v4() primary key,
  template_id uuid references public.workflow_templates(id) on delete cascade,
  project_id  uuid references public.projects(id),
  run_by      uuid references public.profiles(id),
  name        text,                        -- optional human label
  routine     jsonb not null,
  /* routine examples:
     {"kind":"daily","at":"09:00","tz":"Asia/Ho_Chi_Minh"}
     {"kind":"weekly","at":"09:00","day_of_week":1,"tz":"Asia/Ho_Chi_Minh"}
       // day_of_week: 0=Sunday, 1=Monday, … 6=Saturday
     {"kind":"monthly","at":"09:00","day_of_month":1,"tz":"Asia/Ho_Chi_Minh"}
     {"kind":"once","at":"2026-05-15T09:00:00+07:00"}
  */
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  enabled     boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists workflow_schedules_due_idx
  on public.workflow_schedules (next_run_at) where enabled = true;
create index if not exists workflow_schedules_template_idx
  on public.workflow_schedules (template_id);

-- 2) Audit history — every cron tick that fired.
create table if not exists public.schedule_runs_history (
  id            uuid default uuid_generate_v4() primary key,
  schedule_id   uuid references public.workflow_schedules(id) on delete cascade,
  fired_at      timestamptz default now(),
  run_id        uuid references public.workflow_runs(id) on delete set null,
  status        text not null check (status in ('success','error','skipped')),
  error_message text
);

create index if not exists schedule_runs_history_schedule_idx
  on public.schedule_runs_history (schedule_id, fired_at desc);

-- 3) compute_next_run — given a routine and "now", return the next firing time.
--    Conservative: if routine kind unknown or once+past, returns null.
create or replace function public.compute_next_run(p_routine jsonb, p_from timestamptz)
returns timestamptz as $$
declare
  v_kind  text  := p_routine->>'kind';
  v_at    text  := p_routine->>'at';                          -- "09:00" or ISO
  v_tz    text  := coalesce(p_routine->>'tz', 'UTC');
  v_dow   int   := (p_routine->>'day_of_week')::int;          -- 0..6
  v_dom   int   := (p_routine->>'day_of_month')::int;         -- 1..31
  v_h     int;
  v_m     int;
  v_local timestamptz;
  v_today date;
  v_target timestamptz;
begin
  if v_kind = 'once' then
    v_target := v_at::timestamptz;
    if v_target > p_from then return v_target; end if;
    return null;
  end if;

  -- Parse "HH:MM"
  v_h := split_part(v_at, ':', 1)::int;
  v_m := split_part(v_at, ':', 2)::int;
  v_local := (p_from at time zone v_tz);
  v_today := v_local::date;

  if v_kind = 'daily' then
    v_target := ((v_today + interval '0 day') + make_interval(hours => v_h, mins => v_m))
                at time zone v_tz;
    if v_target <= p_from then
      v_target := ((v_today + interval '1 day') + make_interval(hours => v_h, mins => v_m))
                  at time zone v_tz;
    end if;
    return v_target;
  end if;

  if v_kind = 'weekly' then
    -- find the next date with extract(dow) = v_dow
    declare
      v_d date := v_today;
      v_i int := 0;
    begin
      while extract(dow from v_d) <> v_dow loop
        v_d := v_d + 1;
        v_i := v_i + 1;
        if v_i > 7 then exit; end if;
      end loop;
      v_target := (v_d + make_interval(hours => v_h, mins => v_m)) at time zone v_tz;
      if v_target <= p_from then
        v_target := v_target + interval '7 days';
      end if;
      return v_target;
    end;
  end if;

  if v_kind = 'monthly' then
    declare
      v_y int := extract(year from v_today)::int;
      v_mo int := extract(month from v_today)::int;
      v_d date;
    begin
      -- candidate this month
      v_d := make_date(v_y, v_mo, least(v_dom, 28));
      v_target := (v_d + make_interval(hours => v_h, mins => v_m)) at time zone v_tz;
      if v_target <= p_from then
        -- next month
        v_mo := v_mo + 1;
        if v_mo > 12 then v_mo := 1; v_y := v_y + 1; end if;
        v_d := make_date(v_y, v_mo, least(v_dom, 28));
        v_target := (v_d + make_interval(hours => v_h, mins => v_m)) at time zone v_tz;
      end if;
      return v_target;
    end;
  end if;

  return null;
end;
$$ language plpgsql stable security definer;

-- 4) run_due_schedules — called by pg_cron every minute. Materialises due
--    schedules into workflow_runs + workflow_run_steps + schedule_runs_history.
create or replace function public.run_due_schedules()
returns integer as $$
declare
  s record;
  v_template record;
  v_run_id uuid;
  v_count integer := 0;
  v_next timestamptz;
begin
  for s in
    select * from public.workflow_schedules
    where enabled = true and next_run_at <= now()
    limit 50    -- batch cap to keep tick under 1s
  loop
    begin
      select id, name into v_template
        from public.workflow_templates
       where id = s.template_id;

      if v_template.id is null then
        insert into public.schedule_runs_history (schedule_id, status, error_message)
        values (s.id, 'error', 'Template missing');
        update public.workflow_schedules set enabled = false, last_run_at = now() where id = s.id;
        continue;
      end if;

      -- Create the run
      insert into public.workflow_runs (template_id, template_name, project_id, run_by)
      values (v_template.id, v_template.name, s.project_id, s.run_by)
      returning id into v_run_id;

      -- Snapshot the step tree (mirrors the manual StartRunModal flow)
      perform public.snapshot_workflow_run(v_run_id);

      -- Notify the runner
      insert into public.notifications (user_id, kind, title, body, link, payload)
      values (
        s.run_by,
        'schedule_fired',
        'Workflow theo lịch đã được tạo',
        v_template.name,
        '/workflows/runs/' || v_run_id,
        jsonb_build_object('schedule_id', s.id, 'run_id', v_run_id)
      );

      -- Audit
      insert into public.schedule_runs_history (schedule_id, run_id, status)
      values (s.id, v_run_id, 'success');

      -- Compute next firing
      v_next := public.compute_next_run(s.routine, now());

      if (s.routine->>'kind') = 'once' or v_next is null then
        update public.workflow_schedules
           set last_run_at = now(),
               enabled = false,
               next_run_at = coalesce(v_next, now()),
               updated_at = now()
         where id = s.id;
      else
        update public.workflow_schedules
           set last_run_at = now(),
               next_run_at = v_next,
               updated_at = now()
         where id = s.id;
      end if;

      v_count := v_count + 1;
    exception when others then
      insert into public.schedule_runs_history (schedule_id, status, error_message)
      values (s.id, 'error', SQLERRM);
      -- bump next_run_at by 5 minutes to avoid hot-loop on persistent errors
      update public.workflow_schedules
         set next_run_at = greatest(next_run_at, now() + interval '5 minutes'),
             updated_at = now()
       where id = s.id;
    end;
  end loop;

  return v_count;
end;
$$ language plpgsql security definer;

-- 5) RLS
alter table public.workflow_schedules    enable row level security;
alter table public.schedule_runs_history enable row level security;

drop policy if exists "View own schedules + admin/editor" on public.workflow_schedules;
create policy "View own schedules + admin/editor" on public.workflow_schedules
  for select using (
    run_by = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
  );

drop policy if exists "Manage own schedules + admin/editor" on public.workflow_schedules;
create policy "Manage own schedules + admin/editor" on public.workflow_schedules
  for all using (
    run_by = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
  );

drop policy if exists "View schedule history via schedule access" on public.schedule_runs_history;
create policy "View schedule history via schedule access" on public.schedule_runs_history
  for select using (
    exists (
      select 1 from public.workflow_schedules s
      where s.id = schedule_runs_history.schedule_id
        and (
          s.run_by = auth.uid()
          or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','editor'))
        )
    )
  );

grant select, insert, update, delete on public.workflow_schedules    to anon, authenticated;
grant select on public.schedule_runs_history to anon, authenticated;

-- 6) pg_cron — run every minute.
create extension if not exists pg_cron;

-- Drop any previous instance with the same name before re-scheduling.
do $$
begin
  perform cron.unschedule('run_due_schedules');
exception when others then
  -- not previously scheduled; fine.
  null;
end $$;

select cron.schedule('run_due_schedules', '* * * * *', $$select public.run_due_schedules();$$);
