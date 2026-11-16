-- =====================================================================
-- MaintenanceOS — Vendor documents (certificate of insurance, W-9, license, contract)
-- Run after 0031. Safe to re-run.
-- Files belong to a vendor (attachments.entity_type = 'vendor'). Admins upload/delete; admins and techs view.
-- GMs and vendor logins never see them.
-- =====================================================================
alter table public.attachments drop constraint if exists attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check
  check (entity_type in ('work_order', 'asset', 'compliance', 'purchase', 'vendor'));

drop policy if exists att_select on public.attachments;
create policy att_select on public.attachments for select to authenticated
  using ((visibility = 'shared' or public.my_role() <> 'vendor')
     and not (public.my_role() = 'manager' and category in ('invoice', 'quote', 'vendor_receipt'))
     and (
         (entity_type = 'work_order' and exists (select 1 from public.work_orders w where w.id = entity_id))
      or (entity_type = 'asset'      and exists (select 1 from public.assets a where a.id = entity_id))
      or (entity_type = 'compliance' and exists (select 1 from public.compliance_requirements c where c.id = entity_id))
      or (entity_type = 'purchase'   and exists (select 1 from public.wo_purchases p where p.id = entity_id))
      or (entity_type = 'vendor'     and public.my_role() in ('admin', 'tech') and exists (select 1 from public.vendors v where v.id = entity_id))));

drop policy if exists att_insert on public.attachments;
create policy att_insert on public.attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and (
         (entity_type = 'work_order' and exists (select 1 from public.work_orders w where w.id = entity_id))
      or (entity_type = 'asset'      and exists (select 1 from public.assets a where a.id = entity_id))
      or (entity_type = 'compliance' and exists (select 1 from public.compliance_requirements c where c.id = entity_id))
      or (entity_type = 'purchase'   and exists (select 1 from public.wo_purchases p where p.id = entity_id))
      or (entity_type = 'vendor'     and public.is_admin() and exists (select 1 from public.vendors v where v.id = entity_id))));
