-- =====================================================================
-- MaintenanceOS — Super admin + company-scoped admins
-- Run after 0011. Safe to re-run.
--
-- Super admin (profiles.is_super, role 'admin'): everything. Only super admins can
--   manage companies, create/change admins and super admins, set hourly labor rates,
--   delete work orders and assets, and approve vendor invoices for payment.
-- Admin: day-to-day operations. Can be limited to some companies (admin_companies);
--   no rows there = all companies. Sees labor dollars and R&M for their companies.
-- The earliest active admin becomes the first super admin. There is always at least
-- one active super admin.
-- =====================================================================

alter table public.profiles add column if not exists is_super boolean not null default false;

create table if not exists public.admin_companies (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

update public.profiles set is_super = true
 where id = (select id from public.profiles where role = 'admin' and active order by created_at limit 1)
   and not exists (select 1 from public.profiles where is_super);

-- ---------- Helpers ----------------------------------------------------
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and is_super and active)
$$;

-- Admin who may act on this company (super admins and unrestricted admins: any company).
create or replace function public.admin_company_ok(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() and (
    public.is_super_admin()
    or not exists (select 1 from admin_companies where user_id = auth.uid())
    or exists (select 1 from admin_companies where user_id = auth.uid() and company_id = p_company))
$$;

create or replace function public.admin_site_ok(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.admin_company_ok((select company_id from sites where id = p_site))
$$;

-- Site access: admins only for their companies; everyone else by membership.
create or replace function public.is_site_member(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.admin_site_ok(p_site)
      or exists (select 1 from site_members m join profiles p on p.id = m.user_id
                  where m.site_id = p_site and m.user_id = auth.uid() and p.active and p.role <> 'vendor')
$$;

-- ---------- Policies ----------------------------------------------------
alter table public.admin_companies enable row level security;
drop policy if exists admin_companies_select on public.admin_companies;
create policy admin_companies_select on public.admin_companies for select to authenticated using (public.is_admin());
drop policy if exists admin_companies_super on public.admin_companies;
create policy admin_companies_super on public.admin_companies for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
grant all on public.admin_companies to authenticated, service_role;

-- Companies: limited admins only see theirs; only super admins change them.
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (public.my_role() <> 'admin' or public.admin_company_ok(id));
drop policy if exists companies_admin on public.companies;
create policy companies_admin on public.companies for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists sites_admin on public.sites;
create policy sites_admin on public.sites for all to authenticated
  using (public.admin_company_ok(company_id)) with check (public.admin_company_ok(company_id));

drop policy if exists members_admin on public.site_members;
create policy members_admin on public.site_members for all to authenticated
  using (public.admin_site_ok(site_id)) with check (public.admin_site_ok(site_id));

drop policy if exists assets_write on public.assets;
drop policy if exists assets_insert on public.assets;
drop policy if exists assets_update on public.assets;
drop policy if exists assets_delete on public.assets;
create policy assets_insert on public.assets for insert to authenticated
  with check (public.admin_site_ok(site_id) or (public.my_role() = 'tech' and public.is_site_member(site_id)));
create policy assets_update on public.assets for update to authenticated
  using (public.admin_site_ok(site_id) or (public.my_role() = 'tech' and public.is_site_member(site_id)))
  with check (public.admin_site_ok(site_id) or (public.my_role() = 'tech' and public.is_site_member(site_id)));
create policy assets_delete on public.assets for delete to authenticated using (public.is_super_admin());

drop policy if exists pm_admin on public.pm_schedules;
create policy pm_admin on public.pm_schedules for all to authenticated
  using (public.admin_site_ok(site_id)) with check (public.admin_site_ok(site_id));

drop policy if exists creq_admin on public.compliance_requirements;
create policy creq_admin on public.compliance_requirements for all to authenticated
  using (public.admin_site_ok(site_id)) with check (public.admin_site_ok(site_id));

drop policy if exists crec_admin on public.compliance_records;
create policy crec_admin on public.compliance_records for all to authenticated
  using (exists (select 1 from public.compliance_requirements r where r.id = requirement_id and public.admin_site_ok(r.site_id)))
  with check (exists (select 1 from public.compliance_requirements r where r.id = requirement_id and public.admin_site_ok(r.site_id)));

drop policy if exists wo_insert on public.work_orders;
create policy wo_insert on public.work_orders for insert to authenticated
  with check (public.admin_site_ok(site_id)
              or (public.my_role() in ('manager', 'tech') and public.is_site_member(site_id)));
drop policy if exists wo_delete on public.work_orders;
create policy wo_delete on public.work_orders for delete to authenticated using (public.is_super_admin());

drop policy if exists inbound_emails_admin on public.inbound_emails;
create policy inbound_emails_admin on public.inbound_emails for select to authenticated
  using (public.is_super_admin() or (work_order_id is not null and exists (select 1 from public.work_orders w where w.id = work_order_id)));

drop policy if exists invoices_review on public.vendor_invoices;
create policy invoices_review on public.vendor_invoices for update to authenticated
  using (public.is_admin() and exists (select 1 from public.work_orders w where w.id = work_order_id))
  with check (public.is_admin() and exists (select 1 from public.work_orders w where w.id = work_order_id));

-- Rates: super admin only. Labor dollars: admins, for work orders they can see.
drop policy if exists tech_rates_admin on public.tech_rates;
create policy tech_rates_admin on public.tech_rates for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists time_entry_costs_admin on public.time_entry_costs;
create policy time_entry_costs_admin on public.time_entry_costs for select to authenticated
  using (public.is_admin() and exists (select 1 from public.work_orders w where w.id = work_order_id));
drop policy if exists wo_labor_costs_admin on public.wo_labor_costs;
create policy wo_labor_costs_admin on public.wo_labor_costs for select to authenticated
  using (public.is_admin() and exists (select 1 from public.work_orders w where w.id = work_order_id));
drop policy if exists time_entry_audit_admin on public.time_entry_audit;
create policy time_entry_audit_admin on public.time_entry_audit for select to authenticated
  using (public.is_admin() and exists (select 1 from public.work_orders w where w.id = work_order_id));

-- ---------- Guards -------------------------------------------------------
-- Invoices: admins review; only super admins approve for payment or mark paid.
create or replace function public.invoices_approval_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and new.status in ('approved', 'paid') and new.status is distinct from old.status
     and not public.is_super_admin() then
    raise exception 'Only a super admin can approve invoices for payment';
  end if;
  return new;
end $$;
drop trigger if exists invoices_approval_guard on public.vendor_invoices;
create trigger invoices_approval_guard before update on public.vendor_invoices
  for each row execute function public.invoices_approval_guard();

-- Admins and super admins: only super admins create, change or remove them. Always one super admin left.
create or replace function public.profiles_admin_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    if new.is_super is distinct from old.is_super
       or (new.role = 'admin' and old.role is distinct from 'admin')
       or (old.role = 'admin' and old.id <> auth.uid()
           and (new.role is distinct from old.role or new.active is distinct from old.active or new.vendor_id is distinct from old.vendor_id)) then
      raise exception 'Only a super admin can add, change or remove admins';
    end if;
  end if;
  if new.is_super and new.role <> 'admin' then new.is_super := false; end if;
  if old.is_super and (not new.is_super or not new.active or new.role <> 'admin')
     and not exists (select 1 from profiles where is_super and active and role = 'admin' and id <> old.id) then
    raise exception 'There must always be at least one active super admin';
  end if;
  return new;
end $$;
drop trigger if exists profiles_admin_guard on public.profiles;
create trigger profiles_admin_guard before update on public.profiles
  for each row execute function public.profiles_admin_guard();

-- ---------- Time functions: admin powers limited to their companies ----------
create or replace function public.can_time_wo(p_wo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin', 'tech') and exists (
    select 1 from work_orders w where w.id = p_wo
      and (public.admin_site_ok(w.site_id) or w.assigned_tech_id = auth.uid() or public.is_site_member(w.site_id)))
$$;

create or replace function public.admin_for_wo(p_wo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.admin_site_ok((select site_id from work_orders where id = p_wo))
$$;

create or replace function public.timer_change(p_entry uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e time_entries; paused_wo integer;
begin
  select * into e from time_entries where id = p_entry for update;
  if not found then raise exception 'Timer not found'; end if;
  if e.user_id is distinct from auth.uid() and not public.admin_for_wo(e.work_order_id) then raise exception 'You can only change your own timer'; end if;
  if p_action = 'pause' and e.status = 'running' then
    update time_entries set status = 'paused', worked_seconds = public.entry_seconds_now(e), last_resumed_at = null,
                            pause_count = pause_count + 1 where id = e.id;
  elsif p_action = 'resume' and e.status = 'paused' then
    if e.user_id <> auth.uid() then raise exception 'Only the technician can resume their timer'; end if;
    if exists (select 1 from work_orders where id = e.work_order_id and status in ('completed', 'cancelled')) then
      raise exception 'Reopen the work order to log more time';
    end if;
    paused_wo := public.pause_my_other_timers(e.id);
    update time_entries set status = 'running', last_resumed_at = now() where id = e.id;
  elsif p_action = 'stop' and e.status in ('running', 'paused') then
    update time_entries set status = 'stopped', worked_seconds = public.entry_seconds_now(e), last_resumed_at = null, ended_at = now()
     where id = e.id;
    if e.user_id is distinct from auth.uid() then
      insert into time_entry_audit (entry_id, work_order_id, action, reason, before, changed_by)
      values (e.id, e.work_order_id, 'admin_stop', 'Stopped by admin', to_jsonb(e), auth.uid());
    end if;
  end if;
  return jsonb_build_object('entry_id', e.id, 'paused_wo', paused_wo);
end $$;

create or replace function public.time_entry_manual(p_wo uuid, p_user uuid, p_start timestamptz, p_end timestamptz, p_hours numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare w work_orders; secs integer; new_id uuid;
begin
  if not public.admin_for_wo(p_wo) then raise exception 'Only admins can add time manually'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for manual time'; end if;
  if p_end <= p_start then raise exception 'End time must be after start time'; end if;
  secs := coalesce(round(p_hours * 3600)::integer, extract(epoch from p_end - p_start)::integer);
  if secs <= 0 or secs > extract(epoch from p_end - p_start) + 1 then raise exception 'Hours must fit between the start and end time'; end if;
  if public.time_overlaps(p_user, p_start, p_end, null) then raise exception 'That time overlaps another entry for this technician'; end if;
  select * into w from work_orders where id = p_wo;
  if not found then raise exception 'Work order not found'; end if;
  insert into time_entries (work_order_id, user_id, visit, status, source, started_at, ended_at, worked_seconds, note, created_by)
  values (p_wo, p_user, w.visit, 'stopped', 'manual', p_start, p_end, secs, p_reason, auth.uid())
  returning id into new_id;
  insert into time_entry_audit (entry_id, work_order_id, action, reason, after, changed_by)
  select new_id, p_wo, 'manual_add', p_reason, to_jsonb(t), auth.uid() from time_entries t where t.id = new_id;
  return new_id;
end $$;

create or replace function public.time_entry_edit(p_entry uuid, p_start timestamptz, p_end timestamptz, p_hours numeric, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare e time_entries; secs integer;
begin
  select * into e from time_entries where id = p_entry for update;
  if not found then raise exception 'Entry not found'; end if;
  if not public.admin_for_wo(e.work_order_id) then raise exception 'Only admins can adjust time'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to adjust time'; end if;
  if e.status in ('running', 'paused') then raise exception 'Stop the timer before adjusting it'; end if;
  if e.status = 'void' then raise exception 'This entry was voided'; end if;
  if p_end <= p_start then raise exception 'End time must be after start time'; end if;
  secs := coalesce(round(p_hours * 3600)::integer, extract(epoch from p_end - p_start)::integer);
  if secs <= 0 or secs > extract(epoch from p_end - p_start) + 1 then raise exception 'Hours must fit between the start and end time'; end if;
  if public.time_overlaps(e.user_id, p_start, p_end, e.id) then raise exception 'That time overlaps another entry for this technician'; end if;
  update time_entries set started_at = p_start, ended_at = p_end, worked_seconds = secs where id = e.id;
  insert into time_entry_audit (entry_id, work_order_id, action, reason, before, after, changed_by)
  select e.id, e.work_order_id, 'edit', p_reason, to_jsonb(e), to_jsonb(t), auth.uid() from time_entries t where t.id = e.id;
end $$;

create or replace function public.time_entry_void(p_entry uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare e time_entries;
begin
  select * into e from time_entries where id = p_entry for update;
  if not found or e.status = 'void' then return; end if;
  if not public.admin_for_wo(e.work_order_id) then raise exception 'Only admins can void time'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to void time'; end if;
  update time_entries set status = 'void', worked_seconds = public.entry_seconds_now(e), last_resumed_at = null,
                          ended_at = coalesce(ended_at, now()) where id = e.id;
  insert into time_entry_audit (entry_id, work_order_id, action, reason, before, changed_by)
  values (e.id, e.work_order_id, 'void', p_reason, to_jsonb(e), auth.uid());
end $$;

-- ---------- Function grants ----------------------------------------------
revoke execute on function public.invoices_approval_guard(), public.profiles_admin_guard() from public, anon, authenticated;
revoke execute on function public.is_super_admin(), public.admin_company_ok(uuid), public.admin_site_ok(uuid), public.admin_for_wo(uuid) from public, anon;
grant execute on function public.is_super_admin(), public.admin_company_ok(uuid), public.admin_site_ok(uuid), public.admin_for_wo(uuid) to authenticated;
