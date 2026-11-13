-- =====================================================================
-- MaintainOS — Technician time tracking & internal labor cost
-- Run after 0010. Safe to re-run.
--
-- time_entries       one row per timer run (start → stop) or manual entry. Pause/resume
--                    happen inside an entry; paused time isn't counted. Every entry keeps
--                    the work order's visit number, which goes up each time the work
--                    order is reopened, so return visits are separate and nothing is reset.
-- tech_rates         hourly rate history per technician (admin only). Each entry is costed
--                    at the rate in effect on the day it started.
-- time_entry_costs   hours × rate per entry (admin only).
-- wo_labor_costs     labor hours + cost per work order (admin only). work_orders.labor_hours
--                    is the visible hours rollup; labor dollars never live on work_orders.
-- time_entry_audit   every manual add / edit / void with who, when, why, before and after.
-- rm_cost_lines      one R&M ledger: labor (by day worked), receipts (purchase date),
--                    other parts and vendor invoices (completion date). Row security of the
--                    underlying tables applies, so only admins see labor lines.
-- Writes go through the timer_* / time_entry_* functions below; there is no direct
-- insert/update access to time entries.
-- =====================================================================

-- ---------- Rates (admin only) ----------------------------------------
create table if not exists public.tech_rates (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  hourly_rate     numeric(10,2) not null check (hourly_rate >= 0),
  effective_from  date not null default current_date,
  note            text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (user_id, effective_from)
);
alter table public.tech_rates enable row level security;
drop policy if exists tech_rates_admin on public.tech_rates;
create policy tech_rates_admin on public.tech_rates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Visits ----------------------------------------------------
alter table public.work_orders add column if not exists visit integer not null default 1;

create or replace function public.wo_visit_counter()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'completed' and new.status not in ('completed', 'cancelled') then
    new.visit := old.visit + 1;   -- reopened: the next time logged is a new visit
  end if;
  return new;
end $$;
drop trigger if exists wo_visit_counter on public.work_orders;
create trigger wo_visit_counter before update of status on public.work_orders
  for each row execute function public.wo_visit_counter();

-- ---------- Time entries ----------------------------------------------
create table if not exists public.time_entries (
  id               uuid primary key default gen_random_uuid(),
  work_order_id    uuid not null references public.work_orders(id) on delete cascade,
  site_id          uuid references public.sites(id) on delete set null,
  company_id       uuid references public.companies(id) on delete set null,
  user_id          uuid references public.profiles(id) on delete set null,
  visit            integer not null default 1,
  status           text not null default 'running' check (status in ('running', 'paused', 'stopped', 'void')),
  source           text not null default 'timer' check (source in ('timer', 'manual')),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  last_resumed_at  timestamptz,
  worked_seconds   integer not null default 0 check (worked_seconds >= 0),
  pause_count      integer not null default 0,
  note             text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists time_entries_wo_idx on public.time_entries(work_order_id, started_at);
create index if not exists time_entries_user_idx on public.time_entries(user_id, started_at desc);
create index if not exists time_entries_company_idx on public.time_entries(company_id, started_at desc);
-- No overlapping timers: one running timer per technician.
create unique index if not exists time_entries_one_running on public.time_entries(user_id) where status = 'running';
drop trigger if exists time_entries_touch on public.time_entries;
create trigger time_entries_touch before update on public.time_entries for each row execute function public.touch_updated_at();

alter table public.time_entries enable row level security;
drop policy if exists time_entries_select on public.time_entries;
create policy time_entries_select on public.time_entries for select to authenticated
  using (public.my_role() in ('admin', 'tech', 'manager')
         and exists (select 1 from public.work_orders w where w.id = work_order_id));

-- Site/company follow the work order (also when a site moves company).
create or replace function public.time_entries_place()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select site_id, company_id into new.site_id, new.company_id from work_orders where id = new.work_order_id;
  return new;
end $$;
drop trigger if exists time_entries_place on public.time_entries;
create trigger time_entries_place before insert or update of work_order_id on public.time_entries
  for each row execute function public.time_entries_place();

create or replace function public.wo_place_time_entries()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update time_entries set site_id = new.site_id, company_id = new.company_id
   where work_order_id = new.id and (site_id is distinct from new.site_id or company_id is distinct from new.company_id);
  return null;
end $$;
drop trigger if exists wo_place_time_entries on public.work_orders;
create trigger wo_place_time_entries after update of site_id, company_id on public.work_orders
  for each row when (old.site_id is distinct from new.site_id or old.company_id is distinct from new.company_id)
  execute function public.wo_place_time_entries();

-- ---------- Costs (admin only) ----------------------------------------
create table if not exists public.time_entry_costs (
  entry_id       uuid primary key references public.time_entries(id) on delete cascade,
  work_order_id  uuid not null references public.work_orders(id) on delete cascade,
  hours          numeric(10,4) not null default 0,
  hourly_rate    numeric(10,2),             -- null = no rate set for this tech on that date
  cost_override  numeric(12,2),             -- labor imported from before time tracking
  labor_cost     numeric(12,2) not null default 0,
  updated_at     timestamptz not null default now()
);
create table if not exists public.wo_labor_costs (
  work_order_id  uuid primary key references public.work_orders(id) on delete cascade,
  hours          numeric(10,2) not null default 0,
  labor_cost     numeric(12,2) not null default 0,
  entries        integer not null default 0,
  missing_rate   boolean not null default false,
  updated_at     timestamptz not null default now()
);
alter table public.time_entry_costs enable row level security;
alter table public.wo_labor_costs   enable row level security;
drop policy if exists time_entry_costs_admin on public.time_entry_costs;
create policy time_entry_costs_admin on public.time_entry_costs for select to authenticated using (public.is_admin());
drop policy if exists wo_labor_costs_admin on public.wo_labor_costs;
create policy wo_labor_costs_admin on public.wo_labor_costs for select to authenticated using (public.is_admin());

create or replace function public.applicable_rate(p_user uuid, p_on date)
returns numeric language sql stable security definer set search_path = public as $$
  select hourly_rate from tech_rates where user_id = p_user and effective_from <= p_on
   order by effective_from desc limit 1
$$;

create or replace function public.refresh_wo_labor(p_wo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare h numeric; c numeric; n integer; m boolean;
begin
  select coalesce(sum(tc.hours), 0), coalesce(sum(tc.labor_cost), 0), count(*),
         coalesce(bool_or(tc.hourly_rate is null and tc.cost_override is null and tc.hours > 0), false)
    into h, c, n, m
    from time_entries te join time_entry_costs tc on tc.entry_id = te.id
   where te.work_order_id = p_wo and te.status <> 'void';
  insert into wo_labor_costs (work_order_id, hours, labor_cost, entries, missing_rate, updated_at)
  values (p_wo, round(h, 2), round(c, 2), n, m, now())
  on conflict (work_order_id) do update
    set hours = excluded.hours, labor_cost = excluded.labor_cost, entries = excluded.entries,
        missing_rate = excluded.missing_rate, updated_at = now();
  update work_orders set labor_hours = round(h, 2) where id = p_wo and labor_hours is distinct from round(h, 2);
end $$;

-- Recost an entry from its recorded seconds and the rate in effect on its start date.
create or replace function public.cost_time_entry(p_entry uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e time_entries; r numeric; hrs numeric; ov numeric;
begin
  select * into e from time_entries where id = p_entry;
  if not found then return; end if;
  hrs := case when e.status = 'void' then 0 else e.worked_seconds / 3600.0 end;
  r := public.applicable_rate(e.user_id, (e.started_at at time zone 'America/Los_Angeles')::date);
  select cost_override into ov from time_entry_costs where entry_id = p_entry;
  insert into time_entry_costs (entry_id, work_order_id, hours, hourly_rate, cost_override, labor_cost, updated_at)
  values (p_entry, e.work_order_id, hrs, r, ov,
          case when e.status = 'void' then 0 when ov is not null then ov else round(hrs * coalesce(r, 0), 2) end, now())
  on conflict (entry_id) do update
    set work_order_id = excluded.work_order_id, hours = excluded.hours, hourly_rate = excluded.hourly_rate,
        labor_cost = case when e.status = 'void' then 0 when time_entry_costs.cost_override is not null then time_entry_costs.cost_override
                          else round(excluded.hours * coalesce(excluded.hourly_rate, 0), 2) end,
        updated_at = now();
  perform public.refresh_wo_labor(e.work_order_id);
end $$;

create or replace function public.time_entries_costing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.cost_time_entry(new.id);
  if tg_op = 'UPDATE' and old.work_order_id is distinct from new.work_order_id then
    perform public.refresh_wo_labor(old.work_order_id);
  end if;
  return null;
end $$;
drop trigger if exists time_entries_costing on public.time_entries;
create trigger time_entries_costing after insert or update on public.time_entries
  for each row execute function public.time_entries_costing();

-- A new or changed rate recosts that technician's entries.
create or replace function public.tech_rates_recost()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := coalesce(new.user_id, old.user_id); e uuid;
begin
  for e in select id from time_entries where user_id = uid loop
    perform public.cost_time_entry(e);
  end loop;
  return null;
end $$;
drop trigger if exists tech_rates_recost on public.tech_rates;
create trigger tech_rates_recost after insert or update or delete on public.tech_rates
  for each row execute function public.tech_rates_recost();

-- ---------- Audit (admin only) ----------------------------------------
create table if not exists public.time_entry_audit (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid references public.time_entries(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete cascade,
  action      text not null,            -- manual_add | edit | void | admin_stop
  reason      text not null,
  before      jsonb,
  after       jsonb,
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index if not exists time_entry_audit_wo_idx on public.time_entry_audit(work_order_id, changed_at desc);
alter table public.time_entry_audit enable row level security;
drop policy if exists time_entry_audit_admin on public.time_entry_audit;
create policy time_entry_audit_admin on public.time_entry_audit for select to authenticated using (public.is_admin());

-- ---------- Timer actions ---------------------------------------------
-- Seconds worked so far (closes the current running stretch).
create or replace function public.entry_seconds_now(e public.time_entries)
returns integer language sql stable as $$
  select e.worked_seconds + case when e.status = 'running' and e.last_resumed_at is not null
                                 then greatest(0, extract(epoch from now() - e.last_resumed_at))::integer else 0 end
$$;

create or replace function public.can_time_wo(p_wo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin', 'tech') and exists (
    select 1 from work_orders w where w.id = p_wo
      and (public.is_admin() or w.assigned_tech_id = auth.uid() or public.is_site_member(w.site_id)))
$$;

-- Pause any other running timer of the caller (one running timer per technician).
create or replace function public.pause_my_other_timers(p_keep uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare e time_entries; wo_no integer;
begin
  for e in select * from time_entries where user_id = auth.uid() and status = 'running' and id is distinct from p_keep for update loop
    update time_entries set status = 'paused', worked_seconds = public.entry_seconds_now(e), last_resumed_at = null,
                            pause_count = pause_count + 1 where id = e.id;
    select number into wo_no from work_orders where id = e.work_order_id;
  end loop;
  return wo_no;
end $$;

create or replace function public.timer_start(p_wo uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w work_orders; e time_entries; paused_wo integer; new_id uuid;
begin
  if auth.uid() is null or not public.can_time_wo(p_wo) then raise exception 'Not allowed to log time on this work order'; end if;
  select * into w from work_orders where id = p_wo;
  if w.status = 'cancelled' then raise exception 'This work order is cancelled'; end if;
  if w.status = 'completed' then raise exception 'Reopen the work order to log a return visit'; end if;

  -- Already have a timer on this work order? Resume it instead of starting a second one.
  select * into e from time_entries where work_order_id = p_wo and user_id = auth.uid() and status in ('running', 'paused')
   order by started_at desc limit 1;
  if found then
    paused_wo := public.pause_my_other_timers(e.id);
    if e.status = 'paused' then
      update time_entries set status = 'running', last_resumed_at = now() where id = e.id;
    end if;
    return jsonb_build_object('entry_id', e.id, 'paused_wo', paused_wo, 'resumed', true);
  end if;

  paused_wo := public.pause_my_other_timers(null);
  insert into time_entries (work_order_id, user_id, visit, status, source, started_at, last_resumed_at, created_by)
  values (p_wo, auth.uid(), w.visit, 'running', 'timer', now(), now(), auth.uid())
  returning id into new_id;
  update work_orders set status = 'in_progress' where id = p_wo and status in ('new', 'assigned', 'on_hold');
  return jsonb_build_object('entry_id', new_id, 'paused_wo', paused_wo, 'resumed', false);
end $$;

create or replace function public.timer_change(p_entry uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e time_entries; paused_wo integer;
begin
  select * into e from time_entries where id = p_entry for update;
  if not found then raise exception 'Timer not found'; end if;
  if e.user_id is distinct from auth.uid() and not public.is_admin() then raise exception 'You can only change your own timer'; end if;
  if p_action = 'pause' and e.status = 'running' then
    update time_entries set status = 'paused', worked_seconds = public.entry_seconds_now(e), last_resumed_at = null,
                            pause_count = pause_count + 1 where id = e.id;
  elsif p_action = 'resume' and e.status = 'paused' then
    if e.user_id <> auth.uid() then raise exception 'Only the technician can resume their timer'; end if;
    if exists (select 1 from work_orders where id = e.work_order_id and status in ('completed', 'cancelled')) then
      raise exception 'Reopen the work order to log more time';
    end if;
    paused_wo := public.pause_my_other_timers(e.id);
    update time_entries set status = 'running', last_resumed_at = now() where id = e.id;
  elsif p_action = 'stop' and e.status in ('running', 'paused') then
    update time_entries set status = 'stopped', worked_seconds = public.entry_seconds_now(e), last_resumed_at = null, ended_at = now()
     where id = e.id;
    if e.user_id is distinct from auth.uid() then
      insert into time_entry_audit (entry_id, work_order_id, action, reason, before, changed_by)
      values (e.id, e.work_order_id, 'admin_stop', 'Stopped by admin', to_jsonb(e), auth.uid());
    end if;
  end if;
  return jsonb_build_object('entry_id', e.id, 'paused_wo', paused_wo);
end $$;

-- Completing (or cancelling) a work order stops every timer on it.
create or replace function public.wo_stop_timers()
returns trigger language plpgsql security definer set search_path = public as $$
declare e time_entries;
begin
  for e in select * from time_entries where work_order_id = new.id and status in ('running', 'paused') for update loop
    update time_entries set status = 'stopped', worked_seconds = public.entry_seconds_now(e), last_resumed_at = null, ended_at = now()
     where id = e.id;
  end loop;
  return null;
end $$;
drop trigger if exists wo_stop_timers on public.work_orders;
create trigger wo_stop_timers after update of status on public.work_orders
  for each row when (new.status in ('completed', 'cancelled') and old.status is distinct from new.status)
  execute function public.wo_stop_timers();

-- ---------- Manual adjustments (admin only, reason required, audited) ----------
create or replace function public.time_overlaps(p_user uuid, p_start timestamptz, p_end timestamptz, p_except uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from time_entries t
     where t.user_id = p_user and t.status <> 'void' and t.id is distinct from p_except
       and tstzrange(t.started_at, coalesce(t.ended_at, now()), '[)') && tstzrange(p_start, p_end, '[)'))
$$;

create or replace function public.time_entry_manual(p_wo uuid, p_user uuid, p_start timestamptz, p_end timestamptz, p_hours numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare w work_orders; secs integer; new_id uuid;
begin
  if not public.is_admin() then raise exception 'Only admins can add time manually'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for manual time'; end if;
  if p_end <= p_start then raise exception 'End time must be after start time'; end if;
  secs := coalesce(round(p_hours * 3600)::integer, extract(epoch from p_end - p_start)::integer);
  if secs <= 0 or secs > extract(epoch from p_end - p_start) + 1 then raise exception 'Hours must fit between the start and end time'; end if;
  if public.time_overlaps(p_user, p_start, p_end, null) then raise exception 'That time overlaps another entry for this technician'; end if;
  select * into w from work_orders where id = p_wo;
  if not found then raise exception 'Work order not found'; end if;
  insert into time_entries (work_order_id, user_id, visit, status, source, started_at, ended_at, worked_seconds, note, created_by)
  values (p_wo, p_user, w.visit, 'stopped', 'manual', p_start, p_end, secs, p_reason, auth.uid())
  returning id into new_id;
  insert into time_entry_audit (entry_id, work_order_id, action, reason, after, changed_by)
  select new_id, p_wo, 'manual_add', p_reason, to_jsonb(t), auth.uid() from time_entries t where t.id = new_id;
  return new_id;
end $$;

create or replace function public.time_entry_edit(p_entry uuid, p_start timestamptz, p_end timestamptz, p_hours numeric, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare e time_entries; secs integer;
begin
  if not public.is_admin() then raise exception 'Only admins can adjust time'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to adjust time'; end if;
  select * into e from time_entries where id = p_entry for update;
  if not found then raise exception 'Entry not found'; end if;
  if e.status in ('running', 'paused') then raise exception 'Stop the timer before adjusting it'; end if;
  if e.status = 'void' then raise exception 'This entry was voided'; end if;
  if p_end <= p_start then raise exception 'End time must be after start time'; end if;
  secs := coalesce(round(p_hours * 3600)::integer, extract(epoch from p_end - p_start)::integer);
  if secs <= 0 or secs > extract(epoch from p_end - p_start) + 1 then raise exception 'Hours must fit between the start and end time'; end if;
  if public.time_overlaps(e.user_id, p_start, p_end, e.id) then raise exception 'That time overlaps another entry for this technician'; end if;
  update time_entries set started_at = p_start, ended_at = p_end, worked_seconds = secs where id = e.id;
  insert into time_entry_audit (entry_id, work_order_id, action, reason, before, after, changed_by)
  select e.id, e.work_order_id, 'edit', p_reason, to_jsonb(e), to_jsonb(t), auth.uid() from time_entries t where t.id = e.id;
end $$;

create or replace function public.time_entry_void(p_entry uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare e time_entries;
begin
  if not public.is_admin() then raise exception 'Only admins can void time'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to void time'; end if;
  select * into e from time_entries where id = p_entry for update;
  if not found or e.status = 'void' then return; end if;
  update time_entries set status = 'void', worked_seconds = public.entry_seconds_now(e), last_resumed_at = null,
                          ended_at = coalesce(ended_at, now()) where id = e.id;
  insert into time_entry_audit (entry_id, work_order_id, action, reason, before, changed_by)
  values (e.id, e.work_order_id, 'void', p_reason, to_jsonb(e), auth.uid());
end $$;

-- ---------- Bring forward labor typed in before time tracking ----------
do $$
declare w record; new_id uuid; hrs numeric;
begin
  for w in select * from work_orders wo
            where (wo.labor_hours > 0 or wo.labor_cost > 0)
              and not exists (select 1 from time_entries t where t.work_order_id = wo.id) loop
    hrs := greatest(coalesce(w.labor_hours, 0), 0);
    insert into time_entries (work_order_id, user_id, visit, status, source, started_at, ended_at, worked_seconds, note)
    values (w.id, w.assigned_tech_id, w.visit, 'stopped', 'manual',
            coalesce(w.started_at, w.created_at),
            coalesce(w.completed_at, coalesce(w.started_at, w.created_at) + make_interval(secs => greatest(hrs * 3600, 60))),
            round(hrs * 3600)::integer, 'Labor entered before time tracking')
    returning id into new_id;
    update time_entry_costs set cost_override = w.labor_cost, labor_cost = w.labor_cost where entry_id = new_id;
    perform public.refresh_wo_labor(w.id);
    update work_orders set labor_cost = 0 where id = w.id;
  end loop;
end $$;

-- ---------- R&M ledger --------------------------------------------------
create or replace view public.rm_cost_lines with (security_invoker = true) as
  select 'labor'::text as category, te.work_order_id, te.company_id, te.site_id, te.user_id,
         (te.started_at at time zone 'America/Los_Angeles')::date as spent_on,
         tc.hours, tc.labor_cost as amount, te.id as source_id
    from public.time_entries te join public.time_entry_costs tc on tc.entry_id = te.id
   where te.status <> 'void'
  union all
  select 'parts', p.work_order_id, w.company_id, w.site_id, p.purchased_by, p.purchase_date, null, p.total, p.id
    from public.wo_purchases p join public.work_orders w on w.id = p.work_order_id
   where p.status <> 'rejected'
  union all
  select 'parts', w.id, w.company_id, w.site_id, null,
         (coalesce(w.completed_at, w.created_at) at time zone 'America/Los_Angeles')::date, null, w.parts_cost, w.id
    from public.work_orders w where w.parts_cost <> 0 and w.status <> 'cancelled'
  union all
  select 'vendor', w.id, w.company_id, w.site_id, null,
         (coalesce(w.completed_at, w.created_at) at time zone 'America/Los_Angeles')::date, null, w.vendor_invoice_amount, w.id
    from public.work_orders w where w.vendor_invoice_amount <> 0 and w.status <> 'cancelled'
  union all
  select 'labor', w.id, w.company_id, w.site_id, null,
         (coalesce(w.completed_at, w.created_at) at time zone 'America/Los_Angeles')::date, null, w.labor_cost, w.id
    from public.work_orders w where w.labor_cost <> 0 and w.status <> 'cancelled' and public.is_admin();

-- ---------- Grants -----------------------------------------------------
grant select on public.time_entries, public.time_entry_costs, public.wo_labor_costs, public.time_entry_audit, public.rm_cost_lines to authenticated;
grant all on public.tech_rates to authenticated;
grant all on public.tech_rates, public.time_entries, public.time_entry_costs, public.wo_labor_costs, public.time_entry_audit, public.rm_cost_lines to service_role;

revoke execute on function public.time_entries_place(), public.wo_place_time_entries(), public.refresh_wo_labor(uuid), public.cost_time_entry(uuid),
  public.time_entries_costing(), public.tech_rates_recost(), public.pause_my_other_timers(uuid), public.wo_stop_timers(),
  public.applicable_rate(uuid, date), public.time_overlaps(uuid, timestamptz, timestamptz, uuid), public.wo_visit_counter()
  from public, anon, authenticated;
revoke execute on function public.timer_start(uuid), public.timer_change(uuid, text), public.can_time_wo(uuid),
  public.time_entry_manual(uuid, uuid, timestamptz, timestamptz, numeric, text), public.time_entry_edit(uuid, timestamptz, timestamptz, numeric, text),
  public.time_entry_void(uuid, text) from public, anon;
grant execute on function public.timer_start(uuid), public.timer_change(uuid, text), public.can_time_wo(uuid),
  public.time_entry_manual(uuid, uuid, timestamptz, timestamptz, numeric, text), public.time_entry_edit(uuid, timestamptz, timestamptz, numeric, text),
  public.time_entry_void(uuid, text) to authenticated;
