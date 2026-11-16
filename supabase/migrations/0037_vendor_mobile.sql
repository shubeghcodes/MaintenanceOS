-- MaintenanceOS — vendors get a mobile number (phone = office). Run after 0036. Safe to re-run.
alter table public.vendors add column if not exists mobile_phone text;
