-- =====================================================================
-- MaintenanceOS — PM work orders go straight onto the schedule
-- Run after 0025. Safe to re-run.
--
-- * pm_schedules.auto_schedule (default on): the work order the scheduler creates is put on the
--   dispatch calendar on its due date (today if it's already past due), for the schedule's tech.
-- * pm_schedules.start_time (optional): the start time it gets on the calendar.
-- * The work order also carries the schedule's estimated hours (so the calendar's hour totals count it).
-- * Open PM work orders still sitting in Unscheduled are put on the calendar the same way.
-- =====================================================================

alter table public.pm_schedules add column if not exists auto_schedule boolean not null default true;
alter table public.pm_schedules add column if not exists start_time time;

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
              case when s.auto_schedule then greatest(s.next_due_on, v_today) end,
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

-- Open PM work orders still in Unscheduled: put them on their due date (or today if overdue).
update public.work_orders w
   set scheduled_date = greatest((w.due_at at time zone 'America/Los_Angeles')::date, (now() at time zone 'America/Los_Angeles')::date),
       scheduled_start = coalesce(w.scheduled_start, s.start_time),
       estimated_hours = coalesce(w.estimated_hours, s.estimated_hours)
  from public.pm_schedules s
 where w.pm_schedule_id = s.id
   and s.auto_schedule
   and w.type = 'preventive'
   and w.scheduled_date is null
   and w.due_at is not null
   and w.status not in ('requested', 'completed', 'cancelled', 'awaiting_signoff');
