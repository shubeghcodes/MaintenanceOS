-- =====================================================================
-- MaintenanceOS — Parts flow into the job's cost automatically
-- Run after 0037. Safe to re-run.
-- When a part on a work order is marked ordered / bought (ready) / installed with a cost, a matching line is
-- added under Receipts & purchases (wo_purchases.part_id) so it counts once in Parts & materials.
-- The receipt photo is attached to that line later. Cost changes follow until the receipt is attached or reviewed;
-- cancelling the part removes a line that has no receipt yet.
-- =====================================================================
alter table public.wo_purchases add column if not exists part_id uuid references public.wo_parts(id) on delete set null;
create unique index if not exists wo_purchases_part_uq on public.wo_purchases (part_id) where part_id is not null;

create or replace function public.part_purchase_sync(p public.wo_parts)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total numeric := coalesce(p.cost, p.est_cost);
  v_desc text := p.name
    || case when p.quantity <> 1 then ' ×' || trim(to_char(p.quantity, 'FM9999990.##')) else '' end
    || coalesce(' · part # ' || nullif(p.part_number, ''), '')
    || coalesce(' · order # ' || nullif(p.order_ref, ''), '');
begin
  if p.status = 'cancelled' then
    delete from wo_purchases
     where part_id = p.id and receipt_attachment_id is null and status = 'submitted' and reimbursed_at is null;
    return;
  end if;
  if p.status not in ('ordered', 'ready', 'installed') or v_total is null then return; end if;

  if exists (select 1 from wo_purchases where part_id = p.id) then
    update wo_purchases
       set total = v_total, store = coalesce(nullif(trim(p.supplier), ''), store), description = v_desc
     where part_id = p.id and receipt_attachment_id is null and status = 'submitted' and reimbursed_at is null
       and (total, store, coalesce(description, '')) is distinct from (v_total, coalesce(nullif(trim(p.supplier), ''), store), v_desc);
  else
    insert into wo_purchases (kind, work_order_id, store, purchase_date, category, description, total, purchased_by, part_id)
    values ('part', p.work_order_id, coalesce(nullif(trim(p.supplier), ''), 'Supplier'),
            (coalesce(p.ordered_at, now()) at time zone 'America/Los_Angeles')::date,
            'Parts', v_desc, v_total, coalesce(p.ordered_by, auth.uid(), p.requested_by), p.id);
  end if;
end $$;
revoke execute on function public.part_purchase_sync(public.wo_parts) from public, anon, authenticated;

create or replace function public.wo_parts_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.part_purchase_sync(new);
  return null;
end $$;
revoke execute on function public.wo_parts_purchase() from public, anon, authenticated;
drop trigger if exists wo_parts_purchase on public.wo_parts;
create trigger wo_parts_purchase after insert or update on public.wo_parts
  for each row execute function public.wo_parts_purchase();

-- Activity log wording for those lines.
create or replace function public.wo_purchases_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.work_order_id is null then return null; end if;
  if tg_op = 'INSERT' then
    insert into work_order_events (work_order_id, user_id, kind, body)
    values (new.work_order_id, auth.uid(), 'purchase',
            case when new.part_id is not null then 'Part cost added (receipt needed): ' else 'Added receipt: ' end
            || new.store || ' $' || to_char(new.total, 'FM999,999,990.00') || coalesce(' (' || new.description || ')', ''));
  elsif tg_op = 'UPDATE' and new.receipt_attachment_id is not null and old.receipt_attachment_id is null and new.part_id is not null then
    insert into work_order_events (work_order_id, user_id, kind, body)
    values (new.work_order_id, auth.uid(), 'purchase', 'Receipt attached: ' || new.store || ' $' || to_char(new.total, 'FM999,999,990.00'));
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

-- Attach the receipt photo to an existing line (staff on the job; the photo must already be on this work order).
create or replace function public.purchase_attach_receipt(p_purchase uuid, p_attachment uuid, p_method public.payment_method default null, p_last4 text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r wo_purchases;
begin
  select * into r from wo_purchases where id = p_purchase for update;
  if not found or r.work_order_id is null then raise exception 'Receipt line not found'; end if;
  if public.my_role() not in ('admin', 'tech') or not exists (select 1 from work_orders w where w.id = r.work_order_id) then
    raise exception 'Not allowed';
  end if;
  if not exists (select 1 from attachments a where a.id = p_attachment and a.entity_type = 'work_order' and a.entity_id = r.work_order_id) then
    raise exception 'Upload the photo first';
  end if;
  if r.status <> 'submitted' and not public.is_admin() then raise exception 'This receipt was already reviewed'; end if;
  update wo_purchases
     set receipt_attachment_id = p_attachment,
         payment_method = coalesce(p_method, payment_method),
         card_last4 = case when coalesce(p_method, payment_method) = 'company_card' then coalesce(p_last4, card_last4) else null end
   where id = p_purchase;
end $$;
revoke execute on function public.purchase_attach_receipt(uuid, uuid, public.payment_method, text) from public, anon;

-- Parts already ordered before this change get their line now.
do $$ declare p wo_parts; begin
  for p in select * from wo_parts where status in ('ordered', 'ready', 'installed') loop
    perform public.part_purchase_sync(p);
  end loop;
end $$;
