-- =====================================================================
-- MaintenanceOS — Parts tracking on work orders
-- Run after 0029. Safe to re-run.
-- Flow: requested → (approved, when over the company's limit) → ordered → ready → installed. Any open part can be cancelled.
-- * Techs request parts and can mark them ordered themselves when the cost is at or under the company's
--   approval limit (default $250); over it, an admin approves first. Admins can do everything.
-- * GMs see parts on their store's work orders (read-only). Vendors never see them.
-- * When the last outstanding part on an on-hold job is ready (or cancelled), the job comes off hold.
-- =====================================================================
alter table public.companies add column if not exists parts_approval_limit numeric(10,2) not null default 250;

create table if not exists public.wo_parts (
  id               uuid primary key default gen_random_uuid(),
  work_order_id    uuid not null references public.work_orders(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  part_number      text,
  quantity         numeric(10,2) not null default 1 check (quantity > 0),
  notes            text,
  supplier         text,
  link             text,
  est_cost         numeric(10,2) check (est_cost >= 0),
  cost             numeric(10,2) check (cost >= 0),
  order_ref        text,
  eta              date,
  ready_location   text check (ready_location in ('shop', 'store', 'supplier', 'other')),
  location_note    text,
  photo_id         uuid references public.attachments(id) on delete set null,
  status           text not null default 'requested'
                   check (status in ('requested', 'approved', 'ordered', 'ready', 'installed', 'cancelled')),
  cancel_reason    text,
  requested_by     uuid references public.profiles(id) on delete set null,
  requested_at     timestamptz not null default now(),
  approved_by      uuid references public.profiles(id) on delete set null,
  approved_at      timestamptz,
  ordered_by       uuid references public.profiles(id) on delete set null,
  ordered_at       timestamptz,
  ready_by         uuid references public.profiles(id) on delete set null,
  ready_at         timestamptz,
  installed_by     uuid references public.profiles(id) on delete set null,
  installed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists wo_parts_wo_idx on public.wo_parts (work_order_id);
create index if not exists wo_parts_open_idx on public.wo_parts (status) where status in ('requested', 'approved', 'ordered', 'ready');

-- The approval limit for a work order's company.
create or replace function public.parts_limit(p_wo uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select c.parts_approval_limit from work_orders w join companies c on c.id = w.company_id where w.id = p_wo), 250);
$$;

-- Who may move a part where, and the timestamps that go with each step.
create or replace function public.wo_parts_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_admin boolean := auth.uid() is null or public.is_admin();
  v_cost numeric;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'requested' and not v_admin then raise exception 'New parts start as requested'; end if;
    new.requested_by := coalesce(auth.uid(), new.requested_by);
    new.requested_at := now();
    return new;
  end if;

  new.updated_at := now();
  new.work_order_id := old.work_order_id;
  new.requested_by := old.requested_by;
  new.requested_at := old.requested_at;
  if old.status in ('installed', 'cancelled') and not v_admin then
    raise exception 'This part is closed';
  end if;
  if new.status = old.status then
    -- Details can be fixed until the part is closed; an approval covers the amount that was approved.
    if not v_admin and old.status = 'approved' then
      new.est_cost := old.est_cost;
    end if;
    return new;
  end if;

  -- Status changes
  if new.status = 'approved' then
    if not v_admin then raise exception 'Only an admin can approve a part'; end if;
    if old.status <> 'requested' then raise exception 'Only requested parts can be approved'; end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  elsif new.status = 'ordered' then
    if old.status not in ('requested', 'approved') then raise exception 'This part was already ordered'; end if;
    if not v_admin then
      v_cost := coalesce(new.cost, new.est_cost);
      if v_cost is null then raise exception 'Enter the cost to mark it ordered'; end if;
      if old.status = 'requested' and v_cost > public.parts_limit(new.work_order_id) then
        raise exception 'Over the % approval limit — an admin needs to approve it first', to_char(public.parts_limit(new.work_order_id), 'FM$999,990');
      end if;
      if old.status = 'approved' and old.est_cost is not null and v_cost > greatest(old.est_cost * 1.10, old.est_cost + 25) then
        raise exception 'Cost is well over what was approved — ask an admin to approve the new amount';
      end if;
    end if;
    new.ordered_by := auth.uid(); new.ordered_at := now();
  elsif new.status = 'ready' then
    if old.status not in ('ordered', 'requested', 'approved') then raise exception 'This part can''t be marked ready now'; end if;
    if old.status <> 'ordered' then
      -- Bought on the spot (e.g. at the supply house): same cost rules as ordering.
      if not v_admin then
        v_cost := coalesce(new.cost, new.est_cost);
        if v_cost is null then raise exception 'Enter the cost to mark it ready'; end if;
        if old.status = 'requested' and v_cost > public.parts_limit(new.work_order_id) then
          raise exception 'Over the % approval limit — an admin needs to approve it first', to_char(public.parts_limit(new.work_order_id), 'FM$999,990');
        end if;
      end if;
      new.ordered_by := coalesce(old.ordered_by, auth.uid()); new.ordered_at := coalesce(old.ordered_at, now());
    end if;
    new.ready_by := auth.uid(); new.ready_at := now();
  elsif new.status = 'installed' then
    if old.status not in ('ready', 'ordered') then raise exception 'Only parts that arrived can be marked installed'; end if;
    new.installed_by := auth.uid(); new.installed_at := now();
    new.ready_at := coalesce(old.ready_at, now());
  elsif new.status = 'cancelled' then
    if nullif(trim(coalesce(new.cancel_reason, '')), '') is null then raise exception 'Give a reason for cancelling the part'; end if;
    if not v_admin and old.status not in ('requested', 'approved') then
      raise exception 'Only an admin can cancel a part that was already ordered';
    end if;
  elsif new.status = 'requested' then
    if not v_admin then raise exception 'Only an admin can reopen a part'; end if;
    new.approved_by := null; new.approved_at := null;
  end if;
  return new;
end $$;
drop trigger if exists wo_parts_guard on public.wo_parts;
create trigger wo_parts_guard before insert or update on public.wo_parts
  for each row execute function public.wo_parts_guard();

-- Activity log + take the job off hold when nothing is outstanding any more.
create or replace function public.wo_parts_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text;
  v_wo record;
begin
  if tg_op = 'INSERT' then
    v_label := 'Part requested: ' || new.name || case when new.quantity <> 1 then ' ×' || trim(to_char(new.quantity, 'FM9999990.##')) else '' end;
  elsif new.status is distinct from old.status then
    v_label := case new.status
      when 'approved'  then 'Part approved: '
      when 'ordered'   then 'Part ordered: '
      when 'ready'     then 'Part ready: '
      when 'installed' then 'Part installed: '
      when 'cancelled' then 'Part cancelled: '
      else 'Part reopened: ' end || new.name
      || case when new.status = 'ordered' and new.eta is not null then ' (arriving ' || to_char(new.eta, 'Mon FMDD') || ')' else '' end
      || case when new.status = 'cancelled' then ' — ' || new.cancel_reason else '' end;
  end if;
  if v_label is not null then
    insert into work_order_events (work_order_id, user_id, kind, body) values (new.work_order_id, auth.uid(), 'system', v_label);
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('ready', 'cancelled', 'installed') then
    select id, status, assigned_tech_id into v_wo from work_orders where id = new.work_order_id;
    if v_wo.status = 'on_hold'
       and not exists (select 1 from wo_parts p where p.work_order_id = new.work_order_id and p.status in ('requested', 'approved', 'ordered'))
       and exists (select 1 from wo_parts p where p.work_order_id = new.work_order_id and p.status in ('ready', 'installed')) then
      update work_orders set status = case when v_wo.assigned_tech_id is not null then 'assigned'::wo_status else 'new'::wo_status end
       where id = new.work_order_id;
      insert into work_order_events (work_order_id, user_id, kind, body)
      values (new.work_order_id, null, 'system', 'Parts are ready — taken off hold');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists wo_parts_after on public.wo_parts;
create trigger wo_parts_after after insert or update on public.wo_parts
  for each row execute function public.wo_parts_after();

-- Security: same people who see the work order (not vendors). Techs and admins add; GMs read only.
alter table public.wo_parts enable row level security;
drop policy if exists parts_select on public.wo_parts;
create policy parts_select on public.wo_parts for select to authenticated
  using (public.my_role() in ('admin', 'tech', 'manager') and exists (select 1 from public.work_orders w where w.id = work_order_id));
drop policy if exists parts_insert on public.wo_parts;
create policy parts_insert on public.wo_parts for insert to authenticated
  with check (public.my_role() in ('admin', 'tech') and exists (select 1 from public.work_orders w where w.id = work_order_id));
drop policy if exists parts_update on public.wo_parts;
create policy parts_update on public.wo_parts for update to authenticated
  using (public.my_role() in ('admin', 'tech') and exists (select 1 from public.work_orders w where w.id = work_order_id))
  with check (public.my_role() in ('admin', 'tech') and exists (select 1 from public.work_orders w where w.id = work_order_id));
drop policy if exists parts_delete on public.wo_parts;
create policy parts_delete on public.wo_parts for delete to authenticated
  using (public.is_admin() or (requested_by = auth.uid() and status = 'requested'));

grant all on public.wo_parts to authenticated, service_role;
revoke all on public.wo_parts from anon;

-- Same lockdown as 0023.
revoke execute on function public.wo_parts_guard(), public.wo_parts_after() from public, anon, authenticated;
revoke execute on function public.parts_limit(uuid) from public, anon;
