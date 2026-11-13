"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { num, str, todayISO, zonedTimeISO } from "@/lib/format";
import { hashToken, linkTokenFor } from "@/lib/tokens";
import { createDispatch, sendAndRecord } from "@/lib/dispatch";
import { workOrderAttachmentsForEmail } from "@/lib/vendor-notify";
import { ACTIVE_DISPATCH, VENDOR_LINK_DAYS } from "@/lib/constants";
import type { InvoiceStatus, Profile, WoPriority } from "@/lib/types";

const back: (woId: string, q: string) => never = (woId, q) => redirect(`/work-orders/${woId}?${q}`);
const fail: (woId: string, msg: string) => never = (woId, msg) => back(woId, `error=${encodeURIComponent(msg)}`);

async function staff() {
  const s = await getSession();
  if (!(s.profile.role === "admin" || s.profile.role === "tech")) redirect("/");
  return s;
}

async function logEvent(
  db: SupabaseClient,
  e: { work_order_id: string; user_id: string; kind: string; body: string; visibility?: "internal" | "shared"; meta?: Record<string, unknown> },
) {
  await db.from("work_order_events").insert({ visibility: "internal", ...e });
}

function refresh(woId: string) {
  revalidatePath(`/work-orders/${woId}`);
  revalidatePath("/vendor-jobs");
  revalidatePath("/work-orders");
  revalidatePath("/");
}

// ---------------------------------------------------------------- Assign to External Vendor

export async function dispatchToVendor(fd: FormData) {
  const { supabase, profile } = await staff();
  const woId = str(fd, "work_order_id")!;
  const formBack: (msg: string) => never = (msg) => redirect(`/work-orders/${woId}/dispatch?error=${encodeURIComponent(msg)}`);

  const contactEmail = str(fd, "contact_email")?.toLowerCase();
  if (!contactEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) formBack("A valid vendor email is required.");

  // Existing vendor, or quick-add a new one to the directory.
  let vendorId = str(fd, "vendor_id");
  if (!vendorId || vendorId === "new") {
    const name = str(fd, "new_vendor_name");
    if (!name) formBack("Pick a vendor or enter the new company's name.");
    const { data: v, error } = await createAdminClient()
      .from("vendors")
      .insert({
        name,
        contact_name: str(fd, "contact_name"),
        email: contactEmail,
        phone: str(fd, "contact_phone"),
        trades: (str(fd, "new_vendor_trade") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      })
      .select("id")
      .single();
    if (error || !v) formBack(error?.message ?? "Couldn't add vendor");
    vendorId = v.id as string;
  } else if (fd.get("save_contact") === "on") {
    // Fill in missing directory contact details from what was typed.
    const { data: v } = await supabase.from("vendors").select("email,phone,contact_name").eq("id", vendorId).single();
    if (v && (!v.email || !v.phone || !v.contact_name)) {
      await createAdminClient()
        .from("vendors")
        .update({
          email: v.email || contactEmail,
          phone: v.phone || str(fd, "contact_phone"),
          contact_name: v.contact_name || str(fd, "contact_name"),
        })
        .eq("id", vendorId);
    }
  }

  const res = await createDispatch(supabase, {
    woId,
    vendorId,
    contactEmail,
    contactName: str(fd, "contact_name"),
    contactPhone: str(fd, "contact_phone"),
    instructions: str(fd, "instructions"),
    requestedBy: str(fd, "requested_by"),
    priority: (str(fd, "priority") ?? "medium") as WoPriority,
    nteAmount: num(fd, "nte_amount"),
    quoteRequired: fd.get("quote_required") === "on",
    includeFiles: fd.get("include_files") === "on",
    createdBy: profile.id,
  });
  if (!res.ok) formBack(res.error);
  refresh(woId);
  back(woId, res.emailOk ? "vendor=sent" : `error=${encodeURIComponent(`Saved, but the email didn't go out: ${res.emailError}. Use “Resend link” once fixed.`)}`);
}

// ---------------------------------------------------------------- link management

export async function resendLink(fd: FormData) {
  const { supabase, profile } = await staff();
  const id = str(fd, "dispatch_id")!;
  const { data: d } = await supabase.from("vendor_dispatches").select("id,work_order_id,token_version,status,email_status").eq("id", id).single();
  if (!d) redirect("/vendor-jobs");
  if (!ACTIVE_DISPATCH.includes(d.status)) fail(d.work_order_id, "That vendor assignment is no longer active.");

  // New version = new link; the old link stops working immediately.
  const version = d.token_version + 1;
  await supabase
    .from("vendor_dispatches")
    .update({
      token_version: version,
      token_hash: hashToken(linkTokenFor(id, version)),
      token_expires_at: new Date(Date.now() + VENDOR_LINK_DAYS * 86_400_000).toISOString(),
    })
    .eq("id", id);
  const firstSuccessful = d.email_status !== "sent";
  const attachments = firstSuccessful ? await workOrderAttachmentsForEmail(supabase, d.work_order_id) : [];
  const res = await sendAndRecord(supabase, id, version, firstSuccessful ? "assigned" : "new_link", { attachments });
  await logEvent(supabase, { work_order_id: d.work_order_id, user_id: profile.id, kind: "dispatch", body: `Emailed vendor a new link${res.ok ? "" : " — email failed"}` });
  refresh(d.work_order_id);
  back(d.work_order_id, res.ok ? "vendor=resent" : `error=${encodeURIComponent(`Email failed: ${res.error}`)}`);
}

export async function revokeLink(fd: FormData) {
  const { supabase, profile } = await staff();
  const id = str(fd, "dispatch_id")!;
  const { data: d } = await supabase
    .from("vendor_dispatches")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: profile.id })
    .eq("id", id)
    .in("status", ACTIVE_DISPATCH)
    .select("work_order_id")
    .maybeSingle();
  if (!d) redirect("/vendor-jobs");
  await logEvent(supabase, { work_order_id: d.work_order_id, user_id: profile.id, kind: "dispatch", body: "Revoked the vendor's access link" });
  refresh(d.work_order_id);
  back(d.work_order_id, "vendor=revoked");
}

/** Change instructions / date / priority / NTE and tell the vendor. */
export async function updateDispatch(fd: FormData) {
  const { supabase, profile } = await staff();
  const id = str(fd, "dispatch_id")!;
  const { data: d } = await supabase.from("vendor_dispatches").select("id,work_order_id,token_version,status").eq("id", id).single();
  if (!d) redirect("/vendor-jobs");
  const requestedBy = str(fd, "requested_by");
  await supabase
    .from("vendor_dispatches")
    .update({ instructions: str(fd, "instructions"), requested_by: requestedBy, quote_required: fd.get("quote_required") === "on" })
    .eq("id", id);
  await supabase
    .from("work_orders")
    .update({ priority: str(fd, "priority") ?? "medium", nte_amount: num(fd, "nte_amount"), ...(requestedBy && { due_at: zonedTimeISO(requestedBy) }) })
    .eq("id", d.work_order_id);
  const note = str(fd, "note");
  let emailed = false;
  if (fd.get("notify") === "on" && ACTIVE_DISPATCH.includes(d.status)) {
    emailed = (await sendAndRecord(supabase, id, d.token_version, "updated", { note })).ok;
  }
  await logEvent(supabase, {
    work_order_id: d.work_order_id,
    user_id: profile.id,
    kind: "comment",
    body: `Updated vendor details${note ? `: ${note}` : ""}${emailed ? " (vendor emailed)" : ""}`,
    visibility: "shared",
  });
  refresh(d.work_order_id);
  back(d.work_order_id, "vendor=updated");
}

export async function messageVendor(fd: FormData) {
  const { supabase, profile } = await staff();
  const id = str(fd, "dispatch_id")!;
  const body = str(fd, "body");
  const { data: d } = await supabase.from("vendor_dispatches").select("id,work_order_id,token_version,status").eq("id", id).single();
  if (!d || !body) redirect("/vendor-jobs");
  await logEvent(supabase, { work_order_id: d.work_order_id, user_id: profile.id, kind: "comment", body, visibility: "shared", meta: { to_vendor: true } });
  const res = ACTIVE_DISPATCH.includes(d.status) || d.status === "closed" ? await sendAndRecord(supabase, id, d.token_version, "message", { note: body }) : null;
  refresh(d.work_order_id);
  back(d.work_order_id, res && !res.ok ? `error=${encodeURIComponent(`Message saved, email failed: ${res.error}`)}` : "vendor=messaged");
}

// ---------------------------------------------------------------- approvals

export async function decideApproval(decision: "approved" | "rejected", fd: FormData) {
  const { supabase, profile } = await staff();
  const approvalId = str(fd, "approval_id")!;
  const note = str(fd, "note");
  const { data: a } = await supabase
    .from("approval_requests")
    .update({ status: decision, decided_by: profile.id, decided_at: new Date().toISOString(), decision_note: note })
    .eq("id", approvalId)
    .eq("status", "pending")
    .select("id,work_order_id,dispatch_id,amount,description")
    .maybeSingle();
  if (!a) redirect("/vendor-jobs?error=That+request+was+already+decided");

  // Approved spend raises the not-to-exceed.
  const { data: wo } = await supabase.from("work_orders").select("nte_amount,status").eq("id", a.work_order_id).single();
  const woPatch: Record<string, unknown> = {};
  if (decision === "approved" && a.amount != null && wo?.nte_amount != null) woPatch.nte_amount = Number(wo.nte_amount) + Number(a.amount);

  // Back to work once nothing else is waiting.
  const { count } = await supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("dispatch_id", a.dispatch_id).eq("status", "pending");
  if (!count) {
    await supabase.from("vendor_dispatches").update({ status: "in_progress" }).eq("id", a.dispatch_id).eq("status", "pending_approval");
    if (wo?.status === "pending_approval") woPatch.status = "in_progress";
  }
  if (Object.keys(woPatch).length) await supabase.from("work_orders").update(woPatch).eq("id", a.work_order_id);

  await logEvent(supabase, {
    work_order_id: a.work_order_id,
    user_id: profile.id,
    kind: "approval",
    body: `${decision === "approved" ? "Approved" : "Rejected"} additional work${a.amount != null ? ` ($${Number(a.amount).toFixed(2)})` : ""}${note ? `: ${note}` : ""}`,
    visibility: "shared",
  });
  const { data: d } = await supabase.from("vendor_dispatches").select("token_version").eq("id", a.dispatch_id).single();
  if (d) await sendAndRecord(supabase, a.dispatch_id, d.token_version, "approval_decision", { decision, note, amount: a.amount });
  refresh(a.work_order_id);
  back(a.work_order_id, `vendor=${decision}`);
}

// ---------------------------------------------------------------- quotes

/** Approve or reject a vendor's quote. Approving makes the quoted amount the not-to-exceed. */
export async function decideQuote(decision: "approved" | "rejected", fd: FormData) {
  const { supabase, profile } = await staff();
  const quoteId = str(fd, "quote_id")!;
  const note = str(fd, "note");
  const { data: q0 } = await supabase.from("vendor_quotes").select("work_order_id").eq("id", quoteId).maybeSingle();
  if (!q0) redirect("/vendor-jobs");
  if (decision === "rejected" && !note) fail(q0.work_order_id, "Tell the vendor why the quote wasn't approved (or what to change).");
  const { data: q } = await supabase
    .from("vendor_quotes")
    .update({ status: decision, decided_by: profile.id, decided_at: new Date().toISOString(), decision_note: note })
    .eq("id", quoteId)
    .eq("status", "submitted")
    .select("id,work_order_id,dispatch_id,amount,quote_number")
    .maybeSingle();
  if (!q) fail(q0.work_order_id, "That quote was already decided or replaced by a revision.");

  if (decision === "approved") await supabase.from("work_orders").update({ nte_amount: q.amount }).eq("id", q.work_order_id);
  const amt = `$${Number(q.amount).toFixed(2)}`;
  await logEvent(supabase, {
    work_order_id: q.work_order_id,
    user_id: profile.id,
    kind: "quote",
    body: `${decision === "approved" ? `Approved quote${q.quote_number ? ` ${q.quote_number}` : ""} (${amt}); not-to-exceed set to ${amt}` : `Did not approve quote${q.quote_number ? ` ${q.quote_number}` : ""} (${amt})`}${note ? `: ${note}` : ""}`,
    visibility: "shared",
  });
  const { data: d } = await supabase.from("vendor_dispatches").select("token_version,status").eq("id", q.dispatch_id).single();
  if (d && ACTIVE_DISPATCH.includes(d.status)) await sendAndRecord(supabase, q.dispatch_id, d.token_version, "quote_decision", { decision, note, amount: q.amount });
  refresh(q.work_order_id);
  back(q.work_order_id, `vendor=quote_${decision}`);
}

// ---------------------------------------------------------------- completed work review

export async function reviewWork(decision: "close" | "send_back", fd: FormData) {
  const { supabase, profile } = await staff();
  const id = str(fd, "dispatch_id")!;
  const note = str(fd, "note");
  const { data: d } = await supabase.from("vendor_dispatches").select("id,work_order_id,token_version,status,completion_notes").eq("id", id).single();
  if (!d) redirect("/vendor-jobs");
  if (d.status !== "work_completed") fail(d.work_order_id, "This work isn't waiting for review.");

  if (decision === "close") {
    const { error } = await supabase
      .from("work_orders")
      .update({ status: "completed", resolution_notes: d.completion_notes })
      .eq("id", d.work_order_id);
    if (error) fail(d.work_order_id, error.message);
    if (note) await logEvent(supabase, { work_order_id: d.work_order_id, user_id: profile.id, kind: "comment", body: `Review: ${note}`, visibility: "shared" });
  } else {
    if (!note) fail(d.work_order_id, "Tell the vendor what needs follow-up.");
    await supabase.from("vendor_dispatches").update({ status: "in_progress", completed_at: null }).eq("id", id);
    await supabase.from("work_orders").update({ status: "in_progress" }).eq("id", d.work_order_id);
    await logEvent(supabase, { work_order_id: d.work_order_id, user_id: profile.id, kind: "comment", body: `Sent back to vendor: ${note}`, visibility: "shared" });
    await sendAndRecord(supabase, id, d.token_version, "sent_back", { note });
  }
  refresh(d.work_order_id);
  back(d.work_order_id, decision === "close" ? "vendor=closed" : "vendor=sent_back");
}

// ---------------------------------------------------------------- invoices

const NEXT: Record<InvoiceStatus, InvoiceStatus[]> = {
  submitted: ["under_review", "approved", "rejected"],
  under_review: ["approved", "rejected"],
  approved: ["paid", "rejected"],
  rejected: [],
  paid: [],
};

export async function reviewInvoice(to: InvoiceStatus, fd: FormData) {
  const { supabase, profile } = await getSession();
  const invoiceId = str(fd, "invoice_id")!;
  const { data: inv } = await supabase.from("vendor_invoices").select("id,work_order_id,dispatch_id,status,amount,invoice_number").eq("id", invoiceId).single();
  if (!inv) redirect("/vendor-jobs");
  if ((profile as Profile).role !== "admin") fail(inv.work_order_id, "Only admins can review invoices.");
  if (!NEXT[inv.status as InvoiceStatus].includes(to)) fail(inv.work_order_id, "That invoice has already moved on.");
  const note = str(fd, "note");
  if (to === "rejected" && !note) fail(inv.work_order_id, "Tell the vendor what to correct.");

  const patch: Record<string, unknown> = { status: to, reviewed_by: profile.id, reviewed_at: new Date().toISOString() };
  if (note) patch.review_note = note;
  if (to === "paid") {
    patch.paid_at = str(fd, "paid_at") ?? todayISO();
    patch.payment_reference = str(fd, "payment_reference");
  }
  const { data: updated, error } = await supabase.from("vendor_invoices").update(patch).eq("id", invoiceId).eq("status", inv.status).select("id");
  if (error) fail(inv.work_order_id, error.message);
  if (!updated?.length) fail(inv.work_order_id, "That invoice was just changed by someone else — refresh and try again.");

  const label = { under_review: "Marked invoice under review", approved: "Approved invoice", rejected: "Requested invoice revision", paid: "Marked invoice paid", submitted: "" }[to];
  await logEvent(supabase, {
    work_order_id: inv.work_order_id,
    user_id: profile.id,
    kind: "invoice",
    body: `${label} ${inv.invoice_number} ($${Number(inv.amount).toFixed(2)})${to === "paid" && patch.payment_reference ? ` · ref ${patch.payment_reference}` : ""}${note ? `: ${note}` : ""}`,
    visibility: "shared",
  });
  if (inv.dispatch_id && to !== "under_review") {
    const { data: d } = await supabase.from("vendor_dispatches").select("token_version").eq("id", inv.dispatch_id).single();
    if (d) await sendAndRecord(supabase, inv.dispatch_id, d.token_version, "invoice_decision", { decision: to, note, amount: inv.amount, invoiceNumber: inv.invoice_number });
  }
  refresh(inv.work_order_id);
  back(inv.work_order_id, `vendor=invoice_${to}`);
}

