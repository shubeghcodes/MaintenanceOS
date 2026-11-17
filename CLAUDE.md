# CLAUDE.md — MaintenanceOS

Read this before changing anything. Full feature list and setup: `README.md`.

## What this is
Internal CMMS for QSR, dine-in and commercial real estate sites: work orders, preventive maintenance, compliance calendar, assets, vendors, receipts, time and labor, dispatch calendar, and a dashboard. Multi-company (one login can run several corporations).

## Stack
- Next.js 15 (App Router, server actions), TypeScript
- Supabase: Postgres, Auth, Storage, row-level security
- Tailwind CSS
- Email via Resend (`src/lib/email.ts` — `sendEmail()` is the only place to change provider)
- Deploys to Vercel; `vercel.json` runs one daily cron at 13:30 UTC (`/api/cron/daily`)

## Commands
- `npm install`
- `npm run dev` → http://localhost:3000
- `npm run build` — run before every PR; must pass
- Local env: `.env.local` (copy from `.env.example`). Never commit it.

## Non-negotiable rules
1. **Security lives in the database.** Roles are enforced by RLS policies and SQL functions, not just the UI. Any change that touches who can read or write data needs an RLS review and a test as each role (super admin, admin, manager, tech, vendor).
2. **Never apply a migration to production directly.** Add a new numbered file in `supabase/migrations/` (next free number after `0038`). Test it on a dev project or branch first. Do not edit an existing migration that may already have run.
3. **Every change goes through the sandbox before it goes live.** No exceptions, however small. The path is: feature branch → `npm run typecheck`, `node scripts/i18n-check.mjs` and `npm run build` pass → tested against the sandbox Supabase project (never production) → Vercel preview deploy checked → reviewed → the owner approves → merge to `main`. Pushing `main` deploys production, so never push or merge to `main` directly, and never point a test at the production database.
4. **Secrets stay out of code, commits, logs and prompts.** No Supabase service-role key, Resend key, `LINK_SIGNING_SECRET`, or `CRON_SECRET` in the repo.
5. **Vendor links are a security boundary.** Vendors see only their own job. Do not expose internal comments, labor or parts costs, other vendors' activity, invoices, or other sites on `app/v/[token]`.
6. **Labor dollars are admin-only.** Hourly rates are super-admin only. Techs and managers see hours, never labor dollars; managers never see vendor quotes or invoices.

## Roles (summary — README has the full table)
- **Super admin:** everything; companies; rates; budgets; delete WOs/assets; approve vendor invoices for payment.
- **Admin:** day-to-day setup, assignment, scheduling, approvals, reviews invoices (cannot approve payment).
- **Manager (GM):** their assigned sites only; submits requests; signs off finished work.
- **Tech:** assigned sites; status, costs, time, receipts, compliance logging.
- **Vendor:** only work orders dispatched to their company, via secure link (no login).

## Key business rules (live in the database)
- SLA due dates from priority: Emergency 4h, High 24h, Medium 3d, Low 7d.
- Work order flow: Needs approval → assigned → in progress → on hold → pending review → awaiting GM sign-off → completed. Only admins assign techs or vendors.
- Completing a compliance WO records the inspection, attaches the certificate, and rolls the next due date forward.
- `total_cost` is a generated column: labor + parts + vendor invoice.
- Store supplies and personal-card reimbursements never count toward R&M or location budgets.
- Dates display in `America/Los_Angeles` (`NEXT_PUBLIC_TIMEZONE`). `generate_due_work_orders()` has the timezone hard-coded too — change both if it moves.

## Migrations
Ordered files in `supabase/migrations/`, `0001`–`0038`. `0002` is optional (pg_cron). Run order matters: `0014` alone before `0015`; `0016` alone before `0017`. `0008_grants.sql` is required on newer Supabase projects. Keep every migration idempotent where possible.

## Conventions
- Server actions for writes; keep business logic in SQL functions/triggers when it must be enforced for every caller.
- Photos are shrunk in the browser before upload (Vercel body limit ~4.5 MB). Keep that.
- Files live in a private Storage bucket; show them through signed URLs (1 hour).
- Every status or assignment change must write to the audit trail.
- Keep UI mobile-friendly: techs and vendors use phones.

## Ask before doing
- Changing RLS policies, grants, or auth flows
- Deleting data or dropping columns/tables
- Changing email provider, cron schedule, or the link-signing scheme
- Anything that would apply SQL to production
