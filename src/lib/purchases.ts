import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Purchase } from "./types";

export type PurchaseRow = Purchase & {
  buyer: { id: string; full_name: string | null; email: string | null } | null;
  wo: { id: string; number: number; title: string } | null;
  place: { name: string; code: string | null } | null;
  receipt_url: string | null;
};

/** `site` may be a location id or "shop" (shop / warehouse supplies). `kind`: part | supply. */
export type PurchaseFilters = {
  company?: string | null;
  site?: string;
  from?: string;
  to?: string;
  status?: string;
  method?: string;
  person?: string;
  q?: string;
  category?: string;
  kind?: string;
};

export const placeName = (r: Pick<PurchaseRow, "place">, shop = "Shop / warehouse") => r.place?.code ?? r.place?.name ?? shop;

export async function loadPurchases(db: SupabaseClient, f: PurchaseFilters): Promise<PurchaseRow[]> {
  let q = db
    .from("wo_purchases")
    .select("*, buyer:profiles!wo_purchases_purchased_by_fkey(id,full_name,email), wo:work_orders(id,number,title), place:sites!wo_purchases_site_id_fkey(name,code)")
    .order("purchase_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(3000);
  if (f.company) q = q.eq("company_id", f.company);
  if (f.site === "shop") q = q.is("site_id", null);
  else if (f.site) q = q.eq("site_id", f.site);
  if (f.kind === "part" || f.kind === "supply") q = q.eq("kind", f.kind);
  if (f.from) q = q.gte("purchase_date", f.from);
  if (f.to) q = q.lte("purchase_date", f.to);
  if (f.method) q = q.eq("payment_method", f.method);
  if (f.person) q = q.eq("purchased_by", f.person);
  if (f.category) q = q.eq("category", f.category);
  if (f.status === "review") q = q.eq("status", "submitted");
  else if (f.status === "reimburse") q = q.eq("payment_method", "personal").neq("status", "rejected").is("reimbursed_at", null);
  else if (f.status === "no_receipt") q = q.is("receipt_attachment_id", null);
  else if (f.status) q = q.eq("status", f.status);
  const { data } = await q;
  let rows = (data ?? []) as unknown as Omit<PurchaseRow, "receipt_url">[];
  if (f.q) {
    const t = f.q.toLowerCase();
    rows = rows.filter((r) => [r.store, r.description, r.category, r.wo?.title, r.wo ? String(r.wo.number) : null].some((x) => x?.toLowerCase().includes(t)));
  }
  const ids = rows.map((r) => r.receipt_attachment_id).filter(Boolean) as string[];
  const urls = new Map<string, string>();
  if (ids.length) {
    const { data: files } = await db.from("attachments").select("id,storage_path").in("id", ids);
    const list = (files ?? []) as { id: string; storage_path: string }[];
    const { data: signed } = await db.storage.from("attachments").createSignedUrls(list.map((x) => x.storage_path), 3600);
    list.forEach((x) => {
      const s = signed?.find((y) => y.path === x.storage_path)?.signedUrl;
      if (s) urls.set(x.id, s);
    });
  }
  return rows.map((r) => ({ ...r, receipt_url: r.receipt_attachment_id ? (urls.get(r.receipt_attachment_id) ?? null) : null }));
}
