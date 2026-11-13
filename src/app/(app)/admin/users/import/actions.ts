"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { getCompanyScope } from "@/lib/company";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayISO } from "@/lib/format";
import { parseUserFile, type UserImportRow } from "@/lib/user-import";
import type { UserRole } from "@/lib/types";

export type UserPreviewRow = UserImportRow & {
  action: "invite" | "update" | "skip";
  siteIds: string[];
  storesLabel: string;
  notes: string[];
};

export type UserImportState =
  | { stage: "idle" }
  | { stage: "error"; message: string }
  | {
      stage: "preview";
      fileName: string;
      rows: UserPreviewRow[];
      unknownHeaders: string[];
      counts: { invite: number; update: number; skip: number; assignments: number };
    }
  | { stage: "done"; invited: string[]; createdNoEmail: string[]; updated: number; assigned: number; rates: number; problems: string[] };

type Site = { id: string; code: string | null; name: string; company_id: string | null; active: boolean };
type Person = { id: string; email: string | null; full_name: string | null; phone: string | null; role: UserRole; active: boolean };

const coKey = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const coBase = (s: string) => coKey(s).replace(/(incorporated|inc|llc|lllp|llp|lp|ltd|limited|corporation|corp|company|co|pllc|pc)$/, "");

async function loadContext() {
  const { supabase, profile } = await requireRole("admin");
  const [{ data: s }, { data: p }, { data: m }, { data: r }, scope] = await Promise.all([
    supabase.from("sites").select("id,code,name,company_id,active"),
    supabase.from("profiles").select("id,email,full_name,phone,role,active"),
    supabase.from("site_members").select("site_id,user_id"),
    supabase.from("tech_rates").select("user_id,hourly_rate,effective_from").order("effective_from", { ascending: false }),
    getCompanyScope(),
  ]);
  const sites = ((s ?? []) as Site[]).filter((x) => x.active);
  const people = (p ?? []) as Person[];
  const byCode = new Map(sites.filter((x) => x.code).map((x) => [x.code!.toLowerCase(), x]));
  const byName = new Map<string, Site[]>();
  for (const x of sites) byName.set(x.name.toLowerCase(), [...(byName.get(x.name.toLowerCase()) ?? []), x]);
  const byEmail = new Map(people.filter((x) => x.email).map((x) => [x.email!.toLowerCase(), x]));
  const memberOf = new Map<string, Set<string>>();
  for (const x of (m ?? []) as { site_id: string; user_id: string }[]) memberOf.set(x.user_id, (memberOf.get(x.user_id) ?? new Set()).add(x.site_id));
  const today = todayISO();
  const rateOf = new Map<string, number>();
  for (const x of (r ?? []) as { user_id: string; hourly_rate: number; effective_from: string }[])
    if (!rateOf.has(x.user_id) && x.effective_from <= today) rateOf.set(x.user_id, Number(x.hourly_rate));
  const companies = scope.companies;
  const findCompany = (raw: string) => {
    const exact = companies.filter((c) => coKey(c.name) === coKey(raw) || (c.legal_name && coKey(c.legal_name) === coKey(raw)));
    if (exact.length === 1) return exact[0];
    const base = companies.filter((c) => coBase(c.name) === coBase(raw) || (c.legal_name && coBase(c.legal_name) === coBase(raw)));
    return base.length === 1 ? base[0] : null;
  };
  return { supabase, me: profile, sites, byCode, byName, byEmail, memberOf, rateOf, findCompany };
}

function annotate(rows: UserImportRow[], ctx: Awaited<ReturnType<typeof loadContext>>): UserPreviewRow[] {
  return rows.map((r) => {
    const notes: string[] = [];
    let siteIds: string[] = [];
    let storesLabel = "—";

    // Company (scope for ALL / blank stores)
    let company: ReturnType<typeof ctx.findCompany> = null;
    if (r.company) {
      company = ctx.findCompany(r.company);
      if (!company) r.errors.push(`Company “${r.company}” not found`);
    }

    if (r.role === "admin") {
      storesLabel = "All (admin)";
      if (r.stores.length && r.stores[0] !== "ALL") notes.push("Admins see every location; Store # ignored");
    } else if (r.stores[0] === "ALL" || (!r.stores.length && company)) {
      const pool = company ? ctx.sites.filter((s) => s.company_id === company!.id) : ctx.sites;
      siteIds = pool.map((s) => s.id);
      storesLabel = `All ${pool.length} ${company ? `${company.name} ` : ""}location${pool.length === 1 ? "" : "s"}`;
    } else if (r.stores.length) {
      const labels: string[] = [];
      for (const raw of r.stores) {
        const byCode = ctx.byCode.get(raw.toLowerCase());
        const byName = ctx.byName.get(raw.toLowerCase());
        const site = byCode ?? (byName?.length === 1 ? byName[0] : undefined);
        if (!site) {
          r.errors.push(byName && byName.length > 1 ? `“${raw}” matches ${byName.length} stores; use the Store #` : `Store “${raw}” not found`);
          continue;
        }
        if (company && site.company_id !== company.id) r.warnings.push(`${site.code ?? site.name} isn’t in ${company.name}`);
        siteIds.push(site.id);
        labels.push(site.code ?? site.name);
      }
      siteIds = Array.from(new Set(siteIds));
      storesLabel = labels.join(", ") || "—";
    } else {
      r.warnings.push("No locations given: they won’t see any stores until you add some");
    }

    const existing = r.email ? ctx.byEmail.get(r.email) : undefined;
    if (existing) {
      if (existing.role === "vendor") r.errors.push("This email is a vendor login; change it on the Users page");
      if (existing.id === ctx.me.id && r.roleGiven && r.role !== existing.role) r.errors.push("You can’t change your own role");
      if (r.roleGiven && r.role !== existing.role && existing.role !== "vendor") notes.push(`Role ${existing.role} → ${r.role}`);
      const have = ctx.memberOf.get(existing.id) ?? new Set<string>();
      const adding = siteIds.filter((id) => !have.has(id));
      if (r.role !== "admin" && siteIds.length) notes.push(adding.length ? `Adds ${adding.length} location${adding.length === 1 ? "" : "s"}` : "Already has these locations");
      siteIds = adding;
      if (!existing.active) notes.push("Inactive login (stays inactive)");
    } else if (r.email) {
      notes.push("Will be invited");
    }
    if (r.hourly_rate != null) {
      const cur = existing ? ctx.rateOf.get(existing.id) : undefined;
      if (cur !== r.hourly_rate) notes.push(`Rate ${cur != null ? `$${cur.toFixed(2)} → ` : ""}$${r.hourly_rate.toFixed(2)}/hr from today`);
    }
    const action = r.errors.length ? "skip" : existing ? "update" : "invite";
    return { ...r, action, siteIds: r.role === "admin" ? [] : siteIds, storesLabel, notes };
  });
}

export async function importUsers(_prev: UserImportState, fd: FormData): Promise<UserImportState> {
  const intent = fd.get("intent") === "import" ? "import" : "preview";
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { stage: "error", message: "Choose an Excel (.xlsx) or CSV file first." };

  let parsed: Awaited<ReturnType<typeof parseUserFile>>;
  try {
    parsed = await parseUserFile(file);
  } catch (e) {
    return { stage: "error", message: e instanceof Error ? e.message : "Couldn’t read that file." };
  }
  const ctx = await loadContext();
  const rows = annotate(parsed.rows, ctx);

  if (intent === "preview") {
    return {
      stage: "preview",
      fileName: file.name,
      rows,
      unknownHeaders: parsed.unknownHeaders,
      counts: {
        invite: rows.filter((r) => r.action === "invite").length,
        update: rows.filter((r) => r.action === "update").length,
        skip: rows.filter((r) => r.action === "skip").length,
        assignments: rows.filter((r) => r.action !== "skip").reduce((t, r) => t + r.siteIds.length, 0),
      },
    };
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { stage: "error", message: "Set SUPABASE_SERVICE_ROLE_KEY to send invites." };
  const admin = createAdminClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin") || "";
  const today = todayISO();
  const problems: string[] = [];
  const invited: string[] = [];
  const createdNoEmail: string[] = [];
  let updated = 0;
  let assigned = 0;
  let rates = 0;

  for (const r of rows) {
    if (r.action === "skip") {
      problems.push(`Row ${r.line} (${r.email ?? "no email"}) skipped: ${r.errors.join("; ")}`);
      continue;
    }
    let userId: string;
    if (r.action === "invite") {
      const meta = { full_name: r.name, role: r.role };
      const inv = await admin.auth.admin.inviteUserByEmail(r.email!, { data: meta, redirectTo: `${origin}/auth/callback?next=/account` });
      if (inv.data?.user) {
        userId = inv.data.user.id;
        invited.push(r.email!);
      } else {
        // Usually the hourly email limit. Create the login without an email so their stores are set;
        // send the invite later from Users, or they can use "Email me a link" at sign-in.
        const cr = await admin.auth.admin.createUser({ email: r.email!, email_confirm: false, user_metadata: meta });
        if (!cr.data?.user) {
          problems.push(`${r.email}: couldn’t create the login (${inv.error?.message ?? cr.error?.message ?? "unknown error"})`);
          continue;
        }
        userId = cr.data.user.id;
        createdNoEmail.push(r.email!);
      }
      const { error } = await admin
        .from("profiles")
        .update({ role: r.role, full_name: r.name ?? r.email!.split("@")[0], ...(r.phone ? { phone: r.phone } : {}) })
        .eq("id", userId);
      if (error) problems.push(`${r.email}: profile not updated (${error.message})`);
    } else {
      const existing = ctx.byEmail.get(r.email!)!;
      userId = existing.id;
      const patch: Record<string, unknown> = {};
      if (r.name && r.name !== existing.full_name) patch.full_name = r.name;
      if (r.phone && r.phone !== existing.phone) patch.phone = r.phone;
      if (r.roleGiven && r.role !== existing.role) patch.role = r.role;
      if (Object.keys(patch).length) {
        const { error } = await admin.from("profiles").update(patch).eq("id", userId);
        if (error) problems.push(`${r.email}: ${error.message}`);
      }
      updated++;
    }

    if (r.siteIds.length) {
      const { error } = await admin
        .from("site_members")
        .upsert(r.siteIds.map((site_id) => ({ site_id, user_id: userId })), { onConflict: "site_id,user_id", ignoreDuplicates: true });
      if (error) problems.push(`${r.email}: locations not added (${error.message})`);
      else assigned += r.siteIds.length;
    }
    if (r.hourly_rate != null && r.role !== "manager") {
      const { error } = await ctx.supabase
        .from("tech_rates")
        .upsert({ user_id: userId, hourly_rate: r.hourly_rate, effective_from: today, note: "Set by user import", created_by: ctx.me.id }, { onConflict: "user_id,effective_from" });
      if (error) problems.push(`${r.email}: rate not saved (${error.message})`);
      else rates++;
    }
  }

  revalidatePath("/admin/users");
  revalidatePath("/sites", "layout");
  return { stage: "done", invited, createdNoEmail, updated, assigned, rates, problems };
}
