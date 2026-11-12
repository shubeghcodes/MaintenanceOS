-- =====================================================================
-- MaintainOS — Receipts / purchases tied to work orders
-- Run after 0006. Safe to re-run.
-- =====================================================================

do $$ begin
  create type public.purchase_status as enum ('submitted', 'approved', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payment_method as enum ('company_card', 'store_account', 'petty_cash', 'personal', 'other');
exception when duplicate_object then null; end $$;

create table if not exists public.wo_purchases (
  id                   uuid primary key default gen_random_uuid(),
  work_order_id        uuid not null references public.work_orders(id) on delete cascade,
  store                text not null,                 -- Home Depot, Ferguson, parts counter…
  purchase_date        date not null default current_date,
  category             text not null default 'Parts',  -- Parts | Materials | Tools | Equipment rental | Supplies | Other
  description          text,
  subtotal             numeric(12,2),
  tax                  numeric(12,2),
  total                numeric(12,2) not null check (total >= 0),
  payment_method       public.payment_method not null default 'company_card',
  card_last4           text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  receipt_attachment_id uuid references public.attachments(id) on delete set null,
  status               public.purchase_status not null default 'submitted',
  review_note          text,
  reviewed_by          uuid references public.profiles(id) on delete set null,
  reviewed_at          timestamptz,
  reimbursable         boolean generated always as (payment_method = 'personal') stored,
  reimbursed_at        date,
  reimbursement_ref    text,
  purchased_by         uuid references public.profiles(id) on delete set null,
  client_key           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists wo_purchases_wo_idx on public.wo_purchases(work_order_id);
create index if not exists wo_purchases_date_idx on public.wo_purchases(purchase_date desc);
create unique index if not exists wo_purchases_client_key on public.wo_purchases(purchased_by, client_key) where client_key is not null;
drop trigger if exists wo_purchases_touch on public.wo_purchases;
create trigger wo_purchases_touch before update on public.wo_purchases for each row execute function public.touch_updated_at();

-- Receipts roll into the work order's cost (rejected receipts don't count).
alter table public.work_orders add column if not exists purchases_cost numeric(12,2) not null default 0;
alter table public.work_orders drop column if exists total_cost;
alter table public.work_orders add column total_cost numeric(12,2)
  generated always as (labor_cost + parts_cost + purchases_cost + vendor_invoice_amount) stored;

create or replace function public.wo_purchases_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_wo uuid := coalesce(new.work_order_id, old.work_order_id);
begin
  update work_orders
     set purchases_cost = coalesce((select sum(total) from wo_purchases where work_order_id = v_wo and status <> 'rejected'), 0)
   where id = v_wo;
  if tg_op = 'UPDATE' and new.work_order_id is distinct from old.work_order_id then
    update work_orders
       set purchases_cost = coalesce((select sum(total) from wo_purchases where work_order_id = old.work_order_id and status <> 'rejected'), 0)
     where id = old.work_order_id;
  end if;
  return null;
end $$;
drop trigger if exists wo_purchases_rollup on public.wo_purchases;
create trigger wo_purchases_rollup after insert or update or delete on public.wo_purchases
  for each row execute function public.wo_purchases_rollup();

-- Activity log entry for each receipt.
create or replace function public.wo_purchases_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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
drop trigger if exists wo_purchases_log on public.wo_purchases;
create trigger wo_purchases_log after insert or update on public.wo_purchases
  for each row execute function public.wo_purchases_log();

-- Security: staff and managers on the work order's site; vendors never see receipts.
alter table public.wo_purchases enable row level security;
drop policy if exists purchases_select on public.wo_purchases;
create policy purchases_select on public.wo_purchases for select to authenticated
  using (public.my_role() in ('admin', 'tech', 'manager') and exists (select 1 from public.work_orders w where w.id = work_order_id));
drop policy if exists purchases_insert on public.wo_purchases;
create policy purchases_insert on public.wo_purchases for insert to authenticated
  with check (purchased_by = auth.uid() and status = 'submitted' and reviewed_by is null and reimbursed_at is null
              and public.my_role() in ('admin', 'tech', 'manager')
              and exists (select 1 from public.work_orders w where w.id = work_order_id));
-- The person who added it can fix or delete it until it's reviewed; admins can always.
drop policy if exists purchases_update on public.wo_purchases;
create policy purchases_update on public.wo_purchases for update to authenticated
  using (public.is_admin() or (purchased_by = auth.uid() and status = 'submitted'))
  with check (public.is_admin() or (purchased_by = auth.uid() and status = 'submitted' and reimbursed_at is null));
drop policy if exists purchases_delete on public.wo_purchases;
create policy purchases_delete on public.wo_purchases for delete to authenticated
  using (public.is_admin() or (purchased_by = auth.uid() and status = 'submitted'));
