-- =====================================================================
-- MaintenanceOS — 30-minute minimum break
-- Run after 0034. Safe to re-run.
-- * Lunch: a tech can't end lunch until 30 minutes after starting it.
-- * Clock out → clock in: a tech can't clock back in until 30 minutes after clocking out.
-- Admins can still correct times on the timesheet.
-- =====================================================================
create or replace function public.la_time(p timestamptz)
returns text language sql immutable set search_path = public as $$
  select trim(to_char(p at time zone 'America/Los_Angeles', 'FMHH12:MI AM'))
$$;

create or replace function public.lunch_end()
returns jsonb language plpgsql security definer set search_path = public as $$
declare b tech_shift_breaks; resumed integer;
begin
  select * into b from tech_shift_breaks where user_id = auth.uid() and ended_at is null for update;
  if not found then raise exception 'You''re not on lunch'; end if;
  if now() < b.started_at + interval '30 minutes' then
    raise exception 'Lunch is at least 30 minutes. You can clock back in at %', public.la_time(b.started_at + interval '30 minutes');
  end if;
  update tech_shift_breaks set ended_at = greatest(now(), started_at + interval '1 second') where id = b.id;
  if b.paused_entry_id is not null then
    update time_entries t set status = 'running', last_resumed_at = now()
     where t.id = b.paused_entry_id and t.status = 'paused'
       and exists (select 1 from work_orders w where w.id = t.work_order_id and w.status not in ('completed', 'cancelled', 'awaiting_signoff'));
    if found then
      select w.number into resumed from time_entries t join work_orders w on w.id = t.work_order_id where t.id = b.paused_entry_id;
    end if;
  end if;
  return jsonb_build_object('resumed_wo', resumed);
end $$;

create or replace function public.clock_in(p_wo uuid, p_reason text, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me profiles; sid uuid; t jsonb; last_out timestamptz;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or not me.active or me.role <> 'tech' then raise exception 'Only technicians clock in and out'; end if;
  if exists (select 1 from tech_shifts where user_id = me.id and clock_out_at is null) then
    raise exception 'You''re already clocked in';
  end if;
  select max(clock_out_at) into last_out from tech_shifts where user_id = me.id;
  if last_out is not null and now() < last_out + interval '30 minutes' then
    raise exception 'Breaks are at least 30 minutes. You can clock back in at %', public.la_time(last_out + interval '30 minutes');
  end if;
  if p_wo is null and coalesce(trim(p_reason), '') = '' then
    raise exception 'Pick your first work order, or say why you''re starting without one';
  end if;
  if p_wo is not null and not public.can_time_wo(p_wo) then raise exception 'You can''t log time on that work order'; end if;

  insert into tech_shifts (user_id, first_work_order_id, start_reason, in_lat, in_lng, in_accuracy)
  values (me.id, p_wo, nullif(trim(p_reason), ''), p_lat, p_lng, p_accuracy)
  returning id into sid;
  if p_wo is not null then t := public.timer_start(p_wo); end if;
  return jsonb_build_object('shift_id', sid, 'paused_wo', t->'paused_wo');
end $$;

revoke execute on function public.la_time(timestamptz) from public, anon;
