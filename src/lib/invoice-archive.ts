import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceStatus } from "./types";

/** One file in the invoice archive: a vendor invoice (any version), an invoice uploaded by staff, or a vendor's cost receipt. */
export type ArchiveRow = {
  key: string;
  type: "vendor_invoice" | "uploaded_invoice" | "vendor_receipt";
  date: string; // invoice date, else upload date (YYYY-MM-DD)
  uploadedAt: string;
  wo: { id: string; number: number; title: string; site: { id: string; name: string; code: string | null } | null } | null;
  vendor: string | null;
  number: string | null;
  amount: number | null;
  status: InvoiceStatus | null;
  version: number | null;
  by: string | null;
  file: { name: string; url: string | null; image: boolean } | null;
};

export type ArchiveFilters = { company?: string | null; site?: string; vendor?: string; from?: string; to?: string; type?: string; status?: string; q?: string };

export const ARCHIVE_TYPE_LABEL: Record<ArchiveRow["type"], string> = {
  vendor_invoice: "Vendor invoice",
  uploaded_invoice: "Invoice (uploaded)",
  vendor_receipt: "Vendor receipt",
};

type WoLite = { id: string; number: number; title: string; site_id: string; company_id: string | null; site: { id: string; name: string; code: string | null } | null };
type AttLite = { id: string; entity_id: string; storage_path: string; file_name: string; content_type: string | null; category: string; uploaded_by_label: string | null; created_at: string; uploader: { full_name: string | null; email: string | null } | null };

const LIMIT = 1000;
const day = (ts: string) => ts.slice(0, 10);

export async function loadInvoiceArchive(db: SupabaseClient, f: ArchiveFilters): Promise<ArchiveRow[]> {
  const ATT = "id,entity_id,storage_path,file_name,content_type,category,uploaded_by_label,created_at,uploader:profiles!attachments_uploaded_by_fkey(full_name,email)";

  // 1) Vendor invoices (every version, with or without a file).
  let iq = db
    .from("vendor_invoices")
    .select("id,work_order_id,invoice_number,invoice_date,amount,status,version,attachment_id,submitted_by_label,created_at,vendor:vendors(id,name)")
    .order("invoice_date", { ascending: false })
    .limit(LIMIT);
  if (f.from) iq = iq.gte("invoice_date", f.from);
  if (f.to) iq = iq.lte("invoice_date", f.to);
  if (f.vendor) iq = iq.eq("vendor_id", f.vendor);
  if (f.status) iq = iq.eq("status", f.status);
  const wantInvoices = !f.type || f.type === "vendor_invoice";
  const { data: inv } = wantInvoices ? await iq : { data: [] };
  const invoices = (inv ?? []) as unknown as {
    id: string; work_order_id: string; invoice_number: string; invoice_date: string; amount: number; status: InvoiceStatus; version: number;
    attachment_id: string | null; submitted_by_label: string | null; created_at: string; vendor: { id: string; name: string } | null;
  }[];

  // 2) Invoice / vendor-receipt files on work orders that aren't a vendor invoice's file.
  const cats = f.type === "uploaded_invoice" ? ["invoice"] : f.type === "vendor_receipt" ? ["vendor_receipt"] : !f.type ? ["invoice", "vendor_receipt"] : [];
  let loose: AttLite[] = [];
  if (cats.length && !f.status && !f.vendor) {
    let aq = db.from("attachments").select(ATT).eq("entity_type", "work_order").in("category", cats).order("created_at", { ascending: false }).limit(LIMIT);
    if (f.from) aq = aq.gte("created_at", f.from);
    if (f.to) aq = aq.lt("created_at", `${f.to}T23:59:59.999`);
    const { data } = await aq;
    loose = (data ?? []) as unknown as AttLite[];
  }

  // Files for the vendor invoices.
  const invFileIds = invoices.map((i) => i.attachment_id).filter(Boolean) as string[];
  const { data: invFilesData } = invFileIds.length ? await db.from("attachments").select(ATT).in("id", invFileIds) : { data: [] };
  const invFiles = new Map(((invFilesData ?? []) as unknown as AttLite[]).map((a) => [a.id, a]));
  const usedIds = new Set(invoices.map((i) => i.attachment_id).filter(Boolean));
  // A vendor invoice's file can also show up as a loose "invoice" file — don't list it twice.
  const { data: allInvFiles } = loose.some((a) => a.category === "invoice")
    ? await db.from("vendor_invoices").select("attachment_id").in("attachment_id", loose.filter((a) => a.category === "invoice").map((a) => a.id))
    : { data: [] };
  ((allInvFiles ?? []) as { attachment_id: string | null }[]).forEach((r) => r.attachment_id && usedIds.add(r.attachment_id));
  loose = loose.filter((a) => !usedIds.has(a.id));

  // Work orders (company / location filters apply here).
  const woIds = [...new Set([...invoices.map((i) => i.work_order_id), ...loose.map((a) => a.entity_id)])];
  const wos = new Map<string, WoLite>();
  for (let i = 0; i < woIds.length; i += 200) {
    const { data } = await db.from("work_orders").select("id,number,title,site_id,company_id,site:sites(id,name,code)").in("id", woIds.slice(i, i + 200));
    ((data ?? []) as unknown as WoLite[]).forEach((w) => wos.set(w.id, w));
  }
  const keep = (woId: string) => {
    const w = wos.get(woId);
    if (!w) return false; // not visible to this admin
    if (f.company && w.company_id !== f.company) return false;
    if (f.site && w.site_id !== f.site) return false;
    return true;
  };

  // Vendor names for loose files (from the dispatch on the work order, best effort).
  const vendorByWo = new Map<string, string>();
  const looseWos = [...new Set(loose.map((a) => a.entity_id))];
  for (let i = 0; i < looseWos.length; i += 200) {
    const { data } = await db.from("vendor_dispatches").select("work_order_id,created_at,vendor:vendors(name)").in("work_order_id", looseWos.slice(i, i + 200)).order("created_at");
    ((data ?? []) as unknown as { work_order_id: string; vendor: { name: string } | null }[]).forEach((d) => d.vendor && vendorByWo.set(d.work_order_id, d.vendor.name));
  }

  const toWo = (id: string): ArchiveRow["wo"] => {
    const w = wos.get(id);
    return w ? { id: w.id, number: w.number, title: w.title, site: w.site } : null;
  };
  const rows: (ArchiveRow & { _att: AttLite | null })[] = [
    ...invoices
      .filter((i) => keep(i.work_order_id))
      .map((i) => {
        const a = i.attachment_id ? (invFiles.get(i.attachment_id) ?? null) : null;
        return {
          key: `i-${i.id}`,
          type: "vendor_invoice" as const,
          date: i.invoice_date,
          uploadedAt: i.created_at,
          wo: toWo(i.work_order_id),
          vendor: i.vendor?.name ?? null,
          number: i.invoice_number,
          amount: Number(i.amount),
          status: i.status,
          version: i.version,
          by: i.submitted_by_label ?? a?.uploaded_by_label ?? null,
          file: null,
          _att: a,
        };
      }),
    ...loose
      .filter((a) => keep(a.entity_id))
      .map((a) => ({
        key: `a-${a.id}`,
        type: a.category === "vendor_receipt" ? ("vendor_receipt" as const) : ("uploaded_invoice" as const),
        date: day(a.created_at),
        uploadedAt: a.created_at,
        wo: toWo(a.entity_id),
        vendor: vendorByWo.get(a.entity_id) ?? null,
        number: null,
        amount: null,
        status: null,
        version: null,
        by: a.uploader?.full_name ?? a.uploader?.email ?? a.uploaded_by_label ?? null,
        file: null,
        _att: a,
      })),
  ];

  let out = rows;
  if (f.q) {
    const t = f.q.toLowerCase().replace(/^#/, "");
    out = out.filter((r) =>
      [r.vendor, r.number, r.wo?.title, r.wo ? String(r.wo.number) : null, r.wo?.site?.name, r.wo?.site?.code, r._att?.file_name].some((x) => x?.toLowerCase().includes(t)),
    );
  }
  out.sort((a, b) => (a.date === b.date ? b.uploadedAt.localeCompare(a.uploadedAt) : b.date.localeCompare(a.date)));

  // Signed links, 1 hour.
  const atts = out.map((r) => r._att).filter(Boolean) as AttLite[];
  const view = new Map<string, string>();
  for (let i = 0; i < atts.length; i += 100) {
    const chunk = atts.slice(i, i + 100);
    const { data } = await db.storage.from("attachments").createSignedUrls(chunk.map((a) => a.storage_path), 3600);
    data?.forEach((s) => s.path && s.signedUrl && view.set(s.path, s.signedUrl));
  }
  return out.map(({ _att, ...r }) => ({
    ...r,
    file: _att
      ? { name: _att.file_name, url: view.get(_att.storage_path) ?? null, image: !!_att.content_type?.startsWith("image/") }
      : null,
  }));
}
