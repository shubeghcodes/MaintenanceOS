-- =====================================================================
-- MaintenanceOS — GM sign-off before a store work order closes
-- Run after 0016. Safe to re-run.
--
-- When a tech or vendor finishes a work order at a location that has a GM
-- (store / property manager), it moves to 'awaiting_signoff' instead of
-- 'completed'. A GM at that location confirms it's fixed (→ completed) or
-- sends it back (→ in progress, as a return visit). Admins can close it for
-- the GM with a reason; the daily job reminds after 1 day and closes it
-- automatically after 3. PM and compliance work orders skip sign-off.
-- Timers stop and completed_at is stamped when the work is done, so sign-off
-- delays don't count against techs or vendors.
-- =====================================================================

alter table public.work_orders add column if not exists signoff_requested_at timestamptz;
alter table public.work_orders add column if not exists signoff_reminded_at timestamptz;
alter table public.work_orders add column if not exists signed_off_at timestamptz;
alter table public.work_orders add column if not exists signed_off_by uuid references public.profiles(id) on delete set null;
alter table public.work_orders add column if not exists signoff_method text;
alter table public.work_orders add column if not exists signoff_note text;
alter table public.work_orders drop constraint if exists work_orders_signoff_method_check;
alter table public.work_orders add constraint work_orders_signoff_method_check check (signoff_method in ('gm', 'admin', 'auto'));
create index if not exists wo_signoff_idx on public.work_orders(signoff_requested_at) where status = 'awaiting_signoff';

-- Needs a GM's sign-off: store work (not PM / compliance) at a location with an active GM.
create or replace function public.wo_needs_signoff(p_type public.wo_type, p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_type not in ('preventive', 'compliance')
     and exists (select 1 from site_members m join profiles p on p.id = m.user_id
                  where m.site_id = p_site and p.role = 'manager' and p.active)
$$;

-- Fires after wo_approval_guard and before wo_before_update (triggers run in name order).
create or replace function public.wo_awaiting_signoff()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.user_role;
begin
  if uid is not null then select role into r from profiles where id = uid; end if;

  -- Finishing a store job waits for the GM unless it's being signed off in the same step.
  if new.status = 'completed' and old.status <> 'completed' and new.signed_off_at is null
     and public.wo_needs_signoff(new.type, new.site_id) then
    new.status := 'awaiting_signoff';
  end if;

  if new.status = 'awaiting_signoff' and old.status <> 'awaiting_signoff' then
    new.signoff_requested_at := now();
    new.signoff_reminded_at := null;
  end if;

  -- Who can sign off: a GM at this location, or an admin (or the system for auto-close).
  if new.signed_off_at is not null and new.signed_off_at is distinct from old.signed_off_at then
    if uid is not null and not (r = 'admin' or (r = 'manager' and public.is_site_member(new.site_id))) then
      raise exception 'Only a GM at this location or an admin can sign off';
    end if;
    new.signed_off_by := coalesce(uid, new.signed_off_by);
    new.signoff_method := coalesce(new.signoff_method, case when uid is null then 'auto' when r = 'admin' then 'admin' else 'gm' end);
  end if;

  -- GMs: sign off or send back finished work, or withdraw their own request.
  if r = 'manager' and new.status is distinct from old.status then
    if not ((old.status = 'awaiting_signoff' and new.status in ('completed', 'in_progress'))
            or (new.status = 'cancelled' and old.status in ('requested', 'new') and old.requested_by = uid)) then
      raise exception 'GMs can only sign off on finished work or send it back';
    end if;
  end if;

  -- Reopened or sent back: the next sign-off starts fresh.
  if new.status not in ('completed', 'awaiting_signoff') and old.status in ('completed', 'awaiting_signoff') then
    new.signed_off_at := null;
    new.signed_off_by := null;
    new.signoff_method := null;
    new.signoff_requested_at := null;
    new.signoff_reminded_at := null;
  end if;
  return new;
end $$;
drop trigger if exists wo_awaiting_signoff on public.work_orders;
create trigger wo_awaiting_signoff before update on public.work_orders
  for each row execute function public.wo_awaiting_signoff();

-- completed_at = when the work was done (also while waiting for sign-off).
create or replace function public.wo_before_update()
returns trigger language plpgsql as $$
begin
  if new.status = 'new' and (new.assigned_tech_id is not null or new.vendor_id is not null) then
    new.status := 'assigned';
  end if;
  if new.status = 'in_progress' and old.status <> 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status in ('completed', 'awaiting_signoff') then
    if old.status not in ('completed', 'awaiting_signoff') then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end $$;

-- Sent back from sign-off counts as a return visit, like reopening.
create or replace function public.wo_visit_counter()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status in ('completed', 'awaiting_signoff') and new.status not in ('completed', 'awaiting_signoff', 'cancelled') then
    new.visit := old.visit + 1;
  end if;
  return new;
end $$;

-- Timers stop when the work is done, not when the GM signs.
drop trigger if exists wo_stop_timers on public.work_orders;
create trigger wo_stop_timers after update of status on public.work_orders
  for each row when (new.status in ('completed', 'awaiting_signoff', 'cancelled') and old.status is distinct from new.status)
  execute function public.wo_stop_timers();

revoke execute on function public.wo_awaiting_signoff() from public, anon, authenticated;
revoke execute on function public.wo_needs_signoff(public.wo_type, uuid) from public, anon;
grant execute on function public.wo_needs_signoff(public.wo_type, uuid) to authenticated;

-- No new time while a job waits for sign-off (sending it back reopens it for time).
create or replace function public.time_entry_approval_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.wo_status;
begin
  select status into s from work_orders where id = new.work_order_id;
  if s = 'requested' then raise exception 'This work order is waiting for approval by an admin'; end if;
  if s = 'awaiting_signoff' then raise exception 'This work order is waiting for the GM to sign off. If it isn''t fixed, the GM can send it back.'; end if;
  return new;
end $$;
