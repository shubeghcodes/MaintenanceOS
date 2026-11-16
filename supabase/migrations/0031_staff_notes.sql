-- =====================================================================
-- MaintenanceOS — Activity / Notes: staff-only notes
-- Run after 0030. Safe to re-run.
-- * work_order_events.staff_only: a note admins and techs can mark so the store's GMs don't see it
--   (pricing, vendor issues). GMs can't create staff-only notes.
-- * Emails from unrecognized senders are staff-only too.
-- =====================================================================
alter table public.work_order_events add column if not exists staff_only boolean not null default false;

drop policy if exists woe_select on public.work_order_events;
create policy woe_select on public.work_order_events for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id)
         and not (public.my_role() = 'manager' and (staff_only or kind in ('quote', 'invoice', 'vendor_cost', 'approval'))));

drop policy if exists woe_insert on public.work_order_events;
create policy woe_insert on public.work_order_events for insert to authenticated
  with check (user_id = auth.uid()
              and (not staff_only or public.my_role() in ('admin', 'tech'))
              and exists (select 1 from public.work_orders w where w.id = work_order_id));

update public.work_order_events set staff_only = true
 where kind = 'email_reply' and coalesce((meta ->> 'unverified')::boolean, false) and not staff_only;
