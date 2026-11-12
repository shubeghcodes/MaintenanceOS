-- =====================================================================
-- Sample data — safe to skip in production. Replace with your real
-- sites, vendors and assets (or import via CSV in the Supabase table editor).
-- Compliance frequencies below are common defaults; confirm each one with
-- your local fire marshal, health department, landlord and insurer.
-- =====================================================================

-- Vendors
insert into public.vendors (id, name, trades, contact_name, phone, email, coi_expires_on, hourly_rate, rating) values
  ('a0000000-0000-0000-0000-000000000001', 'SoCal Hood & Fire',        '{Hood Cleaning,Fire Suppression,Fire Extinguishers}', 'Mike R.', '(714) 555-0101', 'dispatch@socalhood.example',  current_date + 200, 125, 5),
  ('a0000000-0000-0000-0000-000000000002', 'Arctic Air Refrigeration', '{Refrigeration,HVAC}',                                'Dana L.', '(714) 555-0144', 'service@arcticair.example',   current_date + 20,  145, 4),
  ('a0000000-0000-0000-0000-000000000003', 'Pacific Plumbing & Rooter','{Plumbing,Grease Trap,Backflow}',                     'Luis G.', '(562) 555-0199', 'jobs@pacificplumb.example',   current_date - 5,   135, 4),
  ('a0000000-0000-0000-0000-000000000004', 'Desert Pest Solutions',    '{Pest Control}',                                      'Kim T.',  '(702) 555-0122', 'office@desertpest.example',   current_date + 300, 85,  5),
  ('a0000000-0000-0000-0000-000000000005', 'Summit Elevator Co.',      '{Elevator}',                                          'Raj P.',  '(949) 555-0177', 'service@summitelev.example',  current_date + 120, 175, 4)
on conflict do nothing;

-- Sites
insert into public.sites (id, code, name, type, brand, address, city, state, zip, sq_ft) values
  ('b0000000-0000-0000-0000-000000000001', 'DT-101', 'Del Taco #101 – Fullerton',  'qsr',     'Del Taco', '100 N Harbor Blvd', 'Fullerton', 'CA', '92832', 2400),
  ('b0000000-0000-0000-0000-000000000002', 'DT-102', 'Del Taco #102 – Anaheim',    'qsr',     'Del Taco', '200 W Lincoln Ave', 'Anaheim',   'CA', '92805', 2600),
  ('b0000000-0000-0000-0000-000000000003', 'LV-01',  'Las Vegas Dine-In',          'dine_in', null,       '300 S Las Vegas Blvd', 'Las Vegas', 'NV', '89101', 5200),
  ('b0000000-0000-0000-0000-000000000004', 'CRE-01', 'Harbor Commerce Center',     'cre',     null,       '400 E Commonwealth Ave', 'Fullerton', 'CA', '92832', 38000)
on conflict do nothing;

-- Assets
insert into public.assets (id, site_id, name, tag, category, location_detail, manufacturer, model, serial_number, install_date, warranty_expires_on, purchase_cost, expected_life_years, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Walk-in Cooler',        'DT101-REF-01', 'Refrigeration', 'Back of house',  'Kolpak',    'KF7-0810',   'KP-88213',  '2019-04-10', '2024-04-10', 14500, 15, 'operational'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Fryer #1',              'DT101-CK-01',  'Cooking',       'Fry station',    'Frymaster', 'H55',        'FM-55123',  '2021-08-02', '2026-08-02', 9800,  10, 'needs_repair'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'RTU #1 (Dining)',       'DT101-HVAC-01','HVAC',          'Roof',           'Carrier',   '48FC-07',    'CR-1199',   '2016-06-15', null,         11200, 15, 'operational'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'Ice Machine',           'DT102-REF-02', 'Refrigeration', 'Drink station',  'Manitowoc', 'IYT0500A',   'MW-77341',  '2022-01-20', '2027-01-20', 6200,  8,  'down'),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', 'Kitchen Exhaust Hood',  'DT102-FLS-01', 'Fire/Life Safety','Line',         'CaptiveAire','ND-2',      'CA-22018',  '2018-03-01', null,         18000, 20, 'operational'),
  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000003', 'Combi Oven',            'LV-CK-01',     'Cooking',       'Hot line',       'Rational',  'iCombi Pro 10-1/1', 'RA-551', '2023-05-11', '2026-12-31', 21000, 12, 'operational'),
  ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000003', 'Dish Machine',          'LV-PLB-01',    'Plumbing',      'Dish pit',       'Hobart',    'AM16',       'HB-9921',   '2020-09-09', null,         12500, 10, 'operational'),
  ('c0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000004', 'Passenger Elevator',    'CRE-ELV-01',   'Building',      'Lobby',          'Otis',      'Gen2',       'OT-40012',  '2012-02-01', null,         95000, 25, 'operational'),
  ('c0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000004', 'Parking Lot Lighting',  'CRE-ELEC-01',  'Electrical',    'Lot',            null,        null,         null,        '2015-01-01', null,         22000, 15, 'needs_repair')
on conflict do nothing;

-- Preventive maintenance schedules
insert into public.pm_schedules (title, site_id, asset_id, category, instructions, checklist, frequency_interval, frequency_unit, next_due_on, lead_days, priority, vendor_id) values
  ('Walk-in cooler coil cleaning', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Refrigeration',
   'Clean condenser and evaporator coils; check door gaskets and temps.', '{Clean condenser coil,Clean evaporator coil,Inspect door gasket,Record box temp}', 3, 'month', current_date + 5, 7, 'medium', 'a0000000-0000-0000-0000-000000000002'),
  ('Fryer boil-out & thermostat calibration', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'Cooking',
   'Boil-out, inspect burners, calibrate thermostat.', '{Boil-out,Inspect burners,Calibrate thermostat}', 1, 'month', current_date + 12, 5, 'medium', null),
  ('RTU filter change & belt check', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'HVAC',
   'Replace filters, check belts and refrigerant pressures.', '{Replace filters,Inspect belts,Check pressures}', 3, 'month', current_date - 3, 7, 'medium', 'a0000000-0000-0000-0000-000000000002'),
  ('Ice machine descale & sanitize', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004', 'Refrigeration',
   'Descale and sanitize per manufacturer.', '{Descale,Sanitize,Replace water filter}', 6, 'month', current_date + 40, 10, 'low', 'a0000000-0000-0000-0000-000000000002'),
  ('Combi oven descale', 'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000006', 'Cooking',
   'Run descale cycle; inspect door seal.', '{}', 1, 'month', current_date + 20, 5, 'low', null);

-- Compliance requirements
insert into public.compliance_requirements (site_id, name, category, authority, frequency_interval, frequency_unit, last_completed_on, next_due_on, lead_days, vendor_id) values
  ('b0000000-0000-0000-0000-000000000001', 'Hood & duct cleaning',            'Fire/Life Safety', 'NFPA 96 / local fire dept.', 3, 'month', current_date - 80,  current_date + 10,  14, 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000001', 'Fire suppression system inspection','Fire/Life Safety', 'NFPA 17A',                  6, 'month', current_date - 190, current_date - 8,   21, 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000001', 'Fire extinguisher service',       'Fire/Life Safety', 'NFPA 10',                    1, 'year',  current_date - 300, current_date + 65,  21, 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000001', 'Grease interceptor pumping',      'Plumbing',         'City FOG program',           3, 'month', current_date - 85,  current_date + 5,   10, 'a0000000-0000-0000-0000-000000000003'),
  ('b0000000-0000-0000-0000-000000000001', 'Health permit renewal',           'Permits',          'County Health Dept.',        1, 'year',  current_date - 200, current_date + 165, 30, null),
  ('b0000000-0000-0000-0000-000000000002', 'Hood & duct cleaning',            'Fire/Life Safety', 'NFPA 96 / local fire dept.', 3, 'month', current_date - 95,  current_date - 4,   14, 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002', 'Backflow preventer test',         'Plumbing',         'Water district',             1, 'year',  current_date - 340, current_date + 25,  30, 'a0000000-0000-0000-0000-000000000003'),
  ('b0000000-0000-0000-0000-000000000003', 'Pest control service',            'Health/Sanitation','Health district',            1, 'month', current_date - 20,  current_date + 10,  5,  'a0000000-0000-0000-0000-000000000004'),
  ('b0000000-0000-0000-0000-000000000003', 'Fire suppression system inspection','Fire/Life Safety', 'NFPA 17A',                  6, 'month', current_date - 100, current_date + 80,  21, 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000004', 'Elevator certificate / inspection','Building',        'State elevator authority',   1, 'year',  current_date - 330, current_date + 35,  45, 'a0000000-0000-0000-0000-000000000005'),
  ('b0000000-0000-0000-0000-000000000004', 'Fire alarm annual inspection',    'Fire/Life Safety', 'NFPA 72',                    1, 'year',  current_date - 380, current_date - 15,  30, null);

-- Reactive work orders (requested_by is empty until real users exist)
insert into public.work_orders (site_id, asset_id, title, description, category, priority, status, type, vendor_id, labor_cost, parts_cost, vendor_invoice_amount, created_at, due_at, completed_at) values
  ('b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004', 'Ice machine not producing ice', 'Bin empty since open. Unit powers on, no harvest cycle.', 'Refrigeration', 'high', 'assigned', 'reactive', 'a0000000-0000-0000-0000-000000000002', 0, 0, 0, now() - interval '30 hours', now() - interval '6 hours', null),
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'Fryer #1 not holding temp', 'Drops to 300°F during rush.', 'Cooking', 'medium', 'in_progress', 'reactive', null, 0, 0, 0, now() - interval '2 days', now() + interval '1 day', null),
  ('b0000000-0000-0000-0000-000000000001', null, 'Drive-thru speaker static', 'Customers can''t hear order taker.', 'Electrical', 'high', 'new', 'reactive', null, 0, 0, 0, now() - interval '3 hours', now() + interval '21 hours', null),
  ('b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000007', 'Dish machine leaking at door', null, 'Plumbing', 'medium', 'completed', 'reactive', 'a0000000-0000-0000-0000-000000000003', 0, 85, 420, now() - interval '9 days', now() - interval '6 days', now() - interval '7 days'),
  ('b0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000009', 'Lot lights out – north row', '6 poles dark.', 'Electrical', 'medium', 'on_hold', 'reactive', null, 0, 0, 0, now() - interval '5 days', now() - interval '2 days', null),
  ('b0000000-0000-0000-0000-000000000002', null, 'Men''s restroom toilet clogged', null, 'Plumbing', 'emergency', 'completed', 'reactive', 'a0000000-0000-0000-0000-000000000003', 0, 0, 265, now() - interval '12 days', now() - interval '12 days' + interval '4 hours', now() - interval '12 days' + interval '3 hours'),
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Walk-in reading 44°F', 'Product moved to reach-ins.', 'Refrigeration', 'emergency', 'completed', 'reactive', 'a0000000-0000-0000-0000-000000000002', 0, 310, 690, now() - interval '20 days', now() - interval '20 days' + interval '4 hours', now() - interval '20 days' + interval '5 hours');

-- Create PM and compliance work orders that are already within their lead window.
select public.generate_due_work_orders();
