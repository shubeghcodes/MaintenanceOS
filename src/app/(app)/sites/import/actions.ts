"use server";

import { getCompanyScope } from "@/lib/company";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSiteFile, type ImportRow } from "@/lib/site-import";
import type { UserRole } from "@/lib/types";

export type PreviewRow = ImportRow & {
  action: "create" | "update" | "skip";
  managerNotes: string[];
  companyId: string | null; // company the site will end up in (null = default for new sites)
  companyLabel: string | null;
  companyNote: string | null; // e.g. "Moves from A to B"
};

export type ImportState =
  | { stage: "idle" }
  | { stage: "error"; message: string }
  | {
      stage: "preview";
      fileName: string;
      rows: PreviewRow[];
      unknownHeaders: string[];
      counts: { create: number; update: number; skip: number; newManagers: number; moves: number };
    }
  | {
      stage: "done";
      created: number;
      updated: number;
      assigned: number;
      invited: string[];
      createdNoEmail: string[];
      problems: string[];
    };

type ExistingSite = { id: string; code: string | null; name: string; company_id: string | null };
type Company = { id: string; name: string; legal_name: string | null; active: boolean };

/** Loose company-name key: case, punctuation and spaces ignored. */
const coKey = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
/** Same, also without a trailing legal suffix (Inc, LLC, Corp…). */
const coBase = (s: string) => coKey(s).replace(/(incorporated|inc|llc|lllp|llp|lp|ltd|limited|corporation|corp|company|co|pllc|pc)$/, "");
type ExistingProfile = { id: string; email: string | null; role: UserRole; active: boolean };

async function loadContext() {
  const { supabase } = await requireRole("admin");
  const [{ data: s }, { data: p }, scope] = await Promise.all([
    supabase.from("sites").select("id,code,name,company_id"),
    supabase.from("profiles").select("id,email,role,active"),
    getCompanyScope(),
  ]);
  const sites = (s ?? []) as ExistingSite[];
  const companies = scope.companies as Company[];
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  // Exact (loose) match on name or legal name first, then ignoring Inc/LLC-style suffixes if that's unambiguous.
  const findCompany = (raw: string): Company | "ambiguous" | null => {
    const exact = companies.filter((c) => coKey(c.name) === coKey(raw) || (c.legal_name && coKey(c.legal_name) === coKey(raw)));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return "ambiguous";
    const base = companies.filter((c) => coBase(c.name) === coBase(raw) || (c.legal_name && coBase(c.legal_name) === coBase(raw)));
    if (base.length === 1) return base[0];
    return base.length > 1 ? "ambiguous" : null;
  };
  const defaultCompanyId = scope.companyId ?? companies.find((c) => c.active)?.id ?? null;
  const profiles = (p ?? []) as ExistingProfile[];
  const byCode = new Map(sites.filter((x) => x.code).map((x) => [x.code!.toLowerCase(), x]));
  const byName = new Map(sites.map((x) => [x.name.toLowerCase(), x]));
  const byEmail = new Map(profiles.filter((x) => x.email).map((x) => [x.email!.toLowerCase(), x]));
  const match = (r: ImportRow) => (r.code ? byCode.get(r.code.toLowerCase()) : undefined) ?? (r.name ? byName.get(r.name.toLowerCase()) : undefined);
  return { supabase, match, byEmail, findCompany, companyName, defaultCompanyId, companiesEnabled: scope.enabled };
}

function annotate(rows: ImportRow[], ctx: Awaited<ReturnType<typeof loadContext>>): PreviewRow[] {
  return rows.map((r) => {
    const managerNotes: string[] = [];
    for (const e of r.manager_emails) {
      const p = ctx.byEmail.get(e);
      if (!p) managerNotes.push(`${e}: new, will be invited as Manager`);
      else if (p.role === "vendor") r.errors.push(`${e} is a vendor login and can’t be assigned to a site`);
      else if (p.role === "admin") managerNotes.push(`${e}: admin, already sees every site`);
      else managerNotes.push(`${e}: existing ${p.role}${p.active ? "" : " (inactive)"}`);
    }
    const existing = ctx.match(r);
    let companyId: string | null = null;
    let companyNote: string | null = null;
    if (r.company && ctx.companiesEnabled) {
      const c = ctx.findCompany(r.company);
      if (c === "ambiguous") r.errors.push(`Company “${r.company}” matches more than one company; use the exact name`);
      else if (!c) r.errors.push(`Company “${r.company}” not found. Add it on the Companies page first, or fix the spelling`);
      else {
        companyId = c.id;
        if (c.name !== r.company) companyNote = `Matched to ${c.name}`;
        if (existing?.company_id && existing.company_id !== c.id) companyNote = `Moves from ${ctx.companyName.get(existing.company_id) ?? "another company"} to ${c.name}`;
      }
    } else if (existing) {
      companyId = existing.company_id;
    } else {
      companyId = ctx.defaultCompanyId;
    }
    const action = r.errors.length ? "skip" : existing ? "update" : "create";
    return { ...r, action, managerNotes, companyId, companyLabel: companyId ? ctx.companyName.get(companyId) ?? null : null, companyNote };
  });
}

export async function importSites(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const intent = fd.get("intent") === "import" ? "import" : "preview";
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { stage: "error", message: "Choose an Excel (.xlsx) or CSV file first." };

  let parsed: Awaited<ReturnType<typeof parseSiteFile>>;
  try {
    parsed = await parseSiteFile(file);
  } catch (e) {
    return { stage: "error", message: e instanceof Error ? e.message : "Couldn’t read that file." };
  }

  const ctx = await loadContext();
  const rows = annotate(parsed.rows, ctx);

  if (intent === "preview") {
    const newEmails = new Set(rows.filter((r) => r.action !== "skip").flatMap((r) => r.manager_emails).filter((e) => !ctx.byEmail.has(e)));
    return {
      stage: "preview",
      fileName: file.name,
      rows,
      unknownHeaders: parsed.unknownHeaders,
      counts: {
        create: rows.filter((r) => r.action === "create").length,
        update: rows.filter((r) => r.action === "update").length,
        skip: rows.filter((r) => r.action === "skip").length,
        newManagers: newEmails.size,
        moves: rows.filter((r) => r.action === "update" && r.companyNote?.startsWith("Moves")).length,
      },
    };
  }

  // ---------- Import ----------
  const { supabase } = ctx;
  const problems: string[] = [];
  let created = 0;
  let updated = 0;
  const siteIdsByEmail = new Map<string, { siteIds: string[]; name: string | null }>();

  for (const r of rows) {
    if (r.action === "skip") {
      problems.push(`Row ${r.line} (${r.name ?? "no name"}) skipped: ${r.errors.join("; ")}`);
      continue;
    }
    const full = {
      code: r.code,
      name: r.name!,
      type: r.type,
      brand: r.brand,
      address: r.address,
      city: r.city,
      state: r.state,
      zip: r.zip,
      phone: r.phone,
      sq_ft: r.sq_ft,
    };
    let siteId: string | null = null;
    const existing = ctx.match(r);
    if (existing) {
      // Only overwrite fields that have a value in the file; blanks never erase data.
      const patch: Record<string, unknown> = Object.fromEntries(Object.entries(full).filter(([, v]) => v !== null && v !== undefined));
      // A company in the file moves the site (its work orders, assets and history follow it).
      if (r.company && r.companyId && r.companyId !== existing.company_id) patch.company_id = r.companyId;
      const { error } = await supabase.from("sites").update(patch).eq("id", existing.id);
      if (error) problems.push(`Row ${r.line} (${r.name}): ${error.message}`);
      else {
        updated++;
        siteId = existing.id;
      }
    } else {
      const { data, error } = await supabase.from("sites").insert({ ...full, company_id: r.companyId ?? undefined } as typeof full).select("id").single();
      if (error || !data) problems.push(`Row ${r.line} (${r.name}): ${error?.message ?? "insert failed"}`);
      else {
        created++;
        siteId = data.id;
      }
    }
    if (siteId) {
      for (const e of r.manager_emails) {
        const entry = siteIdsByEmail.get(e) ?? { siteIds: [], name: null };
        entry.siteIds.push(siteId);
        if (r.manager_emails.length === 1 && r.manager_name && !entry.name) entry.name = r.manager_name;
        siteIdsByEmail.set(e, entry);
      }
    }
  }

  // ---------- Managers ----------
  let assigned = 0;
  const invited: string[] = [];
  const createdNoEmail: string[] = [];
  if (siteIdsByEmail.size) {
    const admin = createAdminClient();
    const origin = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin") || "";
    for (const [email, { siteIds, name }] of siteIdsByEmail) {
      let userId = ctx.byEmail.get(email)?.id ?? null;
      const existingRole = ctx.byEmail.get(email)?.role;
      if (existingRole === "admin") continue; // admins already see everything
      if (!userId) {
        const inv = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: name, role: "manager" },
          redirectTo: `${origin}/auth/callback?next=/account`,
        });
        if (inv.data?.user) {
          userId = inv.data.user.id;
          invited.push(email);
        } else {
          // Usually Supabase's hourly email limit. Create the login without an email so the site assignment still works;
          // they can sign in later with "Email me a link" or get an invite from the Users page.
          const cr = await admin.auth.admin.createUser({ email, email_confirm: false, user_metadata: { full_name: name, role: "manager" } });
          if (cr.data?.user) {
            userId = cr.data.user.id;
            createdNoEmail.push(email);
          } else {
            problems.push(`${email}: couldn’t create the login (${inv.error?.message ?? cr.error?.message ?? "unknown error"})`);
            continue;
          }
        }
        await admin.from("profiles").update({ role: "manager", full_name: name ?? email.split("@")[0] }).eq("id", userId);
      }
      const { error } = await admin
        .from("site_members")
        .upsert(siteIds.map((site_id) => ({ site_id, user_id: userId! })), { onConflict: "site_id,user_id", ignoreDuplicates: true });
      if (error) problems.push(`${email}: ${error.message}`);
      else assigned += siteIds.length;
    }
  }

  revalidatePath("/sites");
  revalidatePath("/admin/users");
  revalidatePath("/");
  return { stage: "done", created, updated, assigned, invited, createdNoEmail, problems };
}
