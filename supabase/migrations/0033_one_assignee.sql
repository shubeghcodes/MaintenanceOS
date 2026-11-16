-- =====================================================================
-- MaintenanceOS — A job goes to a technician OR a vendor, never both
-- Run after 0032. Safe to re-run.
-- Switching an existing work order (or PM schedule) to a vendor takes it off the tech, and vice versa.
-- Setting both at once is refused.
-- =====================================================================
create or replace function public.one_assignee()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.assigned_tech_id is not null and new.vendor_id is not null then
    if tg_op = 'UPDATE' and new.vendor_id is distinct from old.vendor_id and new.assigned_tech_id is not distinct from old.assigned_tech_id then
      new.assigned_tech_id := null;        -- sent to a vendor: off the tech
    elsif tg_op = 'UPDATE' and new.assigned_tech_id is distinct from old.assigned_tech_id and new.vendor_id is not distinct from old.vendor_id then
      new.vendor_id := null;               -- given to a tech: off the vendor
    else
      raise exception 'Assign a technician or a vendor, not both';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.one_assignee() from public, anon, authenticated;

-- Named to run before the other work order triggers (they run in name order).
drop trigger if exists wo_aa_one_assignee on public.work_orders;
create trigger wo_aa_one_assignee before insert or update of assigned_tech_id, vendor_id on public.work_orders
  for each row execute function public.one_assignee();
drop trigger if exists pm_aa_one_assignee on public.pm_schedules;
create trigger pm_aa_one_assignee before insert or update of assigned_tech_id, vendor_id on public.pm_schedules
  for each row execute function public.one_assignee();

do $$ begin
  alter table public.work_orders add constraint work_orders_one_assignee check (assigned_tech_id is null or vendor_id is null);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pm_schedules add constraint pm_schedules_one_assignee check (assigned_tech_id is null or vendor_id is null);
exception when duplicate_object then null; end $$;
