-- =====================================================================
-- MaintainOS — Email replies land on the work order
-- Run after 0005. Safe to re-run.
-- =====================================================================

-- Every inbound email we receive (also de-duplicates webhook retries).
create table if not exists public.inbound_emails (
  id             uuid primary key default gen_random_uuid(),
  provider_id    text not null unique,          -- Resend email_id
  received_at    timestamptz not null default now(),
  from_address   text,
  to_address     text,
  subject        text,
  work_order_id  uuid references public.work_orders(id) on delete set null,
  dispatch_id    uuid references public.vendor_dispatches(id) on delete set null,
  outcome        text not null default 'processing', -- vendor_reply | staff_reply | internal_note | unverified | ignored | error
  detail         text,
  attachment_count integer not null default 0
);
create index if not exists inbound_emails_wo_idx on public.inbound_emails(work_order_id, received_at desc);

alter table public.inbound_emails enable row level security;
drop policy if exists inbound_emails_admin on public.inbound_emails;
create policy inbound_emails_admin on public.inbound_emails for select to authenticated
  using (public.is_admin() or (work_order_id is not null and exists (select 1 from public.work_orders w where w.id = work_order_id)));
