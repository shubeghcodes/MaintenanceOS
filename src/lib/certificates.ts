import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysUntil } from "./format";

export type CertRow = {
  id: string;
  requirement_id: string;
  completed_on: string;
  valid_until: string | null;
  result: "pass" | "fail" | "conditional";
  certificate_number: string | null;
  notes: string | null;
  work_order_id: string | null;
  req: { name: string; category: string; authority: string | null; site_id: string; site: { name: string; code: string | null } | null } | null;
  vendor: { name: string } | null;
  wo: { number: number } | null;
  status: "current" | "expiring" | "expired" | "failed" | "superseded";
  files: { id: string; name: string; url: string | null }[];
};

/** Completed compliance work with its certificate files and whether it's still valid. */
export async function loadCertificates(
  db: SupabaseClient,
  f: { site?: string; category?: string; q?: string; view?: string; from?: string; to?: string; company?: string | null },
): Promise<CertRow[]> {
  let q = db
    .from("compliance_records")
    .select(
      "id,requirement_id,completed_on,valid_until,result,certificate_number,notes,work_order_id,created_at," +
        "req:compliance_requirements!inner(name,category,authority,site_id,site:sites(name,code)), vendor:vendors(name), wo:work_orders(number)",
    )
    .order("completed_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2000);
  if (f.company) q = q.eq("req.company_id", f.company);
  if (f.site) q = q.eq("req.site_id", f.site);
  if (f.category) q = q.eq("req.category", f.category);
  if (f.from) q = q.gte("completed_on", f.from);
  if (f.to) q = q.lte("completed_on", f.to);
  const { data } = await q;
  let rows = (data ?? []) as unknown as Omit<CertRow, "status" | "files">[];
  if (f.q) {
    const t = f.q.toLowerCase();
    rows = rows.filter((r) => [r.req?.name, r.certificate_number, r.vendor?.name, r.req?.site?.name, r.req?.site?.code].some((x) => x?.toLowerCase().includes(t)));
  }

  // Latest record per requirement is the one that counts.
  const latest = new Set<string>();
  const seen = new Set<string>();
  for (const r of rows) if (!seen.has(r.requirement_id)) (seen.add(r.requirement_id), latest.add(r.id));
  const withStatus = rows.map((r) => {
    const d = daysUntil(r.valid_until);
    const status: CertRow["status"] = !latest.has(r.id)
      ? "superseded"
      : r.result === "fail"
        ? "failed"
        : d == null || d < 0
          ? "expired"
          : d <= 30
            ? "expiring"
            : "current";
    return { ...r, status };
  });
  const shown = f.view === "all" ? withStatus : withStatus.filter((r) => r.status !== "superseded");

  // Files: linked to the record, or certificate/completion uploads on its work order.
  const ids = shown.map((r) => r.id);
  const woIds = shown.map((r) => r.work_order_id).filter(Boolean) as string[];
  const [{ data: a1 }, { data: a2 }] = await Promise.all([
    ids.length ? db.from("attachments").select("id,file_name,storage_path,compliance_record_id,entity_id").in("compliance_record_id", ids) : Promise.resolve({ data: [] }),
    woIds.length
      ? db.from("attachments").select("id,file_name,storage_path,compliance_record_id,entity_id").eq("entity_type", "work_order").in("entity_id", woIds).in("category", ["certificate", "completion"])
      : Promise.resolve({ data: [] }),
  ]);
  type A = { id: string; file_name: string; storage_path: string; compliance_record_id: string | null; entity_id: string };
  const files = new Map<string, A>();
  for (const a of [...((a1 ?? []) as A[]), ...((a2 ?? []) as A[])]) files.set(a.id, a);
  const all = [...files.values()];
  const { data: signed } = all.length ? await db.storage.from("attachments").createSignedUrls(all.map((a) => a.storage_path), 3600) : { data: [] };
  const url = (p: string) => (signed ?? []).find((s) => s.path === p)?.signedUrl ?? null;

  return shown.map((r) => ({
    ...r,
    files: all
      .filter((a) => a.compliance_record_id === r.id || (r.work_order_id && a.entity_id === r.work_order_id))
      .map((a) => ({ id: a.id, name: a.file_name, url: url(a.storage_path) })),
  }));
}
