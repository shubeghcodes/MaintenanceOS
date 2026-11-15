-- PM templates loaded from Store_maintenance_1.xlsx (QUARTERLY sheet). Safe to re-run: skips templates that already exist by name.

-- Photo rules: cleaning work = before & after; replacements and inspections = one photo.

with t as (
  insert into public.pm_templates (name, category, frequency_interval, frequency_unit, priority, lead_days)
  select 'Quarterly PM – HVAC', 'HVAC', 3, 'month', 'medium', 7
  where not exists (select 1 from public.pm_templates where name = 'Quarterly PM – HVAC')
  returning id
)
insert into public.pm_template_items (template_id, activity, description, photo_rule, position)
select t.id, v.activity, v.description, v.photo_rule, v.position from t, (values
  ('HVAC Unit Filters', 'Replace and date air conditioning return air filters with approved media.', 'single', 10),
  ('Blower Fan', 'Check and lubricate blower motor and shaft bearings etc., as required.', 'single', 20),
  ('Condenser/Evaporator Coils', 'Brush and wash down with water where conditions allow. Chemically clean twice per year minimum. Use fin tool to straighten when needed.', 'before_after', 30),
  ('Belts & Pulleys', 'Check/adjust pulleys, motor mounts and motor assemblies. Replace belts on as needed basis with PRIOR approval.', 'single', 40),
  ('Draft Inducer', 'In heating season, check draft inducer.', 'single', 50),
  ('Outside Air Filters/Dampers', 'Clean/repair outside damper filters. Clean with non-acidic cleaner. Replace with manufactured filters or equal. Don''t throw away filters. Ensure dampers are set at 20% minimum or to marked specifications.', 'before_after', 60),
  ('Refrigerant', 'Perform electronic leak check on all service ports, Schrader valves, evaporator/condenser coils, compressors and filter driers. Any leaks found should be communicated to manager. Repair all refrigerant leaks on time and material basis with prior approval.', 'single', 70),
  ('Compressors', 'Check A/C compressor crankcase heaters, amp draw and contactors.', 'single', 80),
  ('Heating System', 'Check heating system for proper operation Sep/Oct. Check clean ignitors and gas valve on package units, reversing valve on heat pump units.', 'single', 90),
  ('Electrical Controls', 'Ensure all electrical controls cover, panels & equipment are in place and secured. Add any missing screws. Check all connections/contactors.', 'single', 100),
  ('Thermostat Operations', 'Check for proper operations of all thermostats. Ensure unit goes into heat mode Sep/Oct, fan on, and cooling modes. Ensure thermostat program is set per customer''s predetermined protocols. Adjust as needed.', 'single', 110),
  ('Air Balance', 'Check for obvious building balance issues. If any symptoms of positive or negative envelope are present, note on inspection checklist and contact manager.', 'single', 120),
  ('Condensate Drains', 'In cooling season clean condensate drain & treat with non corrosive algaecide. Clean evaporator drain pan and drain lines with hot water.', 'before_after', 130),
  ('Access Panels', 'Ensure that all access panels, ducts & plenum joints, roof caps and curbs are properly secured.', 'single', 140),
  ('Debris', 'Ensure all HVAC related debris is removed from roof area.', 'before_after', 150),
  ('Demand Ventilation Systems', 'Ensure parameters of Electronic Configure To Order (ECTO, Lennox units) are set correctly at each unit. Ensure Outside Air Dampers (OAD''s) are not open all night; most units should be closed in unoccupied mode. Ensure fans are running and operating as designed. Check damper motor operation.', 'single', 160)
) as v(activity, description, photo_rule, position);

with t as (
  insert into public.pm_templates (name, category, frequency_interval, frequency_unit, priority, lead_days)
  select 'Quarterly PM – Ventilation (Exhaust & Make-up Air)', 'HVAC', 3, 'month', 'medium', 7
  where not exists (select 1 from public.pm_templates where name = 'Quarterly PM – Ventilation (Exhaust & Make-up Air)')
  returning id
)
insert into public.pm_template_items (template_id, activity, description, photo_rule, position)
select t.id, v.activity, v.description, v.photo_rule, v.position from t, (values
  ('Exhaust Fans Belts, Pulleys and Motors', 'Check/adjust belts and pulleys, motor mounts and motor assemblies. Replace belts quarterly.', 'single', 10),
  ('Exhaust Fans Bearings', 'Lubricate all bearings as needed.', 'single', 20),
  ('Exhaust Fans Blower Wheel', 'Ensure blower wheel is balanced.', 'single', 30),
  ('Exhaust Fans Overall Operation', 'Inspect for proper operation.', 'single', 40),
  ('Exhaust Fans Vibrations & Concerns', 'Inform management of any unusual vibration or damage. Check electrical connections and seal-tight.', 'single', 50),
  ('Make-up Air Units Belts, Pulleys and Motors', 'Check/adjust belts and pulleys, motor mounts and motor assemblies. Replace belts quarterly.', 'single', 60),
  ('Make-up Air Units Cooling Pads & Fresh Air Intake Filters', 'Clean cooling pads and/or Fresh Air Intake filters with water. Clean/repair outside air damper filters. Clean with non-acidic cleaner. Replace with manufacturer filters or equal with approval. Don''t throw away filters.', 'before_after', 70),
  ('Make-up Air Units Bearings', 'Lubricate all bearings as needed.', 'single', 80),
  ('Make-up Air Units Overall Operation', 'Inspect for proper operation.', 'single', 90),
  ('Make-up Air Units Water Sump', 'Remove water and clean sump minimum once per year.', 'before_after', 100)
) as v(activity, description, photo_rule, position);

with t as (
  insert into public.pm_templates (name, category, frequency_interval, frequency_unit, priority, lead_days)
  select 'Quarterly PM – Refrigeration', 'Refrigeration', 3, 'month', 'medium', 7
  where not exists (select 1 from public.pm_templates where name = 'Quarterly PM – Refrigeration')
  returning id
)
insert into public.pm_template_items (template_id, activity, description, photo_rule, position)
select t.id, v.activity, v.description, v.photo_rule, v.position from t, (values
  ('Evaporator/Condenser Coils', 'Clean coils with shop vac, brush, CO2 and/or hot water. Chemically clean at least twice per year with approved degreaser.', 'before_after', 10),
  ('Drain Pans/Drain Lines', 'Clean drain pans and drain lines with hot water and/or CO2. Repair/replace drain lines and pans as needed with prior approval.', 'before_after', 20),
  ('Condenser/Evaporator Fan Motors', 'Check fan motor blades, bearings, mounts and assemblies for proper operation condition.', 'single', 30),
  ('Electrical Components', 'Check all electrical connections, fuses, components for proper operation, condition and signs of age/degradation.', 'single', 40),
  ('Compressors', 'Check contactors and start components for signs of age/degradation.', 'single', 50),
  ('Refrigerant', 'Electronic leak check service ports, Schrader valves, evaporator/condenser coils, filter, drier and TXV. Check sight glass where applicable for proper charge.', 'single', 60),
  ('Thermostat', 'Check thermostat/temperature control for proper operation. Ensure control holds set parameters. Check operating temperature of unit.', 'single', 70),
  ('Defrost/Off Cycle/Time Clocks', 'Check time clocks for proper operation, off cycle times, mounting & electrical connections.', 'single', 80)
) as v(activity, description, photo_rule, position);

with t as (
  insert into public.pm_templates (name, category, frequency_interval, frequency_unit, priority, lead_days)
  select 'Quarterly PM – Ice Machines', 'Refrigeration', 3, 'month', 'medium', 7
  where not exists (select 1 from public.pm_templates where name = 'Quarterly PM – Ice Machines')
  returning id
)
insert into public.pm_template_items (template_id, activity, description, photo_rule, position)
select t.id, v.activity, v.description, v.photo_rule, v.position from t, (values
  ('Condenser Coils', 'Clean coils with shop vac, brush, CO2 and/or hot water. Chemically clean at least twice per year with approved degreaser.', 'before_after', 10),
  ('Evaporators', 'Brush and/or use hot water to clean evaporators. Chemically clean at least twice per year or more where applicable.', 'before_after', 20),
  ('Water Distribution System', 'Brush and/or use hot water clean water distribution system. Chemically clean and sanitize at least twice per year or more where warranted.', 'before_after', 30),
  ('Electrical Components', 'Check all electrical connections, fuses, components for proper operation, condition and signs of age/degradation.', 'single', 40),
  ('Drain Pans/Drain Lines', 'Clean drain pans and drain lines with hot water and/or CO2. Repair/replace drain lines and pans as needed with prior approval.', 'before_after', 50),
  ('Compressors', 'Check contactors and start components for signs of age/degradation.', 'single', 60),
  ('Condenser/Evaporator Fan Motors', 'Check fan motor blades, bearings, mounts and assemblies for proper operation condition.', 'single', 70),
  ('Overall Operation', 'Time fill, harvest cycle to ensure proper operation per manufacturer''s specifications. Annotate any deficiencies.', 'single', 80),
  ('Filters', 'Replace ice machine filters with owner provided filters quarterly or as needed.', 'single', 90)
) as v(activity, description, photo_rule, position);
