"use server";

import { getCompanyScope } from "@/lib/company";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { parseSiteFile, type ImportRow } from "@/lib/site-import";

export type PreviewRow = ImportRow & {
  action: "create" | "update" | "skip";
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
      counts: { create: number; update: number; skip: number; moves: number };
    }
  | {
      stage: "done";
      created: number;
      updated: number;
      problems: string[];
    };

type ExistingSite = { id: string; code: string | null; name: string; company_id: string | null };
type Company = { id: string; name: string; legal_name: string | null; active: boolean };

/** Loose company-name key: case, punctuation and spaces ignored. */
const coKey = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
/** Same, also without a trailing legal suffix (Inc, LLC, Corp…). */
const coBase = (s: string) => coKey(s).replace(/(incorporated|inc|llc|lllp|llp|lp|ltd|limited|corporation|corp|company|co|pllc|pc)$/, "");

async function loadContext() {
  const { supabase } = await requireRole("admin");
  const [{ data: s }, scope] = await Promise.all([supabase.from("sites").select("id,code,name,company_id"), getCompanyScope()]);
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
  const byCode = new Map(sites.filter((x) => x.code).map((x) => [x.code!.toLowerCase(), x]));
  const byName = new Map(sites.map((x) => [x.name.toLowerCase(), x]));
  // With a Store #, match on it only (many stores can share a name). Name is the fallback for rows without one.
  const match = (r: ImportRow) => (r.code ? byCode.get(r.code.toLowerCase()) : r.name ? byName.get(r.name.toLowerCase()) : undefined);
  return { supabase, match, findCompany, companyName, defaultCompanyId, companiesEnabled: scope.enabled };
}

function annotate(rows: ImportRow[], ctx: Awaited<ReturnType<typeof loadContext>>): PreviewRow[] {
  return rows.map((r) => {
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
    return { ...r, action, companyId, companyLabel: companyId ? ctx.companyName.get(companyId) ?? null : null, companyNote };
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
    return {
      stage: "preview",
      fileName: file.name,
      rows,
      unknownHeaders: parsed.unknownHeaders,
      counts: {
        create: rows.filter((r) => r.action === "create").length,
        update: rows.filter((r) => r.action === "update").length,
        skip: rows.filter((r) => r.action === "skip").length,
        moves: rows.filter((r) => r.action === "update" && r.companyNote?.startsWith("Moves")).length,
      },
    };
  }

  // ---------- Import ----------
  const { supabase } = ctx;
  const problems: string[] = [];
  let created = 0;
  let updated = 0;

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
    const existing = ctx.match(r);
    if (existing) {
      // Only overwrite fields that have a value in the file; blanks never erase data.
      const patch: Record<string, unknown> = Object.fromEntries(Object.entries(full).filter(([, v]) => v !== null && v !== undefined));
      // A company in the file moves the site (its work orders, assets and history follow it).
      if (r.company && r.companyId && r.companyId !== existing.company_id) patch.company_id = r.companyId;
      const { error } = await supabase.from("sites").update(patch).eq("id", existing.id);
      if (error) problems.push(`Row ${r.line} (${r.name}): ${error.message}`);
      else updated++;
    } else {
      const { data, error } = await supabase.from("sites").insert({ ...full, company_id: r.companyId ?? undefined } as typeof full).select("id").single();
      if (error || !data) problems.push(`Row ${r.line} (${r.name}): ${error?.message ?? "insert failed"}`);
      else created++;
    }
  }

  revalidatePath("/sites");
  revalidatePath("/admin/users");
  revalidatePath("/");
  return { stage: "done", created, updated, problems };
}
