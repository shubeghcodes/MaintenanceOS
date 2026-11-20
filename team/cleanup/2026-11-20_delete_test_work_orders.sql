-- =====================================================================
-- ONE-OFF CLEANUP — delete the 21 test work orders (owner request, 2026-11-20)
--
-- NOT a migration. Never put this file in supabase/migrations/.
-- Run it ONCE, by hand, in the SQL editor, only when M-Brain says so and the
-- owner has approved running it on the project in question.
--
-- What it does, all in ONE transaction (any error = nothing changes):
--   0. Stops unless all 21 ids below exist. A second run therefore stops at
--      once with "already gone" and changes nothing.
--   1. Copies every row that will be deleted or changed into schema
--      archive_20261120, which no app role (anon / authenticated / service_role)
--      can read.
--   2. Moves each affected PM schedule's next due date back to the due date of
--      the PM work order being deleted, so the daily scheduler recreates a fresh
--      work order on its next run. Nothing else on the schedule changes.
--   3. Deletes the file records (attachments rows) for these work orders and
--      their receipts, then deletes the 21 work orders by explicit id. Their
--      history, time entries, labor totals, receipts, parts, checklist items and
--      vendor rows go with them (ON DELETE CASCADE). Links from tech shifts,
--      inbound emails, compliance records and lunch breaks are cleared
--      (ON DELETE SET NULL); those rows stay.
--   4. Stops unless exactly 21 work orders were deleted, and unless sites,
--      profiles, pm_schedules, vendors and companies still have the same counts.
--   5. Prints checks and the storage file paths.
--
-- NOT done here: files in the Storage bucket are NOT deleted. The last query
-- lists their paths; the owner can delete them from the dashboard later.
-- The archive schema stays until someone decides to drop it.
-- =====================================================================

begin;

-- ---------- the 21 work orders (explicit list; nothing else is touched) ----------
create temporary table _cleanup_ids (id uuid primary key) on commit drop;
insert into _cleanup_ids (id) values
  ('ecc51a23-be1c-403c-b8c4-61f07b787aa6'), ('ab4cdd29-6f3b-4c35-8d98-59c8229fa2fe'),
  ('98da6fed-2687-4606-9000-f9316ee71159'), ('26a60389-cce1-4286-915b-e6a07af12cd3'),
  ('e5d81a85-43fe-440f-9ab4-23288aed9b25'), ('3a7c1af2-2db3-4f3a-ad61-434017e1f3cc'),
  ('d9d54c36-c276-41b0-aa83-4c776f2e8edf'), ('949ed607-59cd-4ad6-955d-a22e3fa50727'),
  ('28d337b1-2d94-4747-9895-f223f9330fb0'), ('de1d61e6-f046-4929-aa31-46fbbcc67dc3'),
  ('f5550fd8-ca5c-407c-8ffd-f69742c871cf'), ('907b7a9b-8203-4417-b0e8-6b1dcd2c71ae'),
  ('5b60fbd8-f530-425d-8638-e46e6acf181e'), ('5ba5f3c1-adb2-4215-a275-99a75215bef8'),
  ('d4f8e4de-f0ba-41f2-865d-ec9c617fb343'), ('a394583e-3a72-4bcc-a795-2e084f6abf58'),
  ('7f8b4258-2286-487d-a258-30beb5744398'), ('5d0c4b55-8dce-4d3a-b260-40e72d441021'),
  ('ea2d75b0-5c7a-418c-9961-51fef5a7bcfa'), ('729a16f7-efef-48e2-9710-ccd8c0792aaa'),
  ('dbb91512-4deb-4423-8a02-090a1b2cf9b7');

-- Row counts that must NOT change.
create temporary table _cleanup_before on commit drop as
select 'sites' as t, count(*) as n from public.sites
union all select 'profiles',     count(*) from public.profiles
union all select 'pm_schedules', count(*) from public.pm_schedules
union all select 'vendors',      count(*) from public.vendors
union all select 'companies',    count(*) from public.companies;

do $$
declare
  v_listed  int;
  v_found   int;
  v_missing text;
  v_deleted int;
  v_changed text;
begin
  -- ---------- 0. every id must exist ----------
  select count(*) into v_listed from _cleanup_ids;
  if v_listed <> 21 then
    raise exception 'Cleanup stopped: the id list has % ids, expected 21', v_listed;
  end if;
  select count(*) into v_found from public.work_orders w join _cleanup_ids c on c.id = w.id;
  if v_found <> 21 then
    select string_agg(c.id::text, ', ') into v_missing
      from _cleanup_ids c where not exists (select 1 from public.work_orders w where w.id = c.id);
    raise exception 'Cleanup stopped, nothing changed: % of 21 work orders found. Missing (already deleted?): %', v_found, v_missing;
  end if;
  if to_regnamespace('archive_20261120') is not null then
    raise exception 'Cleanup stopped, nothing changed: schema archive_20261120 already exists (has this run before?)';
  end if;

  -- ---------- 1. archive, locked away from the app ----------
  create schema archive_20261120;
  revoke all on schema archive_20261120 from public, anon, authenticated, service_role;

  create table archive_20261120.work_orders as
    select w.* from public.work_orders w where w.id in (select id from _cleanup_ids);
  create table archive_20261120.work_order_events as
    select e.* from public.work_order_events e where e.work_order_id in (select id from _cleanup_ids);
  create table archive_20261120.time_entries as
    select t.* from public.time_entries t where t.work_order_id in (select id from _cleanup_ids);
  create table archive_20261120.time_entry_costs as
    select t.* from public.time_entry_costs t where t.work_order_id in (select id from _cleanup_ids);
  create table archive_20261120.wo_labor_costs as
    select t.* from public.wo_labor_costs t where t.work_order_id in (select id from _cleanup_ids);
  create table archive_20261120.time_entry_audit as
    select t.* from public.time_entry_audit t where t.work_order_id in (select id from _cleanup_ids);
  create table archive_20261120.wo_purchases as
    select p.* from public.wo_purchases p where p.work_order_id in (select id from _cleanup_ids);
  create table archive_20261120.wo_parts as
    select p.* from public.wo_parts p where p.work_order_id in (select id from _cleanup_ids);
  -- checklist items on these jobs (deleted) and on other jobs that point here as a follow-up (link cleared)
  create table archive_20261120.wo_checklist_items as
    select i.* from public.wo_checklist_items i
     where i.work_order_id in (select id from _cleanup_ids) or i.followup_wo_id in (select id from _cleanup_ids);
  create table archive_20261120.vendor_dispatches as
    select d.* from public.vendor_dispatches d where d.work_order_id in (select id from _cleanup_ids);
  create table archive_20261120.approval_requests as
    select a.* from public.approval_requests a where a.work_order_id in (select id from _cleanup_ids);
  create table archive_20261120.vendor_invoices as
    select v.* from public.vendor_invoices v where v.work_order_id in (select id from _cleanup_ids);
  create table archive_20261120.vendor_quotes as
    select v.* from public.vendor_quotes v where v.work_order_id in (select id from _cleanup_ids);
  create table archive_20261120.vendor_cost_lines as
    select v.* from public.vendor_cost_lines v where v.work_order_id in (select id from _cleanup_ids);
  -- file records: on these work orders, and receipt photos filed under their purchases
  create table archive_20261120.attachments as
    select a.* from public.attachments a
     where (a.entity_type = 'work_order' and a.entity_id in (select id from _cleanup_ids))
        or (a.entity_type = 'purchase'   and a.entity_id in (select id from archive_20261120.wo_purchases));
  -- rows that stay but lose their link
  create table archive_20261120.tech_shifts as
    select s.* from public.tech_shifts s
     where s.first_work_order_id in (select id from _cleanup_ids) or s.last_work_order_id in (select id from _cleanup_ids);
  create table archive_20261120.tech_shift_breaks as
    select b.* from public.tech_shift_breaks b where b.paused_entry_id in (select id from archive_20261120.time_entries);
  create table archive_20261120.inbound_emails as
    select m.* from public.inbound_emails m
     where m.work_order_id in (select id from _cleanup_ids) or m.dispatch_id in (select id from archive_20261120.vendor_dispatches);
  create table archive_20261120.compliance_records as
    select r.* from public.compliance_records r where r.work_order_id in (select id from _cleanup_ids);
  -- schedules whose next due date is reset (full rows as they were)
  create table archive_20261120.pm_schedules as
    select s.* from public.pm_schedules s
     where s.id in (select w.pm_schedule_id from public.work_orders w
                     where w.id in (select id from _cleanup_ids) and w.pm_schedule_id is not null);

  -- belt and braces: no app role can touch the copies even if the schema were exposed
  revoke all on all tables in schema archive_20261120 from public, anon, authenticated, service_role;
  execute (select string_agg(format('alter table archive_20261120.%I enable row level security;', c.relname), ' ')
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'archive_20261120' and c.relkind = 'r');

  -- ---------- 2. PM schedules: due again on the deleted job's due date ----------
  -- The scheduler set due_at = (next_due_on + 17:00) Los Angeles time, then moved next_due_on on.
  -- Putting next_due_on back to that date makes the next scheduler run create a fresh work order.
  update public.pm_schedules s
     set next_due_on = d.due_on
    from (select w.pm_schedule_id, min((w.due_at at time zone 'America/Los_Angeles')::date) as due_on
            from public.work_orders w
           where w.id in (select id from _cleanup_ids) and w.pm_schedule_id is not null and w.due_at is not null
           group by w.pm_schedule_id) d
   where s.id = d.pm_schedule_id;

  -- ---------- 3. delete ----------
  delete from public.attachments a
   where a.id in (select id from archive_20261120.attachments);

  delete from public.work_orders w where w.id in (select id from _cleanup_ids);
  get diagnostics v_deleted = row_count;
  if v_deleted <> 21 then
    raise exception 'Cleanup stopped, nothing changed: % work orders would be deleted, expected exactly 21', v_deleted;
  end if;

  -- ---------- 4. nothing else may have moved ----------
  select string_agg(b.t || ' ' || b.n || '→' || a.n, ', ') into v_changed
    from _cleanup_before b
    join (select 'sites' as t, count(*) as n from public.sites
          union all select 'profiles',     count(*) from public.profiles
          union all select 'pm_schedules', count(*) from public.pm_schedules
          union all select 'vendors',      count(*) from public.vendors
          union all select 'companies',    count(*) from public.companies) a on a.t = b.t
   where a.n <> b.n;
  if v_changed is not null then
    raise exception 'Cleanup stopped, nothing changed: other tables changed: %', v_changed;
  end if;
end $$;

-- ---------- 5. checks (read-only) ----------
-- a) must be 0
select count(*) as listed_ids_still_present
  from public.work_orders w where w.id in (select id from _cleanup_ids);

-- b) what was archived
select 'work_orders' as archived, count(*) from archive_20261120.work_orders
union all select 'work_order_events',  count(*) from archive_20261120.work_order_events
union all select 'time_entries',       count(*) from archive_20261120.time_entries
union all select 'time_entry_costs',   count(*) from archive_20261120.time_entry_costs
union all select 'wo_labor_costs',     count(*) from archive_20261120.wo_labor_costs
union all select 'time_entry_audit',   count(*) from archive_20261120.time_entry_audit
union all select 'wo_purchases',       count(*) from archive_20261120.wo_purchases
union all select 'wo_parts',           count(*) from archive_20261120.wo_parts
union all select 'wo_checklist_items', count(*) from archive_20261120.wo_checklist_items
union all select 'vendor_dispatches',  count(*) from archive_20261120.vendor_dispatches
union all select 'approval_requests',  count(*) from archive_20261120.approval_requests
union all select 'vendor_invoices',    count(*) from archive_20261120.vendor_invoices
union all select 'vendor_quotes',      count(*) from archive_20261120.vendor_quotes
union all select 'vendor_cost_lines',  count(*) from archive_20261120.vendor_cost_lines
union all select 'attachments',        count(*) from archive_20261120.attachments
union all select 'tech_shifts',        count(*) from archive_20261120.tech_shifts
union all select 'tech_shift_breaks',  count(*) from archive_20261120.tech_shift_breaks
union all select 'inbound_emails',     count(*) from archive_20261120.inbound_emails
union all select 'compliance_records', count(*) from archive_20261120.compliance_records
union all select 'pm_schedules',       count(*) from archive_20261120.pm_schedules;

-- c) tables that must be unchanged (before = after; the DO block already stopped on any difference)
select b.t as table_name, b.n as before, a.n as after
  from _cleanup_before b
  join (select 'sites' as t, count(*) as n from public.sites
        union all select 'profiles',     count(*) from public.profiles
        union all select 'pm_schedules', count(*) from public.pm_schedules
        union all select 'vendors',      count(*) from public.vendors
        union all select 'companies',    count(*) from public.companies) a on a.t = b.t
 order by 1;

-- d) PM schedules that were reset: old and new next due date
select a.id, a.title, a.next_due_on as was, s.next_due_on as now
  from archive_20261120.pm_schedules a join public.pm_schedules s on s.id = a.id;

-- e) Storage files NOT deleted (bucket "attachments"); the owner can remove these from the dashboard
select a.storage_path, a.file_name, a.size_bytes
  from archive_20261120.attachments a order by a.storage_path;

commit;
