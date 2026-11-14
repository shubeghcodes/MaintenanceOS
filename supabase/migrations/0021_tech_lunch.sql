-- =====================================================================
-- MaintenanceOS — Lunch during a technician's shift
-- Run after 0020. Safe to re-run.
--
-- Start lunch pauses the running job timer; End lunch resumes it. No job
-- time can run during lunch, and clocking out ends a lunch that's still
-- open. Lunch time is subtracted from the shift's hours on Timesheets.
-- Admins can add, fix or remove a lunch with a reason (kept in history).
-- =====================================================================

create table if not exists public.tech_shift_breaks (
  id              uuid primary key default gen_random_uuid(),
  shift_id        uuid not null references public.tech_shifts(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  paused_entry_id uuid references public.time_entries(id) on delete set null, -- job timer lunch paused
  edited          boolean not null default false,
  created_at      timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at)
);
create index if not exists tech_shift_breaks_shift_idx on public.tech_shift_breaks(shift_id, started_at);
create unique index if not exists tech_shift_breaks_one_open on public.tech_shift_breaks(user_id) where ended_at is null;

alter table public.tech_shift_breaks enable row level security;
drop policy if exists tech_shift_breaks_select on public.tech_shift_breaks;
create policy tech_shift_breaks_select on public.tech_shift_breaks for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
grant select on public.tech_shift_breaks to authenticated;
grant all on public.tech_shift_breaks to service_role;

-- Techs: a job timer only runs during a shift, and not during lunch.
create or replace function public.time_entry_shift_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'running' and new.source = 'timer'
     and (tg_op = 'INSERT' or old.status is distinct from 'running')
     and exists (select 1 from profiles where id = new.user_id and role = 'tech') then
    if not exists (select 1 from tech_shifts where user_id = new.user_id and clock_out_at is null) then
      raise exception 'Clock in first to start working on a job';
    end if;
    if exists (select 1 from tech_shift_breaks where user_id = new.user_id and ended_at is null) then
      raise exception 'You''re on lunch. End lunch to start working again';
    end if;
  end if;
  return new;
end $$;

create or replace function public.lunch_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s tech_shifts; e time_entries; paused uuid;
begin
  select * into s from tech_shifts where user_id = auth.uid() and clock_out_at is null;
  if not found then raise exception 'Clock in first'; end if;
  if exists (select 1 from tech_shift_breaks where user_id = auth.uid() and ended_at is null) then
    raise exception 'You''re already on lunch';
  end if;
  -- Pause the running job timer so lunch isn't counted as job time.
  for e in select * from time_entries where user_id = auth.uid() and status = 'running' for update loop
    update time_entries set status = 'paused', worked_seconds = public.entry_seconds_now(e), last_resumed_at = null,
                            pause_count = pause_count + 1 where id = e.id;
    paused := e.id;
  end loop;
  insert into tech_shift_breaks (shift_id, user_id, paused_entry_id) values (s.id, auth.uid(), paused);
  return jsonb_build_object('paused_entry', paused);
end $$;

create or replace function public.lunch_end()
returns jsonb language plpgsql security definer set search_path = public as $$
declare b tech_shift_breaks; resumed integer;
begin
  select * into b from tech_shift_breaks where user_id = auth.uid() and ended_at is null for update;
  if not found then raise exception 'You''re not on lunch'; end if;
  update tech_shift_breaks set ended_at = greatest(now(), started_at + interval '1 second') where id = b.id;
  -- Pick the job back up where it was paused (if it's still paused and the job is still open).
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

-- Clock out also ends a lunch that's still open.
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

  update tech_shift_breaks set ended_at = greatest(out_at, started_at + interval '1 second')
   where shift_id = s.id and ended_at is null;

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

-- Admin closing a forgotten shift also ends an open lunch.
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
  if s.clock_out_at is null and p_out is not null then
    update tech_shift_breaks set ended_at = greatest(p_out, started_at + interval '1 second') where shift_id = s.id and ended_at is null;
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

-- Admin adds, fixes or removes a lunch (p_break null = add; p_start and p_end null = remove).
create or replace function public.lunch_save(p_shift uuid, p_break uuid, p_start timestamptz, p_end timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare s tech_shifts; b tech_shift_breaks; n tech_shift_breaks;
begin
  if not public.is_admin() then raise exception 'Only admins can change lunch times'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to change lunch times'; end if;
  select * into s from tech_shifts where id = p_shift;
  if not found then raise exception 'Shift not found'; end if;
  if p_break is not null then
    select * into b from tech_shift_breaks where id = p_break and shift_id = s.id for update;
    if not found then raise exception 'Lunch not found'; end if;
  end if;

  if p_start is null and p_end is null then
    if b.id is null then raise exception 'Nothing to remove'; end if;
    delete from tech_shift_breaks where id = b.id;
    insert into tech_shift_audit (shift_id, action, reason, before, after, changed_by)
    values (s.id, 'lunch_remove', trim(p_reason), to_jsonb(b), null, auth.uid());
    return;
  end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'Enter a lunch start and an end after it'; end if;
  if p_start < s.clock_in_at or (s.clock_out_at is not null and p_end > s.clock_out_at) then
    raise exception 'Lunch has to be inside the shift';
  end if;

  if b.id is null then
    insert into tech_shift_breaks (shift_id, user_id, started_at, ended_at, edited) values (s.id, s.user_id, p_start, p_end, true) returning * into n;
  else
    update tech_shift_breaks set started_at = p_start, ended_at = p_end, edited = true where id = b.id returning * into n;
  end if;
  insert into tech_shift_audit (shift_id, action, reason, before, after, changed_by)
  values (s.id, case when b.id is null then 'lunch_add' else 'lunch_edit' end, trim(p_reason), to_jsonb(b), to_jsonb(n), auth.uid());
end $$;

revoke execute on function public.lunch_start(), public.lunch_end(),
  public.lunch_save(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.lunch_start(), public.lunch_end(),
  public.lunch_save(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
