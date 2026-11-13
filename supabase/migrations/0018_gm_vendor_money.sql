-- =====================================================================
-- MaintenanceOS — GMs don't see vendor money
-- Run after 0017. Safe to re-run.
--
-- Store / property managers (GMs) still see which vendor has a job, their
-- contact info and progress, but not quotes, itemized vendor costs,
-- invoices, additional-work amounts, or those documents and history entries.
-- Admins and techs are unchanged; vendor logins still see only their own.
-- =====================================================================

drop policy if exists quotes_select on public.vendor_quotes;
create policy quotes_select on public.vendor_quotes for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id)
         and (public.my_role() in ('admin', 'tech') or (public.my_role() = 'vendor' and vendor_id = public.my_vendor_id())));

drop policy if exists cost_lines_select on public.vendor_cost_lines;
create policy cost_lines_select on public.vendor_cost_lines for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id)
         and (public.my_role() in ('admin', 'tech') or (public.my_role() = 'vendor' and vendor_id = public.my_vendor_id())));

drop policy if exists invoices_select on public.vendor_invoices;
create policy invoices_select on public.vendor_invoices for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id)
         and (public.my_role() in ('admin', 'tech') or (public.my_role() = 'vendor' and vendor_id = public.my_vendor_id())));

drop policy if exists approvals_select on public.approval_requests;
create policy approvals_select on public.approval_requests for select to authenticated
  using (public.my_role() <> 'manager' and exists (select 1 from public.vendor_dispatches d where d.id = dispatch_id));

-- History entries about quotes, invoices, vendor costs and extra-work amounts.
drop policy if exists woe_select on public.work_order_events;
create policy woe_select on public.work_order_events for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id)
         and not (public.my_role() = 'manager' and kind in ('quote', 'invoice', 'vendor_cost', 'approval')));

-- Invoice and quote documents and vendor cost receipts.
drop policy if exists att_select on public.attachments;
create policy att_select on public.attachments for select to authenticated
  using ((visibility = 'shared' or public.my_role() <> 'vendor')
     and not (public.my_role() = 'manager' and category in ('invoice', 'quote', 'vendor_receipt'))
     and (
         (entity_type = 'work_order' and exists (select 1 from public.work_orders w where w.id = entity_id))
      or (entity_type = 'asset'      and exists (select 1 from public.assets a where a.id = entity_id))
      or (entity_type = 'compliance' and exists (select 1 from public.compliance_requirements c where c.id = entity_id))));
