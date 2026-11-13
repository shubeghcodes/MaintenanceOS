-- =====================================================================
-- MaintenanceOS — External vendor work orders (emailed secure links,
-- no-login vendor portal, approvals, invoices).
-- Run after 0001 and 0003. Safe to re-run.
-- =====================================================================

-- ---------- New work order statuses -------------------------------------
-- pending_approval: vendor asked for approval of extra work/expense
-- pending_review:   vendor marked work complete; management reviews then closes (= completed)
alter type public.wo_status add value if not exists 'pending_approval' before 'completed';
alter type public.wo_status add value if not exists 'pending_review' before 'completed';

do $$ begin
  create type public.dispatch_status as enum
    ('sent', 'accepted', 'declined', 'in_progress', 'pending_approval', 'work_completed', 'closed', 'revoked');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.invoice_status as enum ('submitted', 'under_review', 'approved', 'rejected', 'paid');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.approval_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------- Activity log: who did it, and can the vendor see it ----------
alter table public.work_order_events
  add column if not exists actor_type  text,          -- user | vendor | system
  add column if not exists actor_label text,          -- vendor contact name, etc.
  add column if not exists visibility  text not null default 'internal',  -- internal | shared
  add column if not exists meta        jsonb,
  add column if not exists client_key  text;          -- duplicate-submission guard
create unique index if not exists wo_events_client_key on public.work_order_events(work_order_id, client_key) where client_key is not null;

-- Fill actor + visibility automatically (vendor portal sets app.actor_* for the transaction).
create or replace function public.wo_events_defaults()
returns trigger language plpgsql as $$
begin
  if new.actor_type is null then
    new.actor_type := coalesce(nullif(current_setting('app.actor_type', true), ''),
                               case when new.user_id is not null or auth.uid() is not null then 'user' else 'system' end);
  end if;
  if new.actor_label is null then
    new.actor_label := nullif(current_setting('app.actor_label', true), '');
  end if;
  -- Status changes and creation notes are shared with the vendor; assignments/schedule stay internal.
  if new.kind in ('status') or (new.kind = 'system' and new.body = 'Request submitted') then
    new.visibility := 'shared';
  end if;
  return new;
end $$;
drop trigger if exists wo_events_defaults on public.work_order_events;
create trigger wo_events_defaults before insert on public.work_order_events
  for each row execute function public.wo_events_defaults();

-- ---------- Dispatches (one row per "Assign to External Vendor") ----------
create table if not exists public.vendor_dispatches (
  id               uuid primary key default gen_random_uuid(),
  work_order_id    uuid not null references public.work_orders(id) on delete cascade,
  vendor_id        uuid not null references public.vendors(id) on delete restrict,
  contact_name     text,
  contact_email    text not null,
  contact_phone    text,
  instructions     text,
  requested_by     date,
  token_hash       text not null unique,                 -- sha256 of the link token; the token itself is never stored
  token_version    integer not null default 1,           -- bump to invalidate the old link (renew)
  token_expires_at timestamptz not null,
  status           public.dispatch_status not null default 'sent',
  email_status     text not null default 'pending',      -- pending | sent | failed | not_configured
  email_error      text,
  sent_at          timestamptz,
  last_emailed_at  timestamptz,
  last_reminded_at timestamptz,
  last_viewed_at   timestamptz,
  view_count       integer not null default 0,
  accepted_at      timestamptz,
  declined_at      timestamptz,
  decline_reason   text,
  started_at       timestamptz,
  completed_at     timestamptz,
  completion_notes text,
  closed_at        timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid references public.profiles(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.vendor_dispatches add column if not exists token_version integer not null default 1;
create index if not exists dispatch_wo_idx on public.vendor_dispatches(work_order_id, created_at desc);
create index if not exists dispatch_vendor_idx on public.vendor_dispatches(vendor_id);
-- Only one live dispatch per work order.
create unique index if not exists dispatch_one_active on public.vendor_dispatches(work_order_id)
  where status not in ('declined', 'closed', 'revoked');
drop trigger if exists dispatch_touch on public.vendor_dispatches;
create trigger dispatch_touch before update on public.vendor_dispatches for each row execute function public.touch_updated_at();

-- ---------- Additional work / expense approvals ----------
create table if not exists public.approval_requests (
  id                 uuid primary key default gen_random_uuid(),
  dispatch_id        uuid not null references public.vendor_dispatches(id) on delete cascade,
  work_order_id      uuid not null references public.work_orders(id) on delete cascade,
  description        text not null,
  amount             numeric(12,2),
  status             public.approval_status not null default 'pending',
  requested_by_label text,
  decided_by         uuid references public.profiles(id) on delete set null,
  decided_at         timestamptz,
  decision_note      text,
  client_key         text,
  created_at         timestamptz not null default now()
);
create index if not exists approvals_wo_idx on public.approval_requests(work_order_id, created_at desc);
create unique index if not exists approvals_client_key on public.approval_requests(dispatch_id, client_key) where client_key is not null;

-- ---------- Attachments: category + internal-only + which dispatch ----------
alter table public.attachments
  add column if not exists category    text not null default 'photo',   -- photo | before | after | completion | invoice | document
  add column if not exists visibility  text not null default 'shared',  -- shared | internal
  add column if not exists dispatch_id uuid references public.vendor_dispatches(id) on delete set null,
  add column if not exists uploaded_by_label text;

-- ---------- Invoices ----------
create table if not exists public.vendor_invoices (
  id                 uuid primary key default gen_random_uuid(),
  work_order_id      uuid not null references public.work_orders(id) on delete cascade,
  dispatch_id        uuid references public.vendor_dispatches(id) on delete set null,
  vendor_id          uuid not null references public.vendors(id) on delete restrict,
  invoice_number     text not null,
  invoice_date       date not null,
  amount             numeric(12,2) not null check (amount >= 0),
  notes              text,
  status             public.invoice_status not null default 'submitted',
  attachment_id      uuid references public.attachments(id) on delete set null,
  version            integer not null default 1,
  submitted_by_label text,
  client_key         text,
  review_note        text,
  reviewed_by        uuid references public.profiles(id) on delete set null,
  reviewed_at        timestamptz,
  paid_at            date,
  payment_reference  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists invoices_wo_idx on public.vendor_invoices(work_order_id, created_at desc);
create index if not exists invoices_status_idx on public.vendor_invoices(status);
create unique index if not exists invoices_client_key on public.vendor_invoices(dispatch_id, client_key) where client_key is not null;
drop trigger if exists invoices_touch on public.vendor_invoices;
create trigger invoices_touch before update on public.vendor_invoices for each row execute function public.touch_updated_at();

-- Approved/paid invoice flows into the work order's cost.
create or replace function public.invoice_to_work_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved', 'paid') and (tg_op = 'INSERT' or old.status not in ('approved', 'paid')) then
    update work_orders set vendor_invoice_amount = new.amount, invoice_number = new.invoice_number where id = new.work_order_id;
  end if;
  return new;
end $$;
drop trigger if exists invoice_to_work_order on public.vendor_invoices;
create trigger invoice_to_work_order after insert or update on public.vendor_invoices
  for each row execute function public.invoice_to_work_order();

-- Closing the work order (status → completed) closes the active dispatch.
create or replace function public.wo_close_dispatch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    update vendor_dispatches set status = 'closed', closed_at = now()
     where work_order_id = new.id and status not in ('declined', 'closed', 'revoked');
  end if;
  return new;
end $$;
drop trigger if exists wo_close_dispatch on public.work_orders;
create trigger wo_close_dispatch after update on public.work_orders
  for each row execute function public.wo_close_dispatch();

-- ---------- Vendor portal write path (service role only) ----------
-- Lets the portal change a work order's status while recording the vendor as the actor in the activity log.
drop function if exists public.vendor_portal_set_status(uuid, public.wo_status, text, text);
create or replace function public.vendor_portal_set_status(
  p_work_order uuid, p_status public.wo_status, p_actor text,
  p_resolution text default null, p_clear_vendor boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.actor_type', 'vendor', true);
  perform set_config('app.actor_label', coalesce(p_actor, 'Vendor'), true);
  update work_orders
     set status = p_status,
         resolution_notes = coalesce(p_resolution, resolution_notes),
         vendor_id = case when p_clear_vendor then null else vendor_id end
   where id = p_work_order;
end $$;
revoke all on function public.vendor_portal_set_status(uuid, public.wo_status, text, text, boolean) from public, anon, authenticated;
grant execute on function public.vendor_portal_set_status(uuid, public.wo_status, text, text, boolean) to service_role;

-- ---------- RLS ----------
alter table public.vendor_dispatches enable row level security;
alter table public.approval_requests enable row level security;
alter table public.vendor_invoices   enable row level security;

drop policy if exists dispatch_select on public.vendor_dispatches;
create policy dispatch_select on public.vendor_dispatches for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id)
         and (public.my_role() <> 'vendor' or vendor_id = public.my_vendor_id()));
drop policy if exists dispatch_write on public.vendor_dispatches;
create policy dispatch_write on public.vendor_dispatches for all to authenticated
  using (public.my_role() in ('admin', 'tech') and exists (select 1 from public.work_orders w where w.id = work_order_id))
  with check (public.my_role() in ('admin', 'tech') and exists (select 1 from public.work_orders w where w.id = work_order_id));

drop policy if exists approvals_select on public.approval_requests;
create policy approvals_select on public.approval_requests for select to authenticated
  using (exists (select 1 from public.vendor_dispatches d where d.id = dispatch_id));
drop policy if exists approvals_write on public.approval_requests;
create policy approvals_write on public.approval_requests for update to authenticated
  using (public.my_role() in ('admin', 'tech') and exists (select 1 from public.work_orders w where w.id = work_order_id))
  with check (public.my_role() in ('admin', 'tech'));

drop policy if exists invoices_select on public.vendor_invoices;
create policy invoices_select on public.vendor_invoices for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id)
         and (public.my_role() <> 'vendor' or vendor_id = public.my_vendor_id()));
drop policy if exists invoices_review on public.vendor_invoices;
create policy invoices_review on public.vendor_invoices for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Internal-only attachments are hidden from in-app vendor logins too.
drop policy if exists att_select on public.attachments;
create policy att_select on public.attachments for select to authenticated
  using ((visibility = 'shared' or public.my_role() <> 'vendor') and (
         (entity_type = 'work_order' and exists (select 1 from public.work_orders w where w.id = entity_id))
      or (entity_type = 'asset'      and exists (select 1 from public.assets a where a.id = entity_id))
      or (entity_type = 'compliance' and exists (select 1 from public.compliance_requirements c where c.id = entity_id))));
