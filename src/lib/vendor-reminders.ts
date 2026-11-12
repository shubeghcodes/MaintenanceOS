import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailVendor, loadDispatchContext } from "./vendor-notify";
import { vendorLink } from "./tokens";
import { fmtDate, todayISO } from "./format";

/**
 * Daily nudges, at most one per dispatch per day:
 *  - sent > 24h ago and not accepted/declined
 *  - accepted / in progress and past the requested completion date
 *  - work completed > 3 days ago with no invoice
 */
export async function sendVendorReminders(db: SupabaseClient) {
  const dayAgo = new Date(Date.now() - 23 * 3_600_000).toISOString();
  const { data } = await db
    .from("vendor_dispatches")
    .select("id,status,sent_at,completed_at,requested_by,last_reminded_at,token_version,token_expires_at")
    .in("status", ["sent", "accepted", "in_progress", "work_completed", "closed"])
    .eq("email_status", "sent");
  const rows = (data ?? []) as {
    id: string; status: string; sent_at: string | null; completed_at: string | null; requested_by: string | null;
    last_reminded_at: string | null; token_version: number; token_expires_at: string;
  }[];
  const results: { id: string; reason: string; ok: boolean }[] = [];

  for (const d of rows) {
    if (d.last_reminded_at && d.last_reminded_at > dayAgo) continue;
    if (new Date(d.token_expires_at) < new Date()) continue;
    let reason: string | null = null;
    if (d.status === "sent" && d.sent_at && d.sent_at < dayAgo) {
      reason = "This work order is waiting for your response. Please accept or decline it so we can plan the repair.";
    } else if (["accepted", "in_progress"].includes(d.status) && d.requested_by && d.requested_by < todayISO()) {
      reason = `This work order was requested by ${fmtDate(d.requested_by)} and is still open. Please post an update with your expected completion.`;
    } else if (["work_completed", "closed"].includes(d.status) && d.completed_at && Date.now() - new Date(d.completed_at).getTime() > 3 * 86_400_000) {
      const { count } = await db.from("vendor_invoices").select("id", { count: "exact", head: true }).eq("dispatch_id", d.id);
      if (!count) reason = "We haven't received your invoice for this completed work order yet. You can upload it from the work order page.";
    }
    if (!reason) continue;
    const ctx = await loadDispatchContext(db, d.id);
    if (!ctx) continue;
    const res = await emailVendor(ctx, "reminder", vendorLink(d.id, d.token_version), { reminderReason: reason });
    if (res.ok) await db.from("vendor_dispatches").update({ last_reminded_at: new Date().toISOString() }).eq("id", d.id);
    results.push({ id: d.id, reason, ok: res.ok });
  }
  return results;
}
