import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDispatch } from "./dispatch";
import { fmtDate, todayISO } from "./format";

export function complianceInstructions(r: { name: string; authority: string | null; next_due_on: string; scheduled_for: string | null }, note?: string | null) {
  return [
    `Compliance service: ${r.name}${r.authority ? ` (${r.authority})` : ""}.`,
    `Due ${fmtDate(r.next_due_on)}.${r.scheduled_for ? ` Scheduled for ${fmtDate(r.scheduled_for)}.` : " Please reply with your scheduled date."}`,
    "When you mark the work complete, upload the certificate or inspection report and enter the certificate number.",
    note ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

type OpenComplianceWo = {
  id: string;
  number: number;
  vendor_id: string;
  req: { id: string; name: string; authority: string | null; next_due_on: string; scheduled_for: string | null; auto_dispatch: boolean } | null;
  vendor: { id: string; name: string; email: string | null; contact_name: string | null; phone: string | null; active: boolean } | null;
};

/**
 * Morning job (and "Run scheduler now"): email every open compliance work order to its vendor
 * using the secure vendor link, once. Skips items with auto-email off, vendors without an email,
 * and work orders that were already sent (even if that vendor declined — those need a person to reassign).
 */
export async function autoDispatchCompliance(db: SupabaseClient, createdBy: string | null = null) {
  const { data } = await db
    .from("work_orders")
    .select(
      "id,number,vendor_id," +
        "req:compliance_requirements(id,name,authority,next_due_on,scheduled_for,auto_dispatch)," +
        "vendor:vendors(id,name,email,contact_name,phone,active)",
    )
    .eq("type", "compliance")
    .in("status", ["new", "assigned"])
    .not("vendor_id", "is", null);
  const rows = (data ?? []) as unknown as OpenComplianceWo[];
  if (!rows.length) return [];

  const { data: sent } = await db.from("vendor_dispatches").select("work_order_id").in("work_order_id", rows.map((r) => r.id));
  const already = new Set(((sent ?? []) as { work_order_id: string }[]).map((s) => s.work_order_id));

  const results: { number: number; item: string; vendor: string; status: "sent" | "skipped" | "failed"; reason?: string }[] = [];
  for (const w of rows) {
    const base = { number: w.number, item: w.req?.name ?? "", vendor: w.vendor?.name ?? "" };
    if (already.has(w.id)) continue;
    if (!w.req?.auto_dispatch) {
      results.push({ ...base, status: "skipped", reason: "Auto-email is off for this item" });
      continue;
    }
    if (!w.vendor?.active || !w.vendor.email) {
      results.push({ ...base, status: "skipped", reason: "Vendor has no email in the directory" });
      continue;
    }
    const today = todayISO();
    const requested = w.req.scheduled_for ?? (w.req.next_due_on < today ? today : w.req.next_due_on);
    const res = await createDispatch(db, {
      woId: w.id,
      vendorId: w.vendor.id,
      contactEmail: w.vendor.email,
      contactName: w.vendor.contact_name,
      contactPhone: w.vendor.phone,
      requestedBy: requested,
      instructions: complianceInstructions(w.req),
      createdBy,
      reason: "Automatically emailed to vendor (compliance due)",
    });
    results.push({ ...base, status: res.ok && res.emailOk ? "sent" : "failed", reason: res.ok ? (res.emailError ?? undefined) : res.error });
  }
  return results;
}
