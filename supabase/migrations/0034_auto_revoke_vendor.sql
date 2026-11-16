-- =====================================================================
-- MaintenanceOS — Take a job away from a vendor automatically
-- Run after 0033. Safe to re-run.
-- When a work order's vendor is removed or changed (e.g. switched to a technician), or the work order is
-- cancelled, the vendor's open job link is turned off and the activity log says so. The app emails the vendor.
-- Jobs the vendor already marked complete are left alone so they can still send their invoice.
-- =====================================================================
create or replace function public.wo_revoke_old_vendor()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_why text;
begin
  if old.vendor_id is not null and (new.vendor_id is distinct from old.vendor_id or (new.status = 'cancelled' and old.status <> 'cancelled')) then
    v_why := case
      when new.status = 'cancelled' and old.status <> 'cancelled' then 'work order cancelled'
      when new.assigned_tech_id is not null then 'reassigned to a technician'
      when new.vendor_id is not null then 'reassigned to another vendor'
      else 'vendor removed' end;
    for r in
      update vendor_dispatches d
         set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
       where d.work_order_id = new.id and d.vendor_id = old.vendor_id
         and d.status in ('sent', 'accepted', 'in_progress', 'pending_approval')
      returning d.id, (select name from vendors v where v.id = d.vendor_id) as vendor_name
    loop
      insert into work_order_events (work_order_id, user_id, kind, body)
      values (new.id, auth.uid(), 'dispatch', 'Cancelled ' || coalesce(r.vendor_name, 'the vendor') || '''s job (' || v_why || ')');
    end loop;
  end if;
  return new;
end $$;
revoke execute on function public.wo_revoke_old_vendor() from public, anon, authenticated;

drop trigger if exists wo_revoke_old_vendor on public.work_orders;
-- Fires on any update (the vendor can be cleared by the one-assignee trigger, not just by the update itself).
create trigger wo_revoke_old_vendor after update on public.work_orders
  for each row when (old.vendor_id is not null and (new.vendor_id is distinct from old.vendor_id or new.status is distinct from old.status))
  execute function public.wo_revoke_old_vendor();
