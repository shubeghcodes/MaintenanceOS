-- =====================================================================
-- MaintenanceOS — tech scheduling / dispatch calendar
-- Run after 0001_schema.sql (0002 is optional pg_cron and can be skipped).
-- =====================================================================

alter table public.work_orders
  add column if not exists scheduled_date  date,
  add column if not exists scheduled_start time,
  add column if not exists estimated_hours numeric(6,2);

create index if not exists wo_schedule_idx on public.work_orders(scheduled_date, assigned_tech_id);

-- PM work orders inherit the schedule's estimated hours.
create or replace function public.wo_pm_defaults()
returns trigger language plpgsql as $$
begin
  if new.pm_schedule_id is not null and new.estimated_hours is null then
    select estimated_hours into new.estimated_hours from public.pm_schedules where id = new.pm_schedule_id;
  end if;
  return new;
end $$;
drop trigger if exists wo_pm_defaults on public.work_orders;
create trigger wo_pm_defaults before insert on public.work_orders
  for each row execute function public.wo_pm_defaults();

-- Activity log now also records schedule changes.
create or replace function public.wo_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.compliance_requirements;
begin
  if tg_op = 'INSERT' then
    insert into work_order_events (work_order_id, user_id, kind, body, to_status)
    values (new.id, auth.uid(), 'system',
            case new.type when 'preventive' then 'Created from PM schedule'
                          when 'compliance' then 'Created from compliance requirement'
                          else 'Request submitted' end,
            new.status);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into work_order_events (work_order_id, user_id, kind, from_status, to_status)
    values (new.id, auth.uid(), 'status', old.status, new.status);
  end if;

  if new.assigned_tech_id is distinct from old.assigned_tech_id
     or new.vendor_id is distinct from old.vendor_id then
    insert into work_order_events (work_order_id, user_id, kind, body)
    values (new.id, auth.uid(), 'assignment',
      concat_ws(' · ',
        (select 'Tech: ' || coalesce(full_name, email) from profiles where id = new.assigned_tech_id),
        (select 'Vendor: ' || name from vendors where id = new.vendor_id),
        case when new.assigned_tech_id is null and new.vendor_id is null then 'Unassigned' end));
  end if;

  if new.scheduled_date is distinct from old.scheduled_date
     or new.scheduled_start is distinct from old.scheduled_start then
    insert into work_order_events (work_order_id, user_id, kind, body)
    values (new.id, auth.uid(), 'schedule',
      case when new.scheduled_date is null then 'Removed from schedule'
           else 'Scheduled for ' || to_char(new.scheduled_date, 'Dy Mon DD')
                || coalesce(' at ' || trim(to_char(new.scheduled_start, 'FMHH12:MI AM')), '') end);
  end if;

  if new.status = 'completed' and old.status <> 'completed' then
    if new.pm_schedule_id is not null then
      update pm_schedules set last_completed_on = current_date where id = new.pm_schedule_id;
    end if;
    if new.compliance_requirement_id is not null then
      select * into r from compliance_requirements where id = new.compliance_requirement_id;
      insert into compliance_records (requirement_id, completed_on, result, vendor_id, work_order_id, notes, recorded_by)
      values (r.id, current_date, 'pass', new.vendor_id, new.id,
              coalesce(new.resolution_notes, 'Closed via WO #' || new.number), auth.uid());
      update compliance_requirements
         set last_completed_on = current_date,
             next_due_on = (current_date + freq_interval(r.frequency_interval, r.frequency_unit))::date
       where id = r.id;
    end if;
  end if;
  return new;
end $$;

-- Record of schedule emails sent (prevents the morning job from double-sending).
create table if not exists public.schedule_emails (
  id             uuid primary key default gen_random_uuid(),
  tech_id        uuid not null references public.profiles(id) on delete cascade,
  schedule_date  date not null,
  job_count      integer not null default 0,
  sent_to        text,
  sent_by        uuid references public.profiles(id) on delete set null,  -- null = automatic
  status         text not null default 'sent',                           -- sent | failed | skipped
  error          text,
  sent_at        timestamptz not null default now()
);
create index if not exists schedule_emails_idx on public.schedule_emails(schedule_date, tech_id);

alter table public.schedule_emails enable row level security;
drop policy if exists schedule_emails_select on public.schedule_emails;
create policy schedule_emails_select on public.schedule_emails for select to authenticated
  using (public.is_admin() or tech_id = auth.uid());
drop policy if exists schedule_emails_admin on public.schedule_emails;
create policy schedule_emails_admin on public.schedule_emails for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
