# MaintenanceOS — CMMS

Internal maintenance platform for QSR, dine-in and commercial real estate sites:
work orders, preventive maintenance, compliance, assets, vendors, and a live dashboard.

**Stack:** Next.js 15 (App Router, server actions) · Supabase (Postgres, Auth, Storage, row-level security) · Tailwind CSS.
Deploys to Vercel (or any Node host) in about 15 minutes.

---

## What's in it

| Module | What it does |
|---|---|
| **Companies** | Run several corporations from one login. **Select Company** at the top of the dashboard (and in the sidebar on every page) switches the whole app to that company's locations, work orders, PM, compliance, assets, vendor work and purchases. **All companies** shows everything combined, with a *By company* summary on the dashboard. Add, rename or deactivate companies on **Companies**; new locations are assigned to a company, and work orders, assets, PM schedules and compliance items take the company of their location automatically. Switching never changes data. |
| **Dashboard** | Locations, completed (30 days), open / overdue / emergency counts, PM on-time %, compliance overdue, R&M spend MTD, avg close time, "needs attention" queue, compliance due in 30 days, per-site rollup, upcoming PMs, equipment down. |
| **Work orders** | Request → **admin approval** → assign → in progress → on hold → done → **GM sign-off** → closed. Priority SLAs set due dates automatically (Emergency 4h, High 24h, Medium 3d, Low 7d). Tech and/or vendor assignment, NTE with over-limit warning, labor/parts/invoice costs, photos & PDFs, comments, and a full audit trail of every status and assignment change. Mobile-friendly request form with camera upload. |
| **Time & labor** | Techs **start, pause, resume and stop** a timer on any work order (from the work order or *My day*); the clock shows h:mm:ss. Several techs can time the same job independently, and starting a second timer pauses your first, so a tech never has two running. **Reopening** a completed work order makes the next time a separate *return visit*; earlier visits are never reset. Each entry records date, tech, start, end and hours (decimal in reports). Admins can add, adjust or void time with a required reason, kept in an **adjustment history**. |
| **Labor cost & R&M** | Each tech/admin has an **hourly rate with history** on *Users* (only super admins can see rates). Every entry is costed at the rate in effect on the day it was worked: *labor cost = hours × rate*, and a back-dated rate recalculates automatically. Work orders show a cost table (Internal technician labor with hours, Parts & materials, Outside vendor costs, Total R&M). Under **Analytics** (one sidebar item for admins, with tabs for R&M spending, Technician labor and Purchases; it opens on Purchases when receipts are waiting for review and shows a count), **R&M spending** breaks spend down by category, location, company, work order and month/quarter/year; **Technician labor** shows each tech's work orders, hours and labor cost with filters for tech, location, company and dates. The dashboard's R&M spend includes labor for admins. Techs and GMs see hours, never labor dollars. |
| **Schedule (dispatch calendar)** | Week and day views with a row per tech. Drag jobs from the *Unscheduled* list onto a tech and day, drag between techs/days to reassign or reschedule, drag back to unschedule. Shows hours booked per tech per day (flags over 8h), filter by tech, overdue and in-progress markers. Start times and estimated hours are set on the work order. |
| **My day (techs)** | Phone-first route view of a tech's jobs for the day in time order, with directions, call-site, one-tap *Start work*, and their other unscheduled assignments. Admins can view any tech's day. |
| **Schedule emails** | Every morning each tech gets an email of that day's jobs (time, site, address with map link, priority, est. hours) with buttons that open each job and their *My day* page in the app. Admins can also send or resend from the calendar: per tech in day view, or to all techs for any day. Sends are logged so the morning job never double-sends. |
| **Preventive maintenance** | Recurring schedules per asset or site (every N days/weeks/months/years) with checklists. The scheduler creates the work order *lead days* before it's due and never double-creates while one is open. On-time rate per schedule. |
| **Compliance calendar** | Month view of every compliance item at its due date, or its scheduled service date once one is set. Drag an item onto a day, or click it, to schedule: the vendor and their email fill in from the directory, and you can email them the work order right there. Rescheduling emails the new date on the vendor's existing link. A side list shows everything overdue or due within 60 days that has no date yet. |
| **Compliance certificates** | A *Completed & certificates* tab listing every completed inspection/service with its certificate file, certificate #, vendor, and **valid until** date. Statuses: Current / Expiring ≤30 days / Expired / Failed, plus a count of completions missing a certificate file. Filter by site, category or date, view the full history, and **Export CSV** for insurance, landlords or health inspectors. |
| **Compliance** | Hood cleaning, fire suppression, extinguishers, backflow, grease trap, pest, permits, elevator, fire alarm, etc. Overdue / due-soon / current status, history with pass/fail/conditional, certificate uploads. Completing a compliance work order (or logging a pass) rolls the next due date forward automatically. **One-click standard checklists** for QSR, dine-in and CRE sites. |
| **Receipts & purchases** | On any work order, techs, GMs and admins snap a receipt photo and log the store, total, category, what was bought and how it was paid (company card + last 4, store account, petty cash, or personal). Receipts roll straight into the work order's cost. Admins approve or reject (rejected ones drop out of the cost) and mark personal-card purchases reimbursed. The **Purchases** page lists every receipt with spend by site, category and store, a review queue, money owed to employees, receipts missing a photo, and **Export CSV** for accounting. Vendors never see receipts. |
| **Assets** | Equipment registry per site: make/model/serial, install date, warranty, purchase cost, expected life. Shows full WO history, 12-month repair spend, age vs. life, and flags repair-vs-replace when 12-month repairs exceed 50% of purchase cost. |
| **External vendor work orders** | **Assign to External Vendor** on any work order emails the job (location, store #, address, issue, priority, photos attached, special instructions) with a secure **View Work Order** link. **No vendor account needed.** From their phone, vendors accept/decline, start work (timestamped), post updates with before/after photos, materials and parts/visit needs, request approval for extra work, **send quotes/estimates for approval**, **itemize their costs** (labor, parts, trip charge, equipment, with receipt photos), mark complete, and submit invoices (with revisions) from the same link, now or later. You get an email for every vendor action, review approvals, completed work and invoices on the work order, and track everything on **Vendor work**. |
| **Email replies → work order** | Every vendor email has its own reply address for that work order. When a vendor hits Reply, their message (minus the quoted original) and any photos/PDFs are posted on the work order's activity, visible to them on their link, and you're alerted. Staff can reply over email too: replying to a vendor's message emails the vendor, and replying to a vendor-activity alert adds an internal note. |
| **Vendors** | Trades, contacts, after-hours numbers, license, COI expiration tracking, rates, rating, YTD spend, on-time rate, job history. |
| **Sites** | Location cards with open/overdue/compliance/down counts; site page with everything for that location plus its team (admins get an *Add / manage* link to that location's people). **Import from Excel** adds or updates many sites at once from an .xlsx or .csv (template included). A *Company* column puts each location in the right company (template has a dropdown of your companies; unknown names are flagged, never created; a different company moves an existing site). Rows match existing sites by Store # (or by Name when there's no Store #). People are invited on *Users*, not in the import. |
| **Budgets** | A monthly R&M budget per location (labor, parts and vendor costs). The super admin sets a normal monthly amount per location and, where needed, a different amount for specific months (e.g. summer HVAC), on the location's page, in bulk on **Sites → Budgets**, or with **Export / Import Excel** (a prefilled sheet with the next 12 months). Everyone at a location sees its budget: on the dashboard (*By site*), the Sites cards, the location page (this month plus the last 5) and the Budgets page, with green / amber (80%+) / red (over) bars. Admins see dollars spent; GMs and techs see % used and what's left, so labor is never itemized for them. |
| **Users** | Invite by email, set role, link vendor logins to a vendor company, and pick their **locations** with a picker grouped by company (search by store #, name or city; select all per company). **Import from Excel** invites many people at once (Email, Name, Role, Store #s or ALL, optional Company and Hourly Rate; template includes a Stores sheet of codes); existing people are updated and only gain locations. Two views: **By user** and **By location**. By location lists each site's managers and techs, with *Remove* (from that site only), *Add an existing user*, and *Invite someone new to this location* (site preselected). Inviting an email that already has a login just adds them to the site. |

### Roles (enforced in the database, not just the UI)

| Role | Can see | Can do |
|---|---|---|
| **Super admin** | Everything, in every company, including hourly rates | Everything an admin does, plus: add/remove companies; add, change and remove admins and super admins (and limit admins to companies); set labor rates and location budgets; delete work orders and assets; **approve vendor invoices for payment** and mark them paid. There is always at least one active super admin. |
| **Admin** | Everything in their companies (all companies unless a super admin limits them), including labor dollars and R&M spend, but not hourly rates | Day-to-day setup, assignments, scheduler, managers/techs/vendors, quotes, receipts; reviews invoices (under review, request revision) but can't approve them for payment |
| **Manager** (store / property) | Only their assigned sites | Submit requests (an admin approves them), comment, upload photos, withdraw their own requests before work starts, **sign off on finished work** at their location or send it back |
| **Tech** | Their assigned sites + anything assigned to them | Work tickets, set status, costs, adjust schedule and priority, edit assets, log compliance; submit requests (an admin approves them and assigns who does the work) |
| **Vendor** | Only work orders dispatched to their company | Start / hold / complete, invoice amount & number, notes, photos |

Row-level security policies in Postgres enforce all of this, so even a direct API call with a manager's or vendor's token can't read other sites' data. Users can't change their own role.

---

## Setup

### 1. Create the Supabase project
1. Create a project at supabase.com.
2. **SQL Editor** → run, in order: `supabase/migrations/0001_schema.sql`, `0003_scheduling.sql`, `0004_vendor_portal.sql`, `0005_compliance_calendar.sql`, `0006_inbound_email.sql`, `0007_purchases.sql`, `0008_grants.sql`, `0009_companies.sql`, `0010_vendor_costs_quotes.sql`, `0011_labor_time.sql`, `0012_super_admin.sql`, `0013_site_budgets.sql`, `0014_wo_requested_status.sql`, `0015_wo_approval.sql`, `0016_wo_signoff_status.sql`, `0017_wo_signoff.sql`. (`0002` is the optional pg_cron file.) Already ran some? Run only the new ones; 0003–0017 are safe to re-run. Run `0014` on its own before `0015`, and `0016` on its own before `0017` (Postgres must commit a new status before it can be used). `0012` makes the earliest admin the first super admin. `0011` turns any labor typed on existing work orders into a time entry, keeping its hours and dollars. `0009` puts all existing sites into a starting company called "My Company" that you can rename. **Don't skip `0008`**: newer Supabase projects don't give the app access to new tables, and without it every sign-in ends in "Your account is inactive".
3. *(Optional, for a demo)* run `supabase/seed.sql`: 4 sites, 5 vendors, 9 assets, PM schedules, compliance items and sample work orders. Skip it for production, or delete the sample rows later.
4. **Authentication → URL Configuration:** set *Site URL* to your app URL and add `https://YOUR-APP/auth/callback` to *Redirect URLs* (also `http://localhost:3000/auth/callback` for local dev).
5. **Authentication → Providers → Email:** turn **off** "Allow new users to sign up". Access is invite-only.

### 2. Make yourself admin
Invite yourself under **Authentication → Users → Invite user**, accept the email, then in the SQL editor:
```sql
update public.profiles set role = 'admin', is_super = true, full_name = 'Your Name' where email = 'you@company.com';
```
After that, invite everyone else from the app's **Users** page.

### 3. Set up schedule emails (Resend)
1. Create a free account at resend.com and verify a sending domain (e.g. `yourcompany.com`). It takes a few DNS records.
2. Create an API key and set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `MaintenanceOS <dispatch@yourcompany.com>`). Optionally set `EMAIL_REPLY_TO` so tech replies reach dispatch.
3. Make sure every tech has an email on their profile (they do if you invited them) and set `NEXT_PUBLIC_SITE_URL` to your real app URL, since the email buttons link there.

4. Set `LINK_SIGNING_SECRET` (a long random string) for vendor links, and optionally `NEXT_PUBLIC_COMPANY_NAME` and `VENDOR_NOTIFY_EMAILS`.

Without the email keys the app still works. The calendar's email buttons just report that email isn't configured. To use another provider (SendGrid, Postmark, SES), replace the body of `sendEmail()` in `src/lib/email.ts`.

### 4. Email replies → work order (Resend Receiving)
So that a vendor's **Reply** lands on the work order:
1. In Resend → **Domains**, add a receiving subdomain such as `reply.yourcompany.com` and create the **MX record** Resend shows you at your DNS provider. Use a *subdomain*: pointing your main domain's MX at Resend would move all your company email there. (For a quick trial you can instead use the `<id>.resend.app` address on Resend's Receiving page.)
2. In Resend → **Webhooks**, add `https://YOUR-APP/api/inbound/email` with the event **`email.received`**, and copy its signing secret.
3. Set `REPLY_DOMAIN=reply.yourcompany.com` (or your `<id>.resend.app` domain) and `RESEND_WEBHOOK_SECRET=whsec_…`, then redeploy.

How replies are handled:

| Who replies | Replying to | Result |
|---|---|---|
| The vendor: their dispatch address, their directory email, or anyone at the same company domain | A vendor email | Posted on the work order and visible on the vendor's link; attachments saved; you're alerted |
| Your admin/tech (matched by profile email) | A vendor email | Posted as your message, and the vendor is emailed it |
| Your admin/tech | A "[WO #…] vendor update" alert | Added as an internal note (vendor never sees it) |
| Anyone else | Any reply address | Kept as an internal, flagged note; you're alerted; never shared |

Details:
- Reply addresses are signed with `LINK_SIGNING_SECRET`, so they can't be guessed or forged.
- Webhook calls are signature-checked and must be under 5 minutes old.
- Retries from Resend are de-duplicated. If processing fails, Resend retries and nothing is lost.
- Quoted text and "Sent from my iPhone" lines are trimmed. Tiny inline images like signature logos are skipped. Photos and PDFs up to 10 MB are saved.
- Personal email providers (Gmail, Outlook and so on) are only trusted by exact address, never by domain.
- Every received email is logged in the `inbound_emails` table.

Without `REPLY_DOMAIN`, replies go to `EMAIL_REPLY_TO` as before.

### 5. Run locally
```bash
cp .env.example .env.local     # fill in values from Supabase → Project Settings → API
npm install
npm run dev                    # http://localhost:3000
```

### 6. Deploy (Vercel)
1. Push this folder to a GitHub repo and import it in Vercel.
2. Add the environment variables from `.env.example` (all five).
3. Deploy. `vercel.json` registers one daily job, `/api/cron/daily`, at 13:30 UTC (5:30am PST / 6:30am PDT). Vercel sends `CRON_SECRET` automatically. In order, it:
   1. creates due PM and compliance work orders,
   2. **emails each due compliance work order to its vendor** (secure link, once per work order; items with no vendor, a vendor with no email, or auto-email turned off are skipped),
   3. emails each tech today's schedule,
   4. sends vendor reminders (no response after 24h, past the requested date, or no invoice 3 days after completion),
   5. reminds GMs about finished jobs waiting for their sign-off (after 1 day) and closes ones still unsigned after 3 days.
   The individual routes (`/api/cron/generate`, `/schedule-emails`, `/vendor-reminders`) still exist if you'd rather schedule them separately. Times in `vercel.json` are UTC.
4. **Uploads:** photos are shrunk in the browser before upload (a 9 MB phone photo becomes about 1 MB), which keeps requests under Vercel's ~4.5 MB limit. A single PDF over ~4 MB would need a host without that limit.

Not on Vercel? Either call `GET /api/cron/generate` daily with header `Authorization: Bearer $CRON_SECRET`, or enable pg_cron and run `supabase/migrations/0002_optional_pg_cron.sql`. Admins can also click **Run scheduler now** on the PM or Compliance page at any time.

---

### Time & labor workflow
1. Set each technician's **hourly rate** on *Users → (person) → Labor rate*. Add a new rate with an effective date for raises; history is kept.
2. On site, the tech taps **Start work** on *My day* (or **Start timer** on the work order). Lunch or a parts run? **Pause**, then **Resume**. Done for this visit? **Stop**. Completing the work order stops any open timers.
3. Needs a return trip? Reopen the work order. The next timer is logged as *Visit 2*, and the first visit's time stays as it was.
4. Forgot the timer? An admin opens the work order's *Time & labor* card: **Add time manually**, or **Adjust or void** an entry. A reason is required and every change is logged.
5. Review spend on **R&M spending** and each tech's hours and cost on **Technician labor**.

How R&M spend is dated: labor on the day it was worked, receipts on their purchase date, other parts and vendor invoices when the work order is completed. Running timers count toward hours live and toward cost each time they're paused or stopped.

### Receipts workflow
1. Buying parts for a job? On the phone, open **My day → Add receipt** (or the work order's *Receipts & purchases*). Take a photo, then enter the store, total and how it was paid. It takes about 20 seconds.
2. The receipt is added to the work order's cost right away and appears on **Purchases** as *Needs review*.
3. An admin approves it, or rejects it with a reason. A rejected receipt stops counting toward the cost and the person who added it sees why.
4. Personal-card purchases show as *Owed to employees* until an admin marks them reimbursed (with a check # or payroll reference).
5. At month end, filter **Purchases** by date and export the CSV for accounting.

Work order R&M cost = internal technician labor (from time entries) + receipts + other parts (stock items without a receipt) + vendor invoice. Labor dollars are stored in admin-only tables, so `work_orders.total_cost` holds the non-labor part and admins see labor added on top.

### Compliance workflow
1. Each compliance item has a default vendor and a reminder window ("remind days before", default 21).
2. **Automatically:** when an item enters its window, the morning job creates the work order and emails it to the vendor's directory address with the secure link. Admins can do the same at any time with **Email due items to vendors**. Turn auto-email off per item on the requirement form.
3. **Or schedule it yourself:** on the **Calendar** tab, drag the item to a day (or use *Schedule service* on the requirement) and tick "Email the work order to the vendor now".
4. For compliance jobs the vendor **must attach the certificate or inspection report** (and can enter the certificate #) when marking the work complete. Staff completing a job themselves can enter the certificate # and upload a file as type "Certificate".
5. When the work order is closed, the completion is recorded and the certificate is attached to it. The next due date rolls forward, and the item appears on **Completed & certificates** with its valid-until date.

### External vendor workflow
1. On a work order, click **Assign to External Vendor**. Pick the vendor (contact details fill in from the directory) or add a new one, then add instructions, priority, the requested date and a not-to-exceed amount, and send.
2. The vendor gets an email with the details, the photos attached, and a **View Work Order** button. The page works on any phone without an account.
3. Vendor flow: **Accept** (or **Decline** with a reason, which returns the job to *New* for reassignment) → **Start Work** → updates and photos → **Request approval** if extra work is needed (approving it raises the NTE) → **Mark Work Complete**, with the invoice attached in the same form if they have it → or **Submit Invoice** any time afterward (revisions supported).
4. You get an email at each step. The work order's **External vendor** panel shows every milestone and holds the controls: approve or reject extra work, **Approve & close** or **Send back**, and for invoices **Under review → Approve / Request revision → Mark paid**. You can also message the vendor, edit details (the vendor is emailed), **Resend link**, or **Revoke access**.

**Quotes and costs**
- **Quotes:** the vendor sends a quote (scope, total, optional line items, quote file, valid-until date) from their link. It appears on the work order's *External vendor* panel, on the dashboard banner and in *Vendor work → Needs your action*. **Approve** sets the work order's not-to-exceed to the quoted amount; **Reject** needs a note and the vendor can send a revision (a new quote replaces one still waiting). Tick **Require a quote before work starts** when assigning (or later under *Edit instructions*) and the vendor can accept but not start until a quote is approved. For extra work after approval, vendors use *Request approval for additional work* as before.
- **Costs:** the vendor itemizes costs as they go, each with quantity × rate and an optional receipt photo. You see the breakdown, total and how it compares with the not-to-exceed on the work order. Their invoice form is prefilled with the cost total. The work order's cost still comes from the **approved invoice**, so nothing is counted twice. Costs lock once an invoice is submitted (and unlock if you request a revision).

**How statuses map:**

| Your spec | In the app |
|---|---|
| Open | New |
| Assigned to Vendor / Accepted | Assigned (the vendor panel shows Sent or Accepted) |
| In Progress | In progress |
| Pending Approval | Extra work approval |
| Work Completed / Pending Management Review | Pending review |
| Closed | Completed |
| Declined / On Hold / Reopened | Vendor panel shows Declined (work order returns to New) / On hold / Reopen button |

Invoice status is tracked separately: Not submitted, Submitted, Under review, Approved, Revision requested, Paid.

**Security model**
- **The link:** each vendor link is derived from the job ID and `LINK_SIGNING_SECRET`, and only a fingerprint (SHA-256 hash) of it is stored, so a database copy can't be turned into working links.
- **Expiry and revoking:** links expire after 90 days (`VENDOR_LINK_DAYS`). An expired page offers to email a new link, only to the address on file. **Resend link** and **Revoke access** turn the old link off immediately.
- **What vendors can see:** only their own job. That excludes internal comments, files marked *Internal only*, labor and parts costs, other vendors' activity and invoices, and other sites.
- **Audit trail:** every vendor action is logged with the name they entered, time, IP address and device. Changes to the work order itself go through a database function only the server can call.
- **Duplicates and files:** repeat submissions are blocked (each step only works from the right previous step, and forms carry a one-time key). Files are stored in a private bucket and shown through 1-hour signed URLs.
- **Verification:** for sensitive steps (decline, complete, invoice), v1 relies on having the link plus a confirmation prompt. An emailed one-time code for invoice submission can be added if you want a second factor.

### Approval workflow
1. A GM or tech submits a work order. It starts as **Needs approval**, and the admins who cover that company get an email (flagged for emergency and high priority). The sidebar's *Work orders* item and the dashboard show how many are waiting.
2. An admin or super admin opens it and either:
   - **Approve & assign:** picks the technician (plus priority, category, schedule and an optional note). The tech gets an email right away, and the person who asked gets an "approved" email saying who's on it.
   - **Approve & send to vendor:** the usual *Assign to External Vendor* form. Sending it approves it; the vendor gets their link and the person who asked is told which vendor has it.
   - **Decline** with a reason, which is emailed to the person who asked.
3. Until it's approved, nobody can schedule, start, log time on, or send it to a vendor, and only admins ever assign or reassign a technician or vendor (enforced in the database). Techs can still adjust the schedule, priority and details of jobs they're on. The person who asked can add details or withdraw a request.
4. Work orders created by admins, and the automatic PM and compliance work orders, are approved when created.

Other emails to people inside the company: the requester (GMs and techs) gets one when a vendor is put on their job and when it's completed (with what was done); a tech gets one whenever they're assigned a job; the vendor gets one when you **Approve & close** their work. Vendor-activity alerts go to the admins who cover that work order's company, plus whoever sent the job to the vendor.

### GM sign-off workflow
1. When a tech marks a store job complete (or an admin approves a vendor's completed work), it moves to **Awaiting GM sign-off** instead of closing. Every GM at that location gets an email: *Is it fixed?*
2. A GM opens it and taps **Yes, it's fixed** (closes it, with an optional comment) or **Send back** with a note. Sending back reopens it for the same tech or vendor as a return visit, and they're emailed the note (vendors on their link).
3. Nobody signs? A reminder goes out after 1 day, and the daily job closes it after **3 days**, noted as *closed automatically*. An admin can also **Close for the GM** with a reason.
4. Timers stop and the completion time is recorded when the work is done, so sign-off delays don't count against techs or vendors. No new time can be logged while it waits.
5. A super admin can't approve a vendor invoice for payment until the GM signs off, unless they tick *Approve anyway*.
6. Applies to every work order at a location with an active GM, except PM and compliance work orders (compliance already requires a certificate). Locations without a GM close as before.

### Scheduling workflow
1. New requests land in **Schedule → Unscheduled** (sorted by priority, then due date).
2. Drag each one onto a tech and day. Open a job to set an exact start time and estimated hours.
3. Techs get their day by email each morning and work from **My day** on their phone.
4. Changed the plan after the morning email? Open the day view and click **Resend** for that tech.

Calendar drag-and-drop is for desktop. On a phone, schedule from the work order's *Assignment & schedule* card instead.

## Day-one checklist
1. **Companies:** rename "My Company" and add your other corporations on **Companies**.
2. **Sites:** add each location (code, type, address, company), or use **Sites → Import from Excel** to load them all at once. Site type drives the compliance template.
3. **Compliance:** on the Compliance page, use **Add standard checklist** for each site, then open each item and set the real next-due date from your last certificate. Template frequencies are common defaults; confirm them with your fire marshal, health department, landlord and insurer.
4. **Vendors:** add your hood, refrigeration/HVAC, plumbing, pest and electrical vendors with COI dates.
5. **Assets:** start with the equipment that breaks or costs the most (walk-ins, fryers, ice machines, RTUs, hoods). Bulk import via CSV in Supabase **Table Editor → assets → Insert → Import CSV** works well.
6. **PM schedules:** add from each asset page.
7. **Schedule:** drag open work onto techs for the week, then send a test schedule email to yourself (make yourself a tech's job, or use day view → *Email schedule*).
8. **Users:** use **Users → Import from Excel** for the whole team, or invite GMs as *Managers* and pick their location(s), techs with their coverage sites, and vendor contacts as *Vendors* linked to their company. The **By location** view on Users is the quickest way to staff each site.

---

## Project layout
```
supabase/
  migrations/0001_schema.sql       tables, enums, triggers, scheduler, RLS, storage bucket
  migrations/0002_optional_pg_cron.sql
  seed.sql                         demo data
src/
  app/(app)/                       authenticated pages (dashboard, work-orders, pm, compliance,
                                   assets, sites, vendors, admin/users, account)
  app/login, app/auth/*            sign-in (password or email link), callback, sign-out
  app/(app)/vendor-jobs            all external vendor work, needs-action queue, unpaid invoices
  app/(app)/work-orders/[id]/dispatch   "Assign to External Vendor" form
  app/v/[token]                    no-login vendor portal (mobile) and its actions
  app/(app)/schedule               dispatch calendar (drag-and-drop board)
  app/(app)/my-day                 tech's daily route view
  app/api/inbound/email            Resend email.received webhook → reply posted on the work order
  app/api/cron/generate            daily PM/compliance scheduler endpoint
  app/api/cron/schedule-emails     morning tech schedule emails
  lib/email.ts, lib/schedule-email.ts   email sending + the schedule email template
  lib/vendor-notify.ts, lib/vendor-portal.ts, lib/tokens.ts, lib/vendor-reminders.ts   vendor emails, portal data, link tokens, reminders
  components/                      UI kit, badges, sidebar, attachments, site→asset picker
  lib/                             Supabase clients, auth/role helpers, formatting, types
```

### Business rules that live in the database
- `wo_before_insert`: SLA due date from priority; new → assigned when someone is assigned.
- `wo_before_update`: stamps `started_at` / `completed_at`.
- `wo_after_change`: writes the activity log; on completion updates the PM schedule and, for compliance work orders, records the inspection and rolls the next due date forward.
- `generate_due_work_orders()`: the scheduler (admin or service role only).
- `total_cost` is a generated column (labor + parts + vendor invoice).

### Timezone
Dates display in `America/Los_Angeles`. To change it, set `NEXT_PUBLIC_TIMEZONE` and update the timezone in `generate_due_work_orders()` in the schema file.

---

## Ideas for next
- **GPS tech tracker:** add a `tech_locations` table (user_id, lat, lng, recorded_at) and a map page; sites already have `latitude`/`longitude` columns for geofencing check-in/out on work orders.
- Email/SMS notifications on assignment and emergencies (Supabase database webhooks → Resend/Twilio).
- Parts inventory and purchase approvals over a $ threshold.
- QR code labels on assets that open "Report issue" pre-filled.
- Budget vs. actual by site and category.
