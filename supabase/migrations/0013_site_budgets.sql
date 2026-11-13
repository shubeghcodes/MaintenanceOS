-- =====================================================================
-- MaintainOS — Monthly R&M budgets per location
-- Run after 0012. Safe to re-run.
--
-- site_budgets        one default monthly amount per location
-- site_budget_months  optional amount for a specific month (overrides the default)
-- Only super admins set budgets. Everyone who can see a location (its admins,
-- managers and techs) can see its budget.
-- site_budget_status() returns budget vs. spent per location and month, where
-- spent is total R&M including internal labor. It never returns the labor part,
-- so managers and techs see the total without the labor detail.
-- =====================================================================

create table if not exists public.site_budgets (
  site_id        uuid primary key references public.sites(id) on delete cascade,
  monthly_amount numeric(12,2) not null check (monthly_amount >= 0),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);

create table if not exists public.site_budget_months (
  site_id    uuid not null references public.sites(id) on delete cascade,
  month      date not null check (extract(day from month) = 1),
  amount     numeric(12,2) not null check (amount >= 0),
  note       text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (site_id, month)
);

alter table public.site_budgets enable row level security;
alter table public.site_budget_months enable row level security;

drop policy if exists site_budgets_select on public.site_budgets;
create policy site_budgets_select on public.site_budgets for select to authenticated using (public.is_site_member(site_id));
drop policy if exists site_budgets_super on public.site_budgets;
create policy site_budgets_super on public.site_budgets for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists site_budget_months_select on public.site_budget_months;
create policy site_budget_months_select on public.site_budget_months for select to authenticated using (public.is_site_member(site_id));
drop policy if exists site_budget_months_super on public.site_budget_months;
create policy site_budget_months_super on public.site_budget_months for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

grant select, insert, update, delete on public.site_budgets, public.site_budget_months to authenticated;
grant all on public.site_budgets, public.site_budget_months to service_role;

-- Budget vs. spent (all R&M, labor included) for each month in [p_from, p_to] and each
-- location the caller can see. Optional p_site narrows to one location.
create or replace function public.site_budget_status(p_from date, p_to date, p_site uuid default null)
returns table (site_id uuid, month date, budget numeric, spent numeric, is_override boolean)
language sql stable security definer set search_path = public as $$
  with months as (
    select generate_series(date_trunc('month', p_from)::date,
                           date_trunc('month', least(p_to, p_from + interval '3 years'))::date,
                           interval '1 month')::date as m
  ),
  vis as (
    select s.id from sites s
     where (p_site is null or s.id = p_site)
       and auth.uid() is not null
       and public.is_site_member(s.id)
  ),
  spend as (
    select l.site_id, date_trunc('month', l.spent_on)::date as m, sum(l.amount) as amt from (
      select te.site_id, (te.started_at at time zone 'America/Los_Angeles')::date as spent_on, tc.labor_cost as amount
        from time_entries te join time_entry_costs tc on tc.entry_id = te.id
       where te.status <> 'void'
      union all
      select w.site_id, p.purchase_date, p.total
        from wo_purchases p join work_orders w on w.id = p.work_order_id
       where p.status <> 'rejected'
      union all
      select w.site_id, (coalesce(w.completed_at, w.created_at) at time zone 'America/Los_Angeles')::date,
             coalesce(w.parts_cost, 0) + coalesce(w.vendor_invoice_amount, 0) + coalesce(w.labor_cost, 0)
        from work_orders w where w.status <> 'cancelled'
    ) l
    where l.site_id in (select id from vis)
      and l.spent_on >= date_trunc('month', p_from)::date
      and l.spent_on < (date_trunc('month', p_to) + interval '1 month')::date
    group by 1, 2
  )
  select v.id, mo.m,
         coalesce(bm.amount, b.monthly_amount) as budget,
         coalesce(sp.amt, 0)::numeric(12,2) as spent,
         bm.amount is not null as is_override
    from vis v cross join months mo
    left join site_budgets b on b.site_id = v.id
    left join site_budget_months bm on bm.site_id = v.id and bm.month = mo.m
    left join spend sp on sp.site_id = v.id and sp.m = mo.m
$$;
revoke execute on function public.site_budget_status(date, date, uuid) from public, anon;
grant execute on function public.site_budget_status(date, date, uuid) to authenticated;
