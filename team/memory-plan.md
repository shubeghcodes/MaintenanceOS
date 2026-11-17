# Team memory — plan (nothing built yet)

**Status:** plan only. No SQL has been run and nothing has been created in Supabase. Building starts only after the owner approves and M-Brain names the exact project.

## Why
Each chat forgets everything when it ends. Team memory is a shared notebook so a new or restarted chat can see what was decided, what is in progress and what was already done, instead of asking the owner again.

## What gets remembered
| Thing | Example |
|---|---|
| **Decisions** | "Memory lives in its own project. Approved by the owner on 17 Nov." |
| **Tasks and their status** | "Fix GM sign-off button — M-Core — in review" |
| **What each chat did** | "M-Core pushed branch X, commit abc123; build passed" |
| **Open questions** | "Who owns the clock-in screen, M-Core or M-Money? Waiting on M-Brain" |

**Never stored:** keys, passwords, link tokens, or any personal data from the app (names, emails, phone numbers of staff or vendors, rates, invoice amounts). Memory refers to things by work-order number, file, branch or commit — not by person.

## Proposed tables
All in a schema of their own called `team_memory` (a schema is a separate drawer in the database; the app's tables live in the `public` drawer).

**`chats`** — the team list.
`name` (key, e.g. `M-Core`) · `role` · `area` · `rulebook_path` · `active`

**`tasks`** — one row per job M-Brain hands out.
`id` · `title` · `detail` · `owner_chat` → chats · `status` (`planned`, `approved`, `in_progress`, `reported`, `in_review`, `verified`, `sent_back`, `dropped`) · `branch` · `created_by` · `created_at` · `updated_at` · `verified_at`

**`work_log`** — what each chat did; add-only, never edited.
`id` · `task_id` → tasks (optional) · `chat` → chats · `kind` (`plan`, `progress`, `report`, `review`, `verification`, `alert`, `note`) · `summary` · `branch` · `commit_sha` · `created_at`

**`decisions`** — add-only; a changed decision is a new row pointing at the old one.
`id` · `title` · `decision` · `reason` · `decided_by` (`owner` or `M-Brain`) · `task_id` (optional) · `replaces` → decisions (optional) · `created_at`

**`open_questions`**
`id` · `question` · `raised_by` → chats · `waiting_on` (`owner`, `M-Brain`, or a chat) · `task_id` (optional) · `status` (`open`, `answered`, `dropped`) · `answer` · `created_at` · `answered_at`

Rules built into the tables: status values limited to the lists above; `work_log` and `decisions` cannot be updated or deleted (a database trigger refuses); `updated_at` set automatically.

## How it stays separate from the app and unreadable by app users
The app's users (super admin, admin, manager, tech, vendor) reach the database only through the app's public door (Supabase's API, using the app's public key or their login). The plan closes that door to memory three times over:

1. **Own schema, not exposed.** `team_memory` is not added to the list of schemas the API serves, so the app's door does not lead there at all.
2. **Permissions removed.** The two roles every app visitor uses (`anon` = not logged in, `authenticated` = logged in) are given no rights on the schema or its tables.
3. **Row-level security on, with no policies.** Even if someone later exposed the schema by mistake, every table would still return nothing to app users.

No app code will ever read or write memory, and memory tables never link to app tables. If memory lives in its own project (recommended, below) there is a fourth wall: app users have no login to that project at all.

**How we prove it** (after building, before use): try to read and write each memory table with the public key and with a manager, tech and vendor login — every attempt must fail — and run Supabase's built-in security check. M-Review repeats this independently.

## How chats read and write it
- Through the Supabase tool the chats already have (it runs SQL as the project's administrator, which is why app-user rules don't block it). No keys are stored in the repo or in chat instructions.
- **Start of a job:** read your open tasks, recent decisions and open questions.
- **End of a job:** add a `work_log` row and set the task to `reported`.
- **Who writes what:** every chat adds to `work_log` and `open_questions` and may move *its own* task up to `reported`. Only M-Brain creates tasks, records decisions, and marks `verified` or `sent_back`. M-Review and M-Watchdog only add `work_log` rows (`review`, `alert`).
- Each rule book gets a short "Memory" section with the exact project and the ready-made queries, so chats never write free-form SQL against it.

**Honest limit:** the Supabase tool does not know which chat is using it, so "who writes what" is a rule the chats follow and M-Brain checks, not something the database can enforce. The same tool can also reach the app's databases, so the rule "never touch production" still rests on the rule books. If the owner wants a hard lock later, the tool's access can be narrowed to one project in its connection settings.

## Where it lives — the options
| Option | What it means | Good | Bad |
|---|---|---|---|
| **A. Inside the live app's project** | A separate drawer in the production database | Nothing new to set up or pay for | Breaks our own rule "never write to production". One mistake away from real customer data. **Not recommended.** |
| **B. Inside the sandbox project** | A separate drawer in the test database | No new project; no risk to live data | The sandbox gets wiped and rebuilt for testing — memory could be wiped with it. Test logins could sit next to memory. |
| **C. A separate small project** *(recommended)* | Its own database, used for nothing else | Cleanest wall: app users have no way in at all. Cannot be damaged by app work or sandbox resets. Easy to delete if we change our minds | One more project to keep an eye on. May cost money depending on the Supabase plan (free plans have a small project limit and pause unused projects) — **M-Brain to confirm the current cost before the owner decides.** |
| **D. A Supabase "branch"** | A temporary copy of a project, made for testing a change | Quick to create | Branches are made to be thrown away, are billed while they run, and start as a copy of the app's tables. Wrong tool for long-term memory. **Not recommended.** |
| **E. No database: files in the repo** | Notes kept as files under `team/memory/` on a branch | Zero database risk, free, works today | Chats on different branches don't see each other's notes until merged; easy to clash; not searchable. Fine as a stop-gap, weak long-term. |

**Recommendation:** C. If the owner prefers no extra project or cost, B is acceptable provided the sandbox reset procedure is changed to leave `team_memory` alone.

## Build steps once approved (for reference — not started)
1. M-Brain names the project; M-Architect sends a short build plan and waits for go-ahead.
2. The table script is kept in `team/memory/` (not in `supabase/migrations/`, so it can never be run against the app by mistake). *Open point: rule "only M-Database writes SQL" — M-Brain to say whether M-Database writes or reviews this script.*
3. Apply to the named project only. Run the proof tests above. Report to M-Brain.
4. Add the "Memory" section to each rule book. M-Brain verifies; M-Review re-checks.

## Decisions needed from the owner
1. Where memory lives (A–E above; C recommended).
2. If C: OK to create one new Supabase project, and any cost that comes with it.
3. How long to keep old entries (suggestion: keep everything for now; it is small).
