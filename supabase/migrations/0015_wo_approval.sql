-- =====================================================================
-- MaintenanceOS — Admin approval for work orders
-- Run after 0014. Safe to re-run.
--
-- Work orders submitted by managers (GMs) and techs start as 'requested'
-- (shown as "Needs approval"). An admin or super admin approves by assigning
-- a technician or sending it to a vendor, or declines it (cancelled).
-- Until then nobody else can schedule, start, time or dispatch it, and only
-- admins ever assign or reassign a technician or vendor.
-- Work orders created by admins, and the automatic PM / compliance ones,
-- are approved when created.
-- Replaces the first version of these rules (migration "0014_wo_approval").
-- =====================================================================

alter table public.work_orders add column if not exists approved_at timestamptz;
alter table public.work_orders add column if not exists approved_by uuid references public.profiles(id) on delete set null;

create or replace function public.wo_approval_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare staff_user boolean := auth.uid() is not null and not public.is_admin();
begin
  if tg_op = 'INSERT' then
    if staff_user and new.pm_schedule_id is null and new.compliance_requirement_id is null then
      -- Requests from GMs and techs wait for an admin, who picks the tech or vendor.
      new.status := 'requested';
      new.assigned_tech_id := null;
      new.vendor_id := null;
      new.scheduled_date := null;
      new.scheduled_start := null;
      new.approved_at := null;
      new.approved_by := null;
    elsif new.status <> 'requested' then
      new.approved_at := coalesce(new.approved_at, now());
      new.approved_by := coalesce(new.approved_by, auth.uid());
    end if;
    return new;
  end if;

  if staff_user then
    -- Only admins assign; approval stamps can't be edited by anyone else.
    if new.assigned_tech_id is distinct from old.assigned_tech_id or new.vendor_id is distinct from old.vendor_id then
      raise exception 'Only an admin can assign work orders to a technician or vendor';
    end if;
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
  end if;

  if old.status = 'requested' then
    if staff_user then
      if new.status not in ('requested', 'cancelled')
         or (new.status = 'cancelled' and old.requested_by is distinct from auth.uid())
         or new.assigned_tech_id is distinct from old.assigned_tech_id
         or new.vendor_id is distinct from old.vendor_id
         or new.scheduled_date is distinct from old.scheduled_date then
        raise exception 'This work order is waiting for approval by an admin';
      end if;
    else
      -- An admin assigning a tech or vendor approves it.
      if new.status = 'requested' and (new.assigned_tech_id is not null or new.vendor_id is not null) then
        new.status := 'new';  -- wo_before_update then moves it to 'assigned'
      end if;
      if new.status not in ('requested', 'cancelled') then
        new.approved_at := now();
        new.approved_by := coalesce(auth.uid(), new.approved_by);
      end if;
    end if;
  elsif new.status = 'requested' then
    if staff_user then raise exception 'Only an admin can send a work order back for approval'; end if;
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end $$;
drop trigger if exists wo_approval_guard on public.work_orders;
create trigger wo_approval_guard before insert or update on public.work_orders
  for each row execute function public.wo_approval_guard();

-- No time can be logged on a work order that hasn't been approved.
drop trigger if exists time_entries_approval_guard on public.time_entries;
drop function if exists public.time_entries_approval_guard();
create or replace function public.time_entry_approval_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from work_orders where id = new.work_order_id and status = 'requested') then
    raise exception 'This work order is waiting for approval by an admin';
  end if;
  return new;
end $$;
drop trigger if exists time_entry_approval_guard on public.time_entries;
create trigger time_entry_approval_guard before insert on public.time_entries
  for each row execute function public.time_entry_approval_guard();

-- Vendors can't be sent a work order that hasn't been approved (admins approve by sending it).
create or replace function public.dispatch_approval_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from work_orders where id = new.work_order_id and status = 'requested') then
    raise exception 'This work order is waiting for approval by an admin';
  end if;
  return new;
end $$;
drop trigger if exists dispatch_approval_guard on public.vendor_dispatches;
create trigger dispatch_approval_guard before insert on public.vendor_dispatches
  for each row execute function public.dispatch_approval_guard();

revoke execute on function public.wo_approval_guard(), public.time_entry_approval_guard(), public.dispatch_approval_guard() from public, anon, authenticated;

-- Existing work: anything already past "new" was effectively approved.
update public.work_orders set approved_at = coalesce(approved_at, created_at)
 where status not in ('new', 'requested') and approved_at is null;
-- Unassigned requests from GMs and techs now wait for approval; ones admins created stay approved.
update public.work_orders w set status = 'requested'
 where w.status = 'new' and w.assigned_tech_id is null and w.vendor_id is null
   and exists (select 1 from public.profiles p where p.id = w.requested_by and p.role in ('manager', 'tech'));
update public.work_orders set approved_at = coalesce(approved_at, created_at)
 where status = 'new' and approved_at is null;
