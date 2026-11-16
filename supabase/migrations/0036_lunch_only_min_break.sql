-- =====================================================================
-- MaintenanceOS — 30-minute minimum applies to lunch only
-- Run after 0035. Safe to re-run.
-- Clocking back in after clocking out is no longer held for 30 minutes (lunch_end still is).
-- =====================================================================
create or replace function public.clock_in(p_wo uuid, p_reason text, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me profiles; sid uuid; t jsonb;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or not me.active or me.role <> 'tech' then raise exception 'Only technicians clock in and out'; end if;
  if exists (select 1 from tech_shifts where user_id = me.id and clock_out_at is null) then
    raise exception 'You''re already clocked in';
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
