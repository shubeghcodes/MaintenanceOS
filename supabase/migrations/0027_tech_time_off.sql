-- =====================================================================
-- MaintenanceOS — Tech days off
-- Run after 0026. Safe to re-run.
--
-- * tech_work_days: each tech's regular weekly days off (0 = Sunday … 6 = Saturday).
-- * tech_time_off: specific dates off (vacation, sick, personal, holiday, other), one day or a range.
-- * is_tech_off(tech, date) and pm_schedule_date(tech, due, today): the scheduler puts a PM work order
--   on the tech's nearest working day on or before the due date (not before today), otherwise the next
--   working day after it.
-- Admins manage both; techs can see them (the schedule is shared).
-- =====================================================================

create table if not exists public.tech_work_days (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  days_off   smallint[] not null default '{}' check (days_off <@ array[0,1,2,3,4,5,6]::smallint[]),
  updated_at timestamptz not null default now()
);

create table if not exists public.tech_time_off (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  kind        text not null default 'vacation' check (kind in ('vacation', 'sick', 'personal', 'holiday', 'other')),
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists tech_time_off_user_idx on public.tech_time_off(user_id, start_date, end_date);

alter table public.tech_work_days enable row level security;
alter table public.tech_time_off  enable row level security;

drop policy if exists twd_select on public.tech_work_days;
create policy twd_select on public.tech_work_days for select to authenticated using (public.my_role() in ('admin', 'tech'));
drop policy if exists twd_admin on public.tech_work_days;
create policy twd_admin on public.tech_work_days for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists tto_select on public.tech_time_off;
create policy tto_select on public.tech_time_off for select to authenticated using (public.my_role() in ('admin', 'tech'));
drop policy if exists tto_admin on public.tech_time_off;
create policy tto_admin on public.tech_time_off for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant all on public.tech_work_days, public.tech_time_off to authenticated, service_role;

create or replace function public.is_tech_off(p_user uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    exists (select 1 from tech_work_days w where w.user_id = p_user and extract(dow from p_date)::smallint = any(w.days_off))
    or exists (select 1 from tech_time_off t where t.user_id = p_user and p_date between t.start_date and t.end_date)
  )
$$;

-- Nearest working day on or before the due date (not before today); else the first working day after it.
create or replace function public.pm_schedule_date(p_tech uuid, p_due date, p_today date)
returns date language plpgsql stable security definer set search_path = public as $$
declare d date; i int;
begin
  d := greatest(p_due, p_today);
  if p_tech is null or not public.is_tech_off(p_tech, d) then return d; end if;
  for i in 1..30 loop                         -- earlier first, but never in the past
    exit when d - i < p_today;
    if not public.is_tech_off(p_tech, d - i) then return d - i; end if;
  end loop;
  for i in 1..60 loop
    if not public.is_tech_off(p_tech, d + i) then return d + i; end if;
  end loop;
  return d;                                   -- off for months: leave it on the due date
end $$;

revoke execute on function public.is_tech_off(uuid, date), public.pm_schedule_date(uuid, date, date) from public, anon;

create or replace function public.generate_due_work_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  s public.pm_schedules;
  c public.compliance_requirements;
  v_next date;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  n int := 0;
begin
  if auth.uid() is not null and not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Only admins can run the scheduler';
  end if;

  for s in select * from pm_schedules
            where active and next_due_on - lead_days <= current_date
  loop
    if not exists (select 1 from work_orders
                    where pm_schedule_id = s.id and status not in ('completed', 'cancelled')) then
      insert into work_orders (site_id, asset_id, title, description, category, priority, type,
                               assigned_tech_id, vendor_id, due_at, pm_schedule_id,
                               scheduled_date, scheduled_start, estimated_hours)
      values (s.site_id, s.asset_id, 'PM: ' || s.title,
              concat_ws(E'\n\n', s.instructions,
                        case when cardinality(s.checklist) > 0
                             then 'Checklist:' || E'\n' || array_to_string(array(select '☐ ' || x from unnest(s.checklist) x), E'\n') end),
              s.category, s.priority, 'preventive',
              s.assigned_tech_id, s.vendor_id,
              (s.next_due_on + time '17:00') at time zone 'America/Los_Angeles',
              s.id,
              case when s.auto_schedule then public.pm_schedule_date(s.assigned_tech_id, s.next_due_on, v_today) end,
              case when s.auto_schedule then s.start_time end,
              s.estimated_hours);
      n := n + 1;
      v_next := s.next_due_on;
      loop
        v_next := (v_next + freq_interval(s.frequency_interval, s.frequency_unit))::date;
        exit when v_next - s.lead_days > current_date;
      end loop;
      update pm_schedules set next_due_on = v_next, last_generated_on = current_date where id = s.id;
    end if;
  end loop;

  -- Compliance: inside the reminder window, or already given a service date.
  for c in select * from compliance_requirements
            where active and auto_create_wo
              and (next_due_on - lead_days <= current_date or scheduled_for is not null)
  loop
    if not exists (select 1 from work_orders
                    where compliance_requirement_id = c.id and status not in ('completed', 'cancelled')) then
      perform ensure_compliance_work_order(c.id, null);
      n := n + 1;
    end if;
  end loop;

  return n;
end $$;
revoke execute on function public.generate_due_work_orders() from public, anon;
