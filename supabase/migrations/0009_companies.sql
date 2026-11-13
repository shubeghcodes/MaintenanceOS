-- =====================================================================
-- MaintainOS — Companies (multiple corporations in one CMMS)
-- Run after 0008. Safe to re-run. Keeps all existing data: every existing
-- site is placed in one starting company ("My Company") that you can rename.
--
-- Every site belongs to a company. Work orders, assets, PM schedules and
-- compliance items carry the company of their site, kept in sync by triggers,
-- so the app can filter everything by company with one column.
-- =====================================================================

create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  legal_name  text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists companies_name_key on public.companies (lower(name));
drop trigger if exists companies_touch on public.companies;
create trigger companies_touch before update on public.companies for each row execute function public.touch_updated_at();

alter table public.companies enable row level security;
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated using (true);
drop policy if exists companies_admin on public.companies;
create policy companies_admin on public.companies for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant all on public.companies to authenticated, service_role;

-- ---------- Sites belong to a company ---------------------------------
alter table public.sites add column if not exists company_id uuid references public.companies(id) on delete restrict;
create index if not exists sites_company_idx on public.sites(company_id);

-- The company new sites go into when none is given (the oldest active one; created if there are none).
create or replace function public.default_company_id()
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select id into cid from companies where active order by created_at, name limit 1;
  if cid is null then select id into cid from companies order by created_at, name limit 1; end if;
  if cid is null then
    insert into companies (name) values ('My Company') returning id into cid;
  end if;
  return cid;
end $$;

-- Backfill existing sites.
update public.sites set company_id = public.default_company_id() where company_id is null;

create or replace function public.sites_default_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then new.company_id := public.default_company_id(); end if;
  return new;
end $$;
drop trigger if exists sites_default_company on public.sites;
create trigger sites_default_company before insert or update of company_id on public.sites
  for each row execute function public.sites_default_company();

alter table public.sites alter column company_id set not null;

-- ---------- Child records inherit the site's company ------------------
create or replace function public.set_company_from_site()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select company_id into new.company_id from sites where id = new.site_id;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['work_orders', 'assets', 'pm_schedules', 'compliance_requirements'] loop
    execute format('alter table public.%I add column if not exists company_id uuid references public.companies(id) on delete restrict', t);
    execute format('update public.%I x set company_id = s.company_id from public.sites s where s.id = x.site_id and x.company_id is distinct from s.company_id', t);
    execute format('create index if not exists %I on public.%I(company_id)', t || '_company_idx', t);
    execute format('drop trigger if exists %I on public.%I', t || '_set_company', t);
    execute format('create trigger %I before insert or update of site_id, company_id on public.%I for each row execute function public.set_company_from_site()', t || '_set_company', t);
  end loop;
end $$;

-- Moving a site to another company moves its records with it.
create or replace function public.sites_cascade_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update work_orders             set company_id = new.company_id where site_id = new.id;
  update assets                  set company_id = new.company_id where site_id = new.id;
  update pm_schedules            set company_id = new.company_id where site_id = new.id;
  update compliance_requirements set company_id = new.company_id where site_id = new.id;
  return null;
end $$;
drop trigger if exists sites_cascade_company on public.sites;
create trigger sites_cascade_company after update of company_id on public.sites
  for each row when (old.company_id is distinct from new.company_id)
  execute function public.sites_cascade_company();

-- These run only from triggers; don't expose them through the API.
revoke execute on function public.default_company_id(), public.sites_default_company(), public.set_company_from_site(), public.sites_cascade_company() from public, anon, authenticated;
