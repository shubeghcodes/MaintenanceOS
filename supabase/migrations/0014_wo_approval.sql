-- =====================================================================
-- MaintenanceOS — Admin approval for work orders
-- Run after 0013. Safe to re-run.
--
-- Work orders submitted by GMs and techs start as 'requested' (Awaiting approval).
-- An admin or super admin approves them (optionally assigning a tech or vendor in
-- the same step) or rejects them (cancelled, with a reason). Work orders created by
-- admins, and PM / compliance work orders created by the scheduler, skip approval.
-- Only admins can assign or reassign a tech or vendor. Nobody can log time on a
-- request that hasn't been approved.
-- =====================================================================

alter type public.wo_status add value if not exists 'requested' before 'new';

alter table public.work_orders add column if not exists approved_by uuid references public.profiles(id) on delete set null;
alter table public.work_orders add column if not exists approved_at timestamptz;

-- Runs before wo_before_insert / wo_before_update (triggers fire in name order).
create or replace function public.wo_approval_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  adm boolean;
begin
  -- Server jobs, the scheduler and the vendor portal run without a signed-in user.
  if uid is null then return new; end if;
  adm := public.is_admin();

  if tg_op = 'INSERT' then
    if not adm and new.pm_schedule_id is null and new.compliance_requirement_id is null then
      new.status := 'requested';
      new.assigned_tech_id := null;
      new.vendor_id := null;
      new.scheduled_date := null;
      new.scheduled_start := null;
      new.approved_by := null;
      new.approved_at := null;
    elsif new.status::text <> 'requested' then
      new.approved_by := coalesce(new.approved_by, case when adm then uid end);
      new.approved_at := coalesce(new.approved_at, now());
    end if;
    return new;
  end if;

  -- UPDATE
  if not adm then
    if new.assigned_tech_id is distinct from old.assigned_tech_id or new.vendor_id is distinct from old.vendor_id then
      raise exception 'Only an admin can assign work orders to a technician or vendor';
    end if;
    if old.status::text = 'requested' and new.status::text not in ('requested', 'cancelled') then
      raise exception 'This request is waiting for admin approval';
    end if;
    if new.status::text = 'requested' and old.status::text <> 'requested' then
      raise exception 'Only an admin can send a work order back for approval';
    end if;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  elsif old.status::text = 'requested' and new.status::text not in ('requested', 'cancelled') then
    new.approved_by := uid;
    new.approved_at := now();
  end if;
  return new;
end $$;

drop trigger if exists wo_approval_guard on public.work_orders;
create trigger wo_approval_guard before insert or update on public.work_orders
  for each row execute function public.wo_approval_guard();

-- No time on a request until it's approved.
create or replace function public.time_entry_approval_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from work_orders where id = new.work_order_id and status::text = 'requested') then
    raise exception 'This request is waiting for admin approval';
  end if;
  return new;
end $$;
drop trigger if exists time_entry_approval_guard on public.time_entries;
create trigger time_entry_approval_guard before insert on public.time_entries
  for each row execute function public.time_entry_approval_guard();

revoke execute on function public.wo_approval_guard(), public.time_entry_approval_guard() from public, anon, authenticated;
