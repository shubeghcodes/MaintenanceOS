-- =====================================================================
-- MaintainOS — Vendor costs and quotes
-- Run after 0009. Safe to re-run.
--
-- vendor_cost_lines: costs a vendor itemizes on their work order link
--   (labor, materials, trip charge…), each with an optional receipt photo.
-- vendor_quotes: estimates a vendor sends for approval. Approving one sets the
--   work order's not-to-exceed to the quoted amount.
-- vendor_dispatches.quote_required: vendor must have an approved quote before
--   they can start work.
-- All writes from vendors go through the server (service role) on their link;
-- staff read them in the app and decide quotes.
-- =====================================================================

alter table public.vendor_dispatches add column if not exists quote_required boolean not null default false;

do $$ begin
  create type public.quote_status as enum ('submitted', 'approved', 'rejected', 'superseded');
exception when duplicate_object then null; end $$;

create table if not exists public.vendor_quotes (
  id                 uuid primary key default gen_random_uuid(),
  work_order_id      uuid not null references public.work_orders(id) on delete cascade,
  dispatch_id        uuid not null references public.vendor_dispatches(id) on delete cascade,
  vendor_id          uuid not null references public.vendors(id) on delete restrict,
  quote_number       text,
  amount             numeric(12,2) not null check (amount >= 0),
  scope              text not null,
  lines              jsonb not null default '[]'::jsonb,   -- [{category, description, quantity, unit_cost, amount}]
  valid_until        date,
  attachment_id      uuid references public.attachments(id) on delete set null,
  status             public.quote_status not null default 'submitted',
  version            integer not null default 1,
  submitted_by_label text,
  client_key         text,
  decided_by         uuid references public.profiles(id) on delete set null,
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists quotes_wo_idx on public.vendor_quotes(work_order_id, created_at desc);
create index if not exists quotes_status_idx on public.vendor_quotes(status);
create unique index if not exists quotes_client_key on public.vendor_quotes(dispatch_id, client_key) where client_key is not null;
drop trigger if exists quotes_touch on public.vendor_quotes;
create trigger quotes_touch before update on public.vendor_quotes for each row execute function public.touch_updated_at();

create table if not exists public.vendor_cost_lines (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders(id) on delete cascade,
  dispatch_id    uuid not null references public.vendor_dispatches(id) on delete cascade,
  vendor_id      uuid not null references public.vendors(id) on delete restrict,
  category       text not null default 'other' check (category in ('labor', 'materials', 'trip', 'equipment', 'other')),
  description    text not null,
  quantity       numeric(10,2) not null default 1 check (quantity > 0),
  unit_cost      numeric(12,2) not null check (unit_cost >= 0),
  amount         numeric(12,2) generated always as (round(quantity * unit_cost, 2)) stored,
  attachment_id  uuid references public.attachments(id) on delete set null,
  added_by_label text,
  client_key     text,
  created_at     timestamptz not null default now()
);
create index if not exists cost_lines_wo_idx on public.vendor_cost_lines(work_order_id, created_at);
create unique index if not exists cost_lines_client_key on public.vendor_cost_lines(dispatch_id, client_key) where client_key is not null;

-- ---------- RLS (same visibility as invoices) ----------
alter table public.vendor_quotes     enable row level security;
alter table public.vendor_cost_lines enable row level security;

drop policy if exists quotes_select on public.vendor_quotes;
create policy quotes_select on public.vendor_quotes for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id)
         and (public.my_role() <> 'vendor' or vendor_id = public.my_vendor_id()));
drop policy if exists quotes_decide on public.vendor_quotes;
create policy quotes_decide on public.vendor_quotes for update to authenticated
  using (public.my_role() in ('admin', 'tech') and exists (select 1 from public.work_orders w where w.id = work_order_id))
  with check (public.my_role() in ('admin', 'tech'));

drop policy if exists cost_lines_select on public.vendor_cost_lines;
create policy cost_lines_select on public.vendor_cost_lines for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id)
         and (public.my_role() <> 'vendor' or vendor_id = public.my_vendor_id()));

grant all on public.vendor_quotes, public.vendor_cost_lines to authenticated, service_role;
