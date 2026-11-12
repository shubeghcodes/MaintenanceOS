import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_DISPATCH, VENDOR_LINK_DAYS } from "./constants";
import { zonedTimeISO } from "./format";
import { hashToken, linkTokenFor, vendorLink } from "./tokens";
import { emailVendor, loadDispatchContext, workOrderAttachmentsForEmail, type VendorEmailKind } from "./vendor-notify";
import type { WoPriority } from "./types";

/** Send (or re-send) a vendor email and record the outcome on the dispatch. */
export async function sendAndRecord(
  db: SupabaseClient,
  dispatchId: string,
  version: number,
  kind: VendorEmailKind,
  extra: Parameters<typeof emailVendor>[3] = {},
) {
  const ctx = await loadDispatchContext(db, dispatchId);
  if (!ctx) return { ok: false as const, error: "Dispatch not found" };
  const res = await emailVendor(ctx, kind, vendorLink(dispatchId, version), extra);
  const now = new Date().toISOString();
  if (kind === "assigned" || kind === "new_link") {
    await db
      .from("vendor_dispatches")
      .update(
        res.ok
          ? { email_status: "sent", email_error: null, sent_at: now, last_emailed_at: now }
          : { email_status: res.skipped ? "not_configured" : "failed", email_error: res.error },
      )
      .eq("id", dispatchId);
  } else if (res.ok) {
    await db.from("vendor_dispatches").update({ last_emailed_at: now }).eq("id", dispatchId);
  }
  return res;
}

export type CreateDispatchInput = {
  woId: string;
  vendorId: string;
  contactEmail: string;
  contactName?: string | null;
  contactPhone?: string | null;
  instructions?: string | null;
  requestedBy?: string | null; // YYYY-MM-DD
  priority?: WoPriority;
  nteAmount?: number | null;
  includeFiles?: boolean;
  createdBy: string | null; // null = automatic (daily job)
  reason?: string; // shown in the activity log
};

/**
 * Email a work order to an outside vendor with a secure link. Used by "Assign to External Vendor",
 * the compliance calendar and the automatic morning compliance emails.
 * Works with a signed-in staff client or the service-role client.
 */
export async function createDispatch(db: SupabaseClient, input: CreateDispatchInput) {
  const event = (kind: string, body: string, visibility: "internal" | "shared" = "internal") =>
    db.from("work_order_events").insert({ work_order_id: input.woId, user_id: input.createdBy, kind, body, visibility });

  const { data: wo } = await db.from("work_orders").select("id,status,priority,nte_amount").eq("id", input.woId).single();
  if (!wo) return { ok: false as const, error: "Work order not found or not accessible." };
  if (wo.status === "completed" || wo.status === "cancelled") return { ok: false as const, error: "Reopen the work order before sending it to a vendor." };

  // Only one vendor works a job at a time.
  const { data: live } = await db.from("vendor_dispatches").select("id,vendor:vendors(name)").eq("work_order_id", input.woId).in("status", ACTIVE_DISPATCH);
  for (const d of (live ?? []) as unknown as { id: string; vendor: { name: string } | null }[]) {
    await db.from("vendor_dispatches").update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: input.createdBy }).eq("id", d.id);
    await event("dispatch", `Revoked ${d.vendor?.name ?? "previous vendor"}'s access (reassigned)`);
  }

  const woPatch: Record<string, unknown> = { vendor_id: input.vendorId };
  if (input.priority) woPatch.priority = input.priority;
  if (input.nteAmount !== undefined) woPatch.nte_amount = input.nteAmount;
  if (input.requestedBy && input.priority) woPatch.due_at = zonedTimeISO(input.requestedBy);
  if (wo.status === "new") woPatch.status = "assigned";
  const { error: woErr } = await db.from("work_orders").update(woPatch).eq("id", input.woId);
  if (woErr) return { ok: false as const, error: woErr.message };

  const id = crypto.randomUUID();
  const { error } = await db.from("vendor_dispatches").insert({
    id,
    work_order_id: input.woId,
    vendor_id: input.vendorId,
    contact_name: input.contactName ?? null,
    contact_email: input.contactEmail.toLowerCase(),
    contact_phone: input.contactPhone ?? null,
    instructions: input.instructions ?? null,
    requested_by: input.requestedBy ?? null,
    token_hash: hashToken(linkTokenFor(id, 1)),
    token_version: 1,
    token_expires_at: new Date(Date.now() + VENDOR_LINK_DAYS * 86_400_000).toISOString(),
    created_by: input.createdBy,
  });
  if (error) return { ok: false as const, error: error.message };

  const attachments = input.includeFiles ? await workOrderAttachmentsForEmail(db, input.woId) : [];
  const res = await sendAndRecord(db, id, 1, "assigned", { attachments });
  await event(
    "dispatch",
    `${input.reason ?? "Sent to external vendor"} (${input.contactEmail})${res.ok ? "" : ` — email ${"skipped" in res && res.skipped ? "not configured" : "FAILED"}`}`,
  );
  if (input.instructions) await event("comment", `Instructions for vendor: ${input.instructions}`, "shared");
  return { ok: true as const, dispatchId: id, emailOk: res.ok, emailError: res.ok ? null : res.error };
}
