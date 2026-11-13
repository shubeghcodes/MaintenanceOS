-- =====================================================================
-- MaintenanceOS — "Awaiting GM sign-off" work order status
-- Run after 0015, on its own (the new value must be committed before 0017
-- uses it). Safe to re-run.
-- =====================================================================
alter type public.wo_status add value if not exists 'awaiting_signoff' before 'completed';
