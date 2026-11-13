-- =====================================================================
-- MaintenanceOS — "Needs approval" work order status
-- Run after 0013, on its own (Postgres needs the new value committed before
-- 0015 can use it). Safe to re-run.
-- =====================================================================
alter type public.wo_status add value if not exists 'requested' before 'new';
