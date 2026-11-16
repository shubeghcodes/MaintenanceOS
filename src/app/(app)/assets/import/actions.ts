"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { getCompanyScope, inCompany } from "@/lib/company";
import { parseAssetFile, type AssetImportRow } from "@/lib/asset-import";

export type AssetPreviewRow = AssetImportRow & {
  action: "create" | "update" | "skip";
  siteId: string | null;
  siteLabel: string | null;
  matchNote: string | null;
};

export type AssetImportState =
  | { stage: "idle" }
  | { stage: "error"; message: string }
  | {
      stage: "preview";
      fileName: string;
      rows: AssetPreviewRow[];
      unknownHeaders: string[];
      counts: { create: number; update: number; skip: number };
      bySite: { label: string; count: number }[];
    }
  | { stage: "done"; created: number; updated: number; problems: string[]; bySite: { label: string; count: number }[] };

type Site = { id: string; code: string | null; name: string };
type Existing = { id: string; site_id: string; name: string; tag: string | null; serial_number: string | null };

const key = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const label = (s: Site) => (s.code ? `#${s.code} · ${s.name}` : s.name);

async function loadContext(defaultSiteId: string | null) {
  const { supabase } = await requireRole("admin");
  const { companyId } = await getCompanyScope();
  const [{ data: s }, { data: a }] = await Promise.all([
    inCompany(supabase.from("sites").select("id,code,name").eq("active", true), companyId),
    inCompany(supabase.from("assets").select("id,site_id,name,tag,serial_number"), companyId).limit(20000),
  ]);
  const sites = (s ?? []) as Site[];
  const assets = (a ?? []) as Existing[];
  const byCode = new Map<string, Site>();
  const byName = new Map<string, Site[]>();
  for (const x of sites) {
    if (x.code) byCode.set(key(x.code), x);
    byName.set(key(x.name), [...(byName.get(key(x.name)) ?? []), x]);
  }
  const defaultSite = sites.find((x) => x.id === defaultSiteId) ?? null;

  /** Store # first ("101", "#101", "DT-101"), then exact name, then "101 · Name" / "101 - Name" forms. */
  const findSite = (raw: string | null): Site | "ambiguous" | null => {
    if (!raw) return defaultSite;
    const k = key(raw);
    if (byCode.has(k)) return byCode.get(k)!;
    const byN = byName.get(k);
    if (byN?.length === 1) return byN[0];
    if (byN && byN.length > 1) return "ambiguous";
    const lead = raw.match(/^\s*#?\s*([A-Za-z0-9-]+)\s*[·\-–|:]/);
    if (lead && byCode.has(key(lead[1]))) return byCode.get(key(lead[1]))!;
    // "101" when the store # is saved as "0101" or "DT-101": compare just the digits.
    const digits = (v: string) => v.replace(/\D/g, "").replace(/^0+/, "");
    if (digits(raw) && digits(raw) === k.replace(/^0+/, "")) {
      const hits = sites.filter((x) => x.code && digits(x.code) === digits(raw));
      if (hits.length === 1) return hits[0];
    }
    return null;
  };

  /** Same location: serial #, then barcode/tag, then the name if only one asset there has it. */
  const findAsset = (siteId: string, r: AssetImportRow) => {
    const here = assets.filter((x) => x.site_id === siteId);
    if (r.serial_number) {
      const hit = here.find((x) => x.serial_number && key(x.serial_number) === key(r.serial_number!));
      if (hit) return { hit, how: "serial #" };
    }
    if (r.tag) {
      const hit = here.find((x) => x.tag && key(x.tag) === key(r.tag!));
      if (hit) return { hit, how: "barcode" };
    }
    if (r.name && !r.serial_number) {
      const same = here.filter((x) => key(x.name) === key(r.name!) && !x.serial_number);
      if (same.length === 1) return { hit: same[0], how: "name" };
    }
    return null;
  };
  return { supabase, findSite, findAsset, defaultSite };
}

function annotate(rows: AssetImportRow[], ctx: Awaited<ReturnType<typeof loadContext>>): AssetPreviewRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const site = ctx.findSite(r.site);
    let siteId: string | null = null;
    let siteLabel: string | null = null;
    if (site === "ambiguous") r.errors.push(`Location “${r.site}” matches more than one site; use the store #`);
    else if (!site) r.errors.push(r.site ? `Location “${r.site}” not found on the Sites page` : "No location (fill in Location, or pick one above)");
    else {
      siteId = site.id;
      siteLabel = label(site);
    }
    // Same asset twice in the file?
    if (siteId && r.name) {
      const k = `${siteId}|${r.serial_number ? `s:${key(r.serial_number)}` : r.tag ? `t:${key(r.tag)}` : `n:${key(r.name)}:${r.line}`}`;
      if (seen.has(k)) r.errors.push(`Same serial #/barcode as row ${seen.get(k)} at this location`);
      else seen.set(k, r.line);
    }
    const m = siteId && !r.errors.length ? ctx.findAsset(siteId, r) : null;
    const action = r.errors.length ? "skip" : m ? "update" : "create";
    return { ...r, action, siteId, siteLabel, matchNote: m ? `Matches existing by ${m.how}` : null };
  });
}

const tally = (rows: AssetPreviewRow[]) => {
  const m = new Map<string, number>();
  rows.filter((r) => r.action !== "skip").forEach((r) => m.set(r.siteLabel!, (m.get(r.siteLabel!) ?? 0) + 1));
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
};

export async function importAssets(_prev: AssetImportState, fd: FormData): Promise<AssetImportState> {
  const intent = fd.get("intent") === "import" ? "import" : "preview";
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { stage: "error", message: "Choose an Excel (.xlsx) or CSV file first." };
  let parsed: Awaited<ReturnType<typeof parseAssetFile>>;
  try {
    parsed = await parseAssetFile(file);
  } catch (e) {
    return { stage: "error", message: e instanceof Error ? e.message : "Couldn’t read that file." };
  }
  const ctx = await loadContext((fd.get("default_site") as string) || null);
  const rows = annotate(parsed.rows, ctx);
  const counts = {
    create: rows.filter((r) => r.action === "create").length,
    update: rows.filter((r) => r.action === "update").length,
    skip: rows.filter((r) => r.action === "skip").length,
  };
  if (intent === "preview") return { stage: "preview", fileName: file.name, rows, unknownHeaders: parsed.unknownHeaders, counts, bySite: tally(rows) };

  const problems: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  let updated = 0;
  for (const r of rows) {
    if (r.action === "skip") {
      problems.push(`Row ${r.line} (${r.name ?? "no name"}) skipped: ${r.errors.join("; ")}`);
      continue;
    }
    const full = {
      site_id: r.siteId!,
      name: r.name!,
      category: r.category,
      status: r.status,
      location_detail: r.location_detail,
      tag: r.tag,
      manufacturer: r.manufacturer,
      model: r.model,
      serial_number: r.serial_number,
      description: r.description,
      purchase_date: r.purchase_date,
      install_date: r.install_date,
      service_date: r.service_date,
      warranty_expires_on: r.warranty_expires_on,
      purchase_cost: r.purchase_cost,
      expected_life_years: r.expected_life_years,
      parts: r.parts,
      notes: r.notes,
    };
    const m = ctx.findAsset(r.siteId!, r);
    if (m) {
      // Blank cells never erase what's already saved.
      const patch = Object.fromEntries(Object.entries(full).filter(([, v]) => v !== null && v !== undefined));
      const { error } = await ctx.supabase.from("assets").update(patch).eq("id", m.hit.id);
      if (error) problems.push(`Row ${r.line} (${r.name}): ${error.message}`);
      else updated++;
    } else inserts.push(full);
  }
  let created = 0;
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500);
    const { error } = await ctx.supabase.from("assets").insert(chunk);
    if (error) problems.push(`Rows ${i + 1}–${i + chunk.length} of the new assets: ${error.message}`);
    else created += chunk.length;
  }
  revalidatePath("/assets");
  revalidatePath("/sites", "layout");
  revalidatePath("/");
  return { stage: "done", created, updated, problems, bySite: tally(rows) };
}
