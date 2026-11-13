-- =====================================================================
-- MaintenanceOS — Compliance calendar, automatic vendor emails, certificate tracking
-- Run after 0004. Safe to re-run.
-- =====================================================================

-- Planned service date (from the compliance calendar) and whether to email the vendor automatically.
alter table public.compliance_requirements
  add column if not exists scheduled_for date,
  add column if not exists auto_dispatch boolean not null default true;

-- Certificate number captured on the work order (by the vendor or staff), copied to the record on close.
alter table public.work_orders add column if not exists certificate_number text;

-- Each completion record knows how long it's good for.
alter table public.compliance_records add column if not exists valid_until date;

-- Certificate files can be tied to a specific completion record.
alter table public.attachments
  add column if not exists compliance_record_id uuid references public.compliance_records(id) on delete set null;
-- Files uploaded on a requirement before this update: attach them to its latest completion.
update public.attachments a
   set compliance_record_id = (select c.id from public.compliance_records c
                                where c.requirement_id = a.entity_id
                                order by c.completed_on desc, c.created_at desc limit 1),
       category = case when a.category = 'photo' then 'certificate' else a.category end
 where a.entity_type = 'compliance' and a.compliance_record_id is null
   and exists (select 1 from public.compliance_records c where c.requirement_id = a.entity_id);
create index if not exists attachments_record_idx on public.attachments(compliance_record_id) where compliance_record_id is not null;

create or replace function public.compliance_record_defaults()
returns trigger language plpgsql as $$
declare r public.compliance_requirements;
begin
  if new.valid_until is null and new.result <> 'fail' then
    select * into r from public.compliance_requirements where id = new.requirement_id;
    new.valid_until := (new.completed_on + public.freq_interval(r.frequency_interval, r.frequency_unit))::date;
  end if;
  return new;
end $$;
drop trigger if exists compliance_record_defaults on public.compliance_records;
create trigger compliance_record_defaults before insert on public.compliance_records
  for each row execute function public.compliance_record_defaults();

-- Backfill valid_until for existing records.
update public.compliance_records c
   set valid_until = (c.completed_on + public.freq_interval(r.frequency_interval, r.frequency_unit))::date
  from public.compliance_requirements r
 where r.id = c.requirement_id and c.valid_until is null and c.result <> 'fail';

-- ---------------------------------------------------------------------
-- One place that creates (or finds) the open work order for a compliance item.
-- Used by the daily scheduler, the compliance calendar and "Schedule service".
-- ---------------------------------------------------------------------
create or replace function public.ensure_compliance_work_order(p_requirement uuid, p_scheduled date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.compliance_requirements;
  v_id uuid;
begin
  if auth.uid() is not null and not exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'tech') and active) then
    raise exception 'Only admins and techs can schedule compliance work';
  end if;
  select * into c from compliance_requirements where id = p_requirement;
  if not found then raise exception 'Compliance requirement not found'; end if;

  select id into v_id from work_orders
   where compliance_requirement_id = c.id and status not in ('completed', 'cancelled')
   order by created_at desc limit 1;

  if v_id is null then
    insert into work_orders (site_id, title, description, category, priority, type, vendor_id, due_at,
                             scheduled_date, compliance_requirement_id)
    values (c.site_id, 'Compliance: ' || c.name,
            concat_ws(E'\n', 'Due ' || to_char(c.next_due_on, 'Mon DD, YYYY'),
                      case when c.authority is not null then 'Authority / standard: ' || c.authority end,
                      c.notes,
                      'Please upload the certificate or inspection report when complete.'),
            c.category,
            case when c.next_due_on < current_date then 'high'::wo_priority else 'medium'::wo_priority end,
            'compliance', c.vendor_id,
            (c.next_due_on + time '17:00') at time zone 'America/Los_Angeles',
            coalesce(p_scheduled, c.scheduled_for),
            c.id)
    returning id into v_id;
  elsif p_scheduled is not null then
    update work_orders set scheduled_date = p_scheduled where id = v_id;
  end if;
  return v_id;
end $$;
grant execute on function public.ensure_compliance_work_order(uuid, date) to authenticated, service_role;

-- Scheduler now uses the shared function for compliance (PM part unchanged).
create or replace function public.generate_due_work_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  s public.pm_schedules;
  c public.compliance_requirements;
  v_next date;
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
                               assigned_tech_id, vendor_id, due_at, pm_schedule_id)
      values (s.site_id, s.asset_id, 'PM: ' || s.title,
              concat_ws(E'\n\n', s.instructions,
                        case when cardinality(s.checklist) > 0
                             then 'Checklist:' || E'\n' || array_to_string(array(select '☐ ' || x from unnest(s.checklist) x), E'\n') end),
              s.category, s.priority, 'preventive',
              s.assigned_tech_id, s.vendor_id,
              (s.next_due_on + time '17:00') at time zone 'America/Los_Angeles',
              s.id);
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

-- Completion: copy certificate # into the record, link certificate files, clear the planned date.
create or replace function public.wo_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.compliance_requirements;
  v_record uuid;
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
      insert into compliance_records (requirement_id, completed_on, result, vendor_id, work_order_id,
                                      certificate_number, notes, recorded_by)
      values (r.id, current_date, 'pass', new.vendor_id, new.id, new.certificate_number,
              coalesce(new.resolution_notes, 'Closed via WO #' || new.number), auth.uid())
      returning id into v_record;
      update attachments set compliance_record_id = v_record
       where entity_type = 'work_order' and entity_id = new.id and category in ('certificate', 'completion');
      update compliance_requirements
         set last_completed_on = current_date,
             next_due_on = (current_date + freq_interval(r.frequency_interval, r.frequency_unit))::date,
             scheduled_for = null
       where id = r.id;
    end if;
  end if;
  return new;
end $$;

-- Manually logged completions also clear the planned date.
create or replace function public.compliance_record_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.compliance_requirements;
begin
  if new.work_order_id is not null then return new; end if;
  select * into r from compliance_requirements where id = new.requirement_id;
  if new.result <> 'fail' and (r.last_completed_on is null or new.completed_on >= r.last_completed_on) then
    update compliance_requirements
       set last_completed_on = new.completed_on,
           next_due_on = (new.completed_on + freq_interval(r.frequency_interval, r.frequency_unit))::date,
           scheduled_for = null
     where id = r.id;
  end if;
  return new;
end $$;
