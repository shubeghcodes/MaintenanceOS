-- =====================================================================
-- MaintenanceOS — Store supplies purchases (not tied to a work order)
-- Smallwares, cleaning supplies, paper goods, uniforms… bought for a
-- location (or the shop / warehouse). Same review and reimbursement flow
-- as work-order receipts, but they never count toward R&M spend or budgets.
-- Run after 0021. Safe to re-run.
-- =====================================================================

alter table public.wo_purchases add column if not exists kind text not null default 'part';
alter table public.wo_purchases add column if not exists site_id uuid references public.sites(id) on delete set null;
alter table public.wo_purchases add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.wo_purchases alter column work_order_id drop not null;

do $$ begin
  alter table public.wo_purchases add constraint wo_purchases_kind_check check (kind in ('part', 'supply'));
exception when duplicate_object then null; end $$;
-- Work-order parts always have a work order; supplies never do and always have a company.
do $$ begin
  alter table public.wo_purchases add constraint wo_purchases_kind_shape check (
    (kind = 'part' and work_order_id is not null) or (kind = 'supply' and work_order_id is null and company_id is not null));
exception when duplicate_object then null; end $$;

create index if not exists wo_purchases_site_idx on public.wo_purchases(site_id);
create index if not exists wo_purchases_company_idx on public.wo_purchases(company_id);
create index if not exists wo_purchases_kind_idx on public.wo_purchases(kind, purchase_date desc);

-- Location and company: parts copy them from the work order; supplies at a
-- location take the company from the location.
create or replace function public.wo_purchases_place()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'part' then
    select w.site_id, w.company_id into new.site_id, new.company_id from work_orders w where w.id = new.work_order_id;
  elsif new.site_id is not null then
    select s.company_id into new.company_id from sites s where s.id = new.site_id;
  end if;
  return new;
end $$;
drop trigger if exists wo_purchases_place on public.wo_purchases;
create trigger wo_purchases_place before insert or update of kind, work_order_id, site_id, company_id on public.wo_purchases
  for each row execute function public.wo_purchases_place();

-- Keep parts in step if a work order moves to another location.
create or replace function public.wo_purchases_follow_wo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update wo_purchases set site_id = new.site_id, company_id = new.company_id where work_order_id = new.id;
  return null;
end $$;
drop trigger if exists wo_purchases_follow_wo on public.work_orders;
create trigger wo_purchases_follow_wo after update of site_id, company_id on public.work_orders
  for each row when (old.site_id is distinct from new.site_id or old.company_id is distinct from new.company_id)
  execute function public.wo_purchases_follow_wo();

update public.wo_purchases p set site_id = w.site_id, company_id = w.company_id
  from public.work_orders w
 where w.id = p.work_order_id and (p.site_id is distinct from w.site_id or p.company_id is distinct from w.company_id);

-- Work order history only for work-order receipts.
create or replace function public.wo_purchases_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.work_order_id is null then return null; end if;
  if tg_op = 'INSERT' then
    insert into work_order_events (work_order_id, user_id, kind, body)
    values (new.work_order_id, auth.uid(), 'purchase',
            'Added receipt: ' || new.store || ' $' || to_char(new.total, 'FM999,999,990.00') || coalesce(' (' || new.description || ')', ''));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into work_order_events (work_order_id, user_id, kind, body)
    values (new.work_order_id, auth.uid(), 'purchase',
            initcap(new.status::text) || ' receipt: ' || new.store || ' $' || to_char(new.total, 'FM999,999,990.00')
            || coalesce(' — ' || new.review_note, ''));
  elsif tg_op = 'UPDATE' and new.reimbursed_at is not null and old.reimbursed_at is null then
    insert into work_order_events (work_order_id, user_id, kind, body)
    values (new.work_order_id, auth.uid(), 'purchase',
            'Reimbursed receipt: ' || new.store || ' $' || to_char(new.total, 'FM999,999,990.00') || coalesce(' · ref ' || new.reimbursement_ref, ''));
  end if;
  return null;
end $$;

-- Rollup ignores supplies (no work order).
create or replace function public.wo_purchases_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_wo uuid := coalesce(new.work_order_id, old.work_order_id);
begin
  if v_wo is not null then
    update work_orders
       set purchases_cost = coalesce((select sum(total) from wo_purchases where work_order_id = v_wo and status <> 'rejected'), 0)
     where id = v_wo;
  end if;
  if tg_op = 'UPDATE' and old.work_order_id is not null and new.work_order_id is distinct from old.work_order_id then
    update work_orders
       set purchases_cost = coalesce((select sum(total) from wo_purchases where work_order_id = old.work_order_id and status <> 'rejected'), 0)
     where id = old.work_order_id;
  end if;
  return null;
end $$;

-- May this person log or see shop / warehouse supplies for this company?
-- Admins for their companies; techs who work at any location of the company.
create or replace function public.shop_company_ok(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.admin_company_ok(p_company)
      or (public.my_role() = 'tech' and exists (
            select 1 from site_members m join sites s on s.id = m.site_id
             where m.user_id = auth.uid() and s.company_id = p_company))
$$;
revoke execute on function public.wo_purchases_place(), public.wo_purchases_follow_wo() from public, anon, authenticated;
grant execute on function public.shop_company_ok(uuid) to authenticated;

-- ---------- Security ----------------------------------------------------
-- Parts: as before (anyone who can see the work order, never vendors).
-- Supplies at a location: that location's people and admins for its company.
-- Shop / warehouse supplies: admins for the company, techs of that company, and the buyer.
drop policy if exists purchases_select on public.wo_purchases;
create policy purchases_select on public.wo_purchases for select to authenticated
  using (public.my_role() in ('admin', 'tech', 'manager') and (
           (kind = 'part' and exists (select 1 from public.work_orders w where w.id = work_order_id))
        or (kind = 'supply' and (
               purchased_by = auth.uid()
            or (site_id is not null and public.is_site_member(site_id))
            or (site_id is null and public.shop_company_ok(company_id))))));

drop policy if exists purchases_insert on public.wo_purchases;
create policy purchases_insert on public.wo_purchases for insert to authenticated
  with check (purchased_by = auth.uid() and status = 'submitted' and reviewed_by is null and reimbursed_at is null
              and public.my_role() in ('admin', 'tech', 'manager')
              and (
                   (kind = 'part' and exists (select 1 from public.work_orders w where w.id = work_order_id))
                or (kind = 'supply' and site_id is not null and public.is_site_member(site_id))
                or (kind = 'supply' and site_id is null and public.shop_company_ok(company_id))));

-- Buyers can fix or delete until reviewed (but can't turn a receipt into another kind);
-- admins only within their companies.
drop policy if exists purchases_update on public.wo_purchases;
create policy purchases_update on public.wo_purchases for update to authenticated
  using (public.admin_company_ok(company_id) or (purchased_by = auth.uid() and status = 'submitted'))
  with check (public.admin_company_ok(company_id)
              or (purchased_by = auth.uid() and status = 'submitted' and reimbursed_at is null
                  and ((kind = 'part' and exists (select 1 from public.work_orders w where w.id = work_order_id))
                    or (kind = 'supply' and site_id is not null and public.is_site_member(site_id))
                    or (kind = 'supply' and site_id is null and public.shop_company_ok(company_id)))));
drop policy if exists purchases_delete on public.wo_purchases;
create policy purchases_delete on public.wo_purchases for delete to authenticated
  using (public.admin_company_ok(company_id) or (purchased_by = auth.uid() and status = 'submitted'));

-- ---------- Receipt photos for supplies ---------------------------------
-- Attachments may now belong to a purchase; they follow the purchase's visibility.
alter table public.attachments drop constraint if exists attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check
  check (entity_type in ('work_order', 'asset', 'compliance', 'purchase'));

drop policy if exists att_select on public.attachments;
create policy att_select on public.attachments for select to authenticated
  using ((visibility = 'shared' or public.my_role() <> 'vendor')
     and not (public.my_role() = 'manager' and category in ('invoice', 'quote', 'vendor_receipt'))
     and (
         (entity_type = 'work_order' and exists (select 1 from public.work_orders w where w.id = entity_id))
      or (entity_type = 'asset'      and exists (select 1 from public.assets a where a.id = entity_id))
      or (entity_type = 'compliance' and exists (select 1 from public.compliance_requirements c where c.id = entity_id))
      or (entity_type = 'purchase'   and exists (select 1 from public.wo_purchases p where p.id = entity_id))));

drop policy if exists att_insert on public.attachments;
create policy att_insert on public.attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and (
         (entity_type = 'work_order' and exists (select 1 from public.work_orders w where w.id = entity_id))
      or (entity_type = 'asset'      and exists (select 1 from public.assets a where a.id = entity_id))
      or (entity_type = 'compliance' and exists (select 1 from public.compliance_requirements c where c.id = entity_id))
      or (entity_type = 'purchase'   and exists (select 1 from public.wo_purchases p where p.id = entity_id))));
