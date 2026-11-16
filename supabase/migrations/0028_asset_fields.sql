-- =====================================================================
-- MaintenanceOS — More asset fields (for importing asset lists)
-- Run after 0027. Safe to re-run.
-- =====================================================================
alter table public.assets add column if not exists description   text;
alter table public.assets add column if not exists purchase_date date;
alter table public.assets add column if not exists service_date  date;
alter table public.assets add column if not exists parts         text;
