-- =====================================================================
-- PRACTICE COMPANY SEED — for the owner to click around in (Vercel Preview)
-- Target: the PRACTICE project etxnvsajapkcqqlpokyh ONLY.
-- Not a migration, not supabase/seed.sql. Safe to re-run: every step is an
-- upsert on fixed ids, so running it again just puts things back as below.
--
-- Safety catch: it stops unless the 4 practice logins (…@practice.test, made by
-- the owner in the practice dashboard) exist, so it can't do anything on live.
-- Passwords and auth settings are never touched. All data here is made up.
-- =====================================================================

begin;

do $$
begin
  if (select count(*) from auth.users
       where (id, email) in (('ad1af769-bbe9-4d8c-83bf-8a1a2a56bb5b'::uuid, 'superadmin@practice.test'),
                             ('5ba516ac-dc71-4232-9a1f-e5072fcdc7a0'::uuid, 'admin@practice.test'),
                             ('fd1ca4e1-c5f0-4073-aea1-0b6a5e1e0295'::uuid, 'manager@practice.test'),
                             ('bda7fb52-cfaa-466b-a975-93f12dfa6f8a'::uuid, 'tech@practice.test'))) <> 4 then
    raise exception 'Stopped: the 4 practice logins are not all here. Is this the practice project?';
  end if;
end $$;

-- ---------- 1. people ----------
-- Profile rows normally come from the signup trigger; make any that are missing.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
 where u.id in ('ad1af769-bbe9-4d8c-83bf-8a1a2a56bb5b', '5ba516ac-dc71-4232-9a1f-e5072fcdc7a0',
                'fd1ca4e1-c5f0-4073-aea1-0b6a5e1e0295', 'bda7fb52-cfaa-466b-a975-93f12dfa6f8a')
on conflict (id) do nothing;

update public.profiles p
   set full_name = v.full_name, role = v.role::public.user_role, is_super = v.is_super, active = true, vendor_id = null
  from (values
    ('ad1af769-bbe9-4d8c-83bf-8a1a2a56bb5b'::uuid, 'Practice Super Admin', 'admin',   true),
    ('5ba516ac-dc71-4232-9a1f-e5072fcdc7a0'::uuid, 'Practice Admin',       'admin',   false),
    ('fd1ca4e1-c5f0-4073-aea1-0b6a5e1e0295'::uuid, 'Practice GM',          'manager', false),
    ('bda7fb52-cfaa-466b-a975-93f12dfa6f8a'::uuid, 'Practice Tech',        'tech',    false)
  ) as v(id, full_name, role, is_super)
 where p.id = v.id;

-- ---------- 2. company and stores ----------
insert into public.companies (id, name, legal_name, notes) values
  ('7a000000-0000-4000-8000-000000000001', 'Practice Co', 'Practice Co (made-up)', 'Practice data only')
on conflict (id) do update set name = excluded.name, legal_name = excluded.legal_name, notes = excluded.notes, active = true;

insert into public.sites (id, company_id, code, name, type, brand, address, city, state, zip, phone, notes) values
  ('7a000000-0000-4000-8000-000000000011', '7a000000-0000-4000-8000-000000000001', 'PS1', 'Practice Store 1', 'qsr',
   'Practice Brand', '100 Practice Way', 'Testville', 'CA', '00000', '555-0101', 'Practice data only'),
  ('7a000000-0000-4000-8000-000000000012', '7a000000-0000-4000-8000-000000000001', 'PS2', 'Practice Store 2', 'qsr',
   'Practice Brand', '200 Sample Street', 'Testville', 'CA', '00000', '555-0102', 'Practice data only')
on conflict (id) do update set company_id = excluded.company_id, code = excluded.code, name = excluded.name, type = excluded.type,
  brand = excluded.brand, address = excluded.address, city = excluded.city, state = excluded.state, zip = excluded.zip,
  phone = excluded.phone, notes = excluded.notes, active = true;

-- Admins: tied to Practice Co (the super admin sees every company anyway).
insert into public.admin_companies (user_id, company_id) values
  ('ad1af769-bbe9-4d8c-83bf-8a1a2a56bb5b', '7a000000-0000-4000-8000-000000000001'),
  ('5ba516ac-dc71-4232-9a1f-e5072fcdc7a0', '7a000000-0000-4000-8000-000000000001')
on conflict do nothing;

-- GM and tech: members of both stores.
insert into public.site_members (site_id, user_id) values
  ('7a000000-0000-4000-8000-000000000011', 'fd1ca4e1-c5f0-4073-aea1-0b6a5e1e0295'),
  ('7a000000-0000-4000-8000-000000000012', 'fd1ca4e1-c5f0-4073-aea1-0b6a5e1e0295'),
  ('7a000000-0000-4000-8000-000000000011', 'bda7fb52-cfaa-466b-a975-93f12dfa6f8a'),
  ('7a000000-0000-4000-8000-000000000012', 'bda7fb52-cfaa-466b-a975-93f12dfa6f8a')
on conflict do nothing;

-- ---------- 3. vendor, PM schedule, tech rate ----------
insert into public.vendors (id, name, trades, contact_name, email, phone, notes) values
  ('7a000000-0000-4000-8000-000000000021', 'Practice Vendor', array['HVAC', 'Plumbing'], 'Practice Contact',
   'vendor@practice.test', '555-0199', 'Practice data only')
on conflict (id) do update set name = excluded.name, trades = excluded.trades, contact_name = excluded.contact_name,
  email = excluded.email, phone = excluded.phone, notes = excluded.notes, active = true;

-- Monthly PM at Practice Store 1, done by the practice tech. First due in two weeks, so the
-- daily scheduler creates its work order about a week from the first run (lead time 7 days).
-- On a re-run the due date is left as the scheduler has moved it.
insert into public.pm_schedules (id, title, site_id, category, instructions, checklist, frequency_interval, frequency_unit,
                                 next_due_on, lead_days, priority, assigned_tech_id, estimated_hours) values
  ('7a000000-0000-4000-8000-000000000031', 'Practice: Monthly hood filter clean', '7a000000-0000-4000-8000-000000000011',
   'Kitchen', 'Practice PM. Pull, soak and refit the hood filters.', array['Pull filters', 'Soak and rinse', 'Refit and check'],
   1, 'month', current_date + 14, 7, 'medium', 'bda7fb52-cfaa-466b-a975-93f12dfa6f8a', 1.5)
on conflict (id) do update set title = excluded.title, site_id = excluded.site_id, category = excluded.category,
  instructions = excluded.instructions, checklist = excluded.checklist, frequency_interval = excluded.frequency_interval,
  frequency_unit = excluded.frequency_unit, lead_days = excluded.lead_days, priority = excluded.priority,
  assigned_tech_id = excluded.assigned_tech_id, vendor_id = null, estimated_hours = excluded.estimated_hours, active = true;

-- Hourly rate for the practice tech (super-admin-only data), so labor dollars show.
insert into public.tech_rates (user_id, hourly_rate, effective_from, note) values
  ('bda7fb52-cfaa-466b-a975-93f12dfa6f8a', 25.00, date '2026-01-01', 'Practice rate')
on conflict (user_id, effective_from) do update set hourly_rate = excluded.hourly_rate, note = excluded.note;

commit;

-- ---------- what exists now (read-only) ----------
select p.email, p.full_name, p.role, p.is_super, p.active,
       (select string_agg(c.name, ', ') from public.admin_companies ac join public.companies c on c.id = ac.company_id where ac.user_id = p.id) as admin_of,
       (select string_agg(s.name, ', ' order by s.name) from public.site_members m join public.sites s on s.id = m.site_id where m.user_id = p.id) as member_of,
       (select hourly_rate from public.tech_rates r where r.user_id = p.id order by effective_from desc limit 1) as rate
  from public.profiles p
 where p.email like '%@practice.test'
 order by p.email;
