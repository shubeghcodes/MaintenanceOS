-- =====================================================================
-- MaintenanceOS — Technician clock in / clock out (attendance)
-- Run after 0019. Safe to re-run.
--
-- A shift starts when a tech clocks in on their first work order (which
-- starts that job's timer) or with a reason when there's no job yet (shop,
-- parts run, training...). It ends when they clock out on their last work
-- order; any job timers still open stop then. Location is saved at the two
-- punches only. Techs can't run a job timer while clocked out.
-- Admins can correct punches with a reason; every change is kept.
-- =====================================================================

create table if not exists public.tech_shifts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  clock_in_at         timestamptz not null default now(),
  clock_out_at        timestamptz,
  first_work_order_id uuid references public.work_orders(id) on delete set null,
  last_work_order_id  uuid references public.work_orders(id) on delete set null,
  start_reason        text,   -- when clocking in without a work order
  end_reason          text,   -- when clocking out without a work order
  in_lat  double precision, in_lng  double precision, in_accuracy  double precision,
  out_lat double precision, out_lng double precision, out_accuracy double precision,
  edited              boolean not null default false,
  created_at          timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at > clock_in_at)
);
create index if not exists tech_shifts_user_idx on public.tech_shifts(user_id, clock_in_at desc);
create unique index if not exists tech_shifts_one_open on public.tech_shifts(user_id) where clock_out_at is null;

create table if not exists public.tech_shift_audit (
  id         uuid primary key default gen_random_uuid(),
  shift_id   uuid not null references public.tech_shifts(id) on delete cascade,
  action     text not null,          -- edit
  reason     text not null,
  before     jsonb,
  after      jsonb,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists tech_shift_audit_shift_idx on public.tech_shift_audit(shift_id, changed_at);

alter table public.tech_shifts enable row level security;
alter table public.tech_shift_audit enable row level security;
-- Techs see their own shifts; admins see everyone's. Changes only go through the functions below.
drop policy if exists tech_shifts_select on public.tech_shifts;
create policy tech_shifts_select on public.tech_shifts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists tech_shift_audit_select on public.tech_shift_audit;
create policy tech_shift_audit_select on public.tech_shift_audit for select to authenticated using (public.is_admin());
grant select on public.tech_shifts, public.tech_shift_audit to authenticated;
grant all on public.tech_shifts, public.tech_shift_audit to service_role;

-- Techs: a job timer only runs during a shift.
create or replace function public.time_entry_shift_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'running' and new.source = 'timer'
     and (tg_op = 'INSERT' or old.status is distinct from 'running')
     and exists (select 1 from profiles where id = new.user_id and role = 'tech')
     and not exists (select 1 from tech_shifts where user_id = new.user_id and clock_out_at is null) then
    raise exception 'Clock in first to start working on a job';
  end if;
  return new;
end $$;
drop trigger if exists time_entry_shift_guard on public.time_entries;
create trigger time_entry_shift_guard before insert or update on public.time_entries
  for each row execute function public.time_entry_shift_guard();

-- Clock in on the first work order (starts its timer), or with a reason when there's no job yet.
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

-- Clock out on the last work order. Open job timers stop. p_at lets a tech who forgot
-- to clock out yesterday enter the time they actually finished.
create or replace function public.clock_out(p_wo uuid, p_reason text, p_at timestamptz,
                                            p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s tech_shifts; e time_entries; out_at timestamptz := coalesce(p_at, now());
begin
  select * into s from tech_shifts where user_id = auth.uid() and clock_out_at is null for update;
  if not found then raise exception 'You''re not clocked in'; end if;
  if p_wo is null and coalesce(trim(p_reason), '') = '' then
    raise exception 'Pick your last work order, or say why you''re ending without one';
  end if;
  if out_at <= s.clock_in_at or out_at > now() + interval '1 minute' then
    raise exception 'The clock-out time has to be after you clocked in and not in the future';
  end if;

  -- Stop this tech's open job timers at the clock-out time.
  for e in select * from time_entries where user_id = auth.uid() and status in ('running', 'paused') for update loop
    update time_entries
       set status = 'stopped',
           worked_seconds = case when e.status = 'running' and e.last_resumed_at is not null
                                 then e.worked_seconds + greatest(0, extract(epoch from (greatest(out_at, e.last_resumed_at) - e.last_resumed_at)))::integer
                                 else e.worked_seconds end,
           last_resumed_at = null,
           ended_at = greatest(out_at, e.started_at + interval '1 second')
     where id = e.id;
  end loop;

  update tech_shifts
     set clock_out_at = out_at, last_work_order_id = p_wo, end_reason = nullif(trim(p_reason), ''),
         out_lat = p_lat, out_lng = p_lng, out_accuracy = p_accuracy
   where id = s.id;
  return jsonb_build_object('shift_id', s.id);
end $$;

-- Admins correct punches (forgotten clock-outs, wrong times) with a reason, kept in the history.
create or replace function public.shift_edit(p_shift uuid, p_in timestamptz, p_out timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare s tech_shifts; n tech_shifts;
begin
  if not public.is_admin() then raise exception 'Only admins can change clock times'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to change clock times'; end if;
  select * into s from tech_shifts where id = p_shift for update;
  if not found then raise exception 'Shift not found'; end if;
  if p_in is null then raise exception 'Clock-in time is required'; end if;
  if p_out is not null and p_out <= p_in then raise exception 'Clock-out has to be after clock-in'; end if;
  update tech_shifts set clock_in_at = p_in, clock_out_at = p_out, edited = true where id = s.id returning * into n;
  -- Closing a forgotten shift also stops any timer the tech left running.
  if s.clock_out_at is null and p_out is not null then
    update time_entries
       set status = 'stopped',
           worked_seconds = case when status = 'running' and last_resumed_at is not null
                                 then worked_seconds + greatest(0, extract(epoch from (greatest(p_out, last_resumed_at) - last_resumed_at)))::integer
                                 else worked_seconds end,
           last_resumed_at = null,
           ended_at = greatest(p_out, started_at + interval '1 second')
     where user_id = s.user_id and status in ('running', 'paused');
  end if;
  insert into tech_shift_audit (shift_id, action, reason, before, after, changed_by)
  values (s.id, 'edit', trim(p_reason), to_jsonb(s), to_jsonb(n), auth.uid());
end $$;

revoke execute on function public.time_entry_shift_guard() from public, anon, authenticated;
revoke execute on function public.clock_in(uuid, text, double precision, double precision, double precision),
  public.clock_out(uuid, text, timestamptz, double precision, double precision, double precision),
  public.shift_edit(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.clock_in(uuid, text, double precision, double precision, double precision),
  public.clock_out(uuid, text, timestamptz, double precision, double precision, double precision),
  public.shift_edit(uuid, timestamptz, timestamptz, text) to authenticated;
