import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashToken } from "./tokens";
import type { ApprovalRequest, Attachment, VendorCostLine, VendorDispatch, VendorInvoice, VendorQuote, WoPriority, WoStatus } from "./types";

export type PortalDispatch = VendorDispatch & { token_version: number; vendor: { id: string; name: string } | null };

export type ResolveResult =
  | { state: "ok"; dispatch: PortalDispatch }
  | { state: "expired" | "revoked" | "declined" | "closed_wo"; dispatch: PortalDispatch }
  | { state: "invalid" };

/** Look up a vendor link. The token is checked by hash; nothing else identifies the dispatch. */
export async function resolveToken(db: SupabaseClient, token: string): Promise<ResolveResult> {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return { state: "invalid" };
  const { data } = await db
    .from("vendor_dispatches")
    .select("*, vendor:vendors(id,name), wo:work_orders(status)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data) return { state: "invalid" };
  const { wo, ...d } = data as PortalDispatch & { wo: { status: WoStatus } | null };
  if (d.status === "revoked") return { state: "revoked", dispatch: d };
  if (d.status === "declined") return { state: "declined", dispatch: d };
  if (wo?.status === "cancelled") return { state: "closed_wo", dispatch: d };
  if (new Date(d.token_expires_at) < new Date()) return { state: "expired", dispatch: d };
  return { state: "ok", dispatch: d };
}

export type PortalData = {
  wo: {
    id: string;
    number: number;
    title: string;
    description: string | null;
    priority: WoPriority;
    status: WoStatus;
    category: string;
    type: string;
    certificate_number: string | null;
    location_detail: string | null;
    nte_amount: number | null;
  };
  site: { name: string; code: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null } | null;
  asset: { name: string; manufacturer: string | null; model: string | null; serial_number: string | null } | null;
  requester: { full_name: string | null; phone: string | null } | null;
  files: (Attachment & { url: string | null })[];
  events: { id: string; kind: string; body: string | null; to_status: WoStatus | null; actor_type: string | null; actor_label: string | null; created_at: string; staff: string | null; meta: Record<string, unknown> | null }[];
  approvals: ApprovalRequest[];
  invoices: (VendorInvoice & { file_url: string | null })[];
  quotes: (VendorQuote & { file_url: string | null })[];
  costs: (VendorCostLine & { file_url: string | null })[];
};

/** Everything the vendor may see — and nothing else (no costs, internal notes, other vendors). */
export async function loadPortal(db: SupabaseClient, d: PortalDispatch): Promise<PortalData> {
  const [{ data: wo }, { data: files }, { data: events }, { data: approvals }, { data: invoices }, { data: quotes }, { data: costs }] = await Promise.all([
    db
      .from("work_orders")
      .select(
        "id,number,title,description,priority,status,category,type,certificate_number,location_detail,nte_amount," +
          "site:sites(name,code,address,city,state,zip,phone), asset:assets(name,manufacturer,model,serial_number)," +
          "requester:profiles!work_orders_requested_by_fkey(full_name,phone)",
      )
      .eq("id", d.work_order_id)
      .single(),
    db.from("attachments").select("*").eq("entity_type", "work_order").eq("entity_id", d.work_order_id).eq("visibility", "shared").order("created_at"),
    db
      .from("work_order_events")
      .select("id,kind,body,to_status,actor_type,actor_label,created_at,meta,user:profiles(full_name)")
      .eq("work_order_id", d.work_order_id)
      .eq("visibility", "shared")
      .gte("created_at", new Date(new Date(d.created_at).getTime() - 60_000).toISOString())
      .order("created_at", { ascending: false }),
    db.from("approval_requests").select("*").eq("dispatch_id", d.id).order("created_at", { ascending: false }),
    db.from("vendor_invoices").select("*").eq("dispatch_id", d.id).order("created_at", { ascending: false }),
    db.from("vendor_quotes").select("*").eq("dispatch_id", d.id).order("created_at", { ascending: false }),
    db.from("vendor_cost_lines").select("*").eq("dispatch_id", d.id).order("created_at"),
  ]);

  const w = wo as unknown as PortalData["wo"] & { site: PortalData["site"]; asset: PortalData["asset"]; requester: PortalData["requester"] };
  // Only this dispatch's uploads (or the original request photos); invoice, quote and receipt files only through their own lists.
  const visible = ((files ?? []) as Attachment[]).filter((f) => (!f.dispatch_id || f.dispatch_id === d.id) && !["invoice", "quote", "receipt"].includes(f.category ?? ""));
  const invoiceRows = (invoices ?? []) as VendorInvoice[];
  const quoteRows = (quotes ?? []) as VendorQuote[];
  const costRows = (costs ?? []) as VendorCostLine[];
  const fileIds = [...invoiceRows, ...quoteRows, ...costRows].map((i) => i.attachment_id).filter(Boolean) as string[];
  const invoiceFiles = fileIds.length ? (((await db.from("attachments").select("*").in("id", fileIds)).data ?? []) as Attachment[]) : [];
  const all = [...visible, ...invoiceFiles];
  const { data: signed } = all.length
    ? await db.storage.from("attachments").createSignedUrls(all.map((f) => f.storage_path), 60 * 60)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const url = (p: string) => signed?.find((s) => s.path === p)?.signedUrl ?? null;
  const fileFor = (id: string | null) => {
    const f = id ? invoiceFiles.find((x) => x.id === id) : null;
    return f ? url(f.storage_path) : null;
  };

  const { site, asset, requester, ...woRest } = w;
  return {
    wo: woRest,
    site,
    asset,
    requester,
    files: visible.map((f) => ({ ...f, url: url(f.storage_path) })),
    events: ((events ?? []) as unknown as (PortalData["events"][number] & { user: { full_name: string | null } | null })[])
      .filter((e) => !e.meta || !e.meta.dispatch_id || e.meta.dispatch_id === d.id)
      .map(({ user, ...e }) => ({ ...e, staff: user?.full_name ?? null })),
    approvals: (approvals ?? []) as ApprovalRequest[],
    invoices: invoiceRows.map((i) => ({ ...i, file_url: fileFor(i.attachment_id) })),
    quotes: quoteRows.map((q) => ({ ...q, file_url: fileFor(q.attachment_id) })),
    costs: costRows.map((c) => ({ ...c, file_url: fileFor(c.attachment_id) })),
  };
}

export function maskEmail(e: string) {
  const [u, dom] = e.split("@");
  return `${u.slice(0, 2)}${"•".repeat(Math.max(1, u.length - 2))}@${dom}`;
}
