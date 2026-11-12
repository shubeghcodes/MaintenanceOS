"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileProblems, saveAttachments } from "@/lib/attachments";
import { num, str, todayISO } from "@/lib/format";
import { maskEmail, resolveToken, type PortalDispatch } from "@/lib/vendor-portal";
import { hashToken, linkTokenFor, vendorLink } from "@/lib/tokens";
import { emailVendor, loadDispatchContext, notifyManagement, type MgmtEventKind } from "@/lib/vendor-notify";
import { VENDOR_LINK_DAYS } from "@/lib/constants";
import type { DispatchStatus, WoStatus } from "@/lib/types";

const NAME_COOKIE = "mos_vendor_name";

type Ctx = { db: SupabaseClient; d: PortalDispatch; token: string; actor: string; audit: Record<string, unknown> };

const go: (token: string, q: string) => never = (token, q) => redirect(`/v/${token}${q ? `?${q}` : ""}#top`);
const oops: (token: string, msg: string) => never = (token, msg) => go(token, `error=${encodeURIComponent(msg)}`);

/** Validate the link and identify who is acting. Every action starts here. */
async function begin(token: string, fd: FormData | null): Promise<Ctx> {
  const db = createAdminClient();
  const r = await resolveToken(db, token);
  if (r.state !== "ok") go(token, "");
  const d = r.dispatch;
  const jar = await cookies();
  const typed = fd ? str(fd, "actor") : null;
  const actor = (typed ?? jar.get(NAME_COOKIE)?.value ?? d.contact_name ?? d.vendor?.name ?? "Vendor").slice(0, 80);
  if (typed) jar.set(NAME_COOKIE, typed.slice(0, 80), { httpOnly: true, sameSite: "lax", path: "/v", maxAge: 60 * 60 * 24 * 365 });
  const h = await headers();
  const audit = {
    dispatch_id: d.id,
    via: "vendor_link",
    ip: (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim() || null,
    user_agent: h.get("user-agent")?.slice(0, 200) ?? null,
  };
  return { db, d, token, actor: `${actor}${d.vendor?.name && !actor.includes(d.vendor.name) ? ` · ${d.vendor.name}` : ""}`, audit };
}

/** Move the dispatch from one of `from` to `to`. Returns false if it was already moved (double-click, second tab). */
async function transition(c: Ctx, from: DispatchStatus[], to: DispatchStatus, extra: Record<string, unknown> = {}) {
  const { data } = await c.db.from("vendor_dispatches").update({ status: to, ...extra }).eq("id", c.d.id).in("status", from).select("id");
  return !!data?.length;
}

async function setWoStatus(c: Ctx, status: WoStatus, opts: { resolution?: string | null; clearVendor?: boolean } = {}) {
  const { error } = await c.db.rpc("vendor_portal_set_status", {
    p_work_order: c.d.work_order_id,
    p_status: status,
    p_actor: c.actor,
    p_resolution: opts.resolution ?? null,
    p_clear_vendor: opts.clearVendor ?? false,
  });
  if (error) throw new Error(error.message);
}

async function log(c: Ctx, kind: string, body: string, meta: Record<string, unknown> = {}, clientKey?: string | null) {
  const { error } = await c.db.from("work_order_events").insert({
    work_order_id: c.d.work_order_id,
    kind,
    body,
    actor_type: "vendor",
    actor_label: c.actor,
    visibility: "shared",
    meta: { ...c.audit, ...meta },
    client_key: clientKey ?? null,
  });
  return !error || error.code !== "23505" ? { duplicate: false } : { duplicate: true };
}

async function tell(c: Ctx, kind: MgmtEventKind, detail: Parameters<typeof notifyManagement>[4] = {}) {
  const ctx = await loadDispatchContext(c.db, c.d.id);
  if (ctx) await notifyManagement(c.db, ctx, kind, c.actor, detail);
}

function done(c: Ctx, what: string) {
  revalidatePath(`/work-orders/${c.d.work_order_id}`);
  revalidatePath("/vendor-jobs");
  go(c.token, `ok=${what}`);
}

// ------------------------------------------------------------------ actions

export async function acceptJob(token: string, fd: FormData) {
  const c = await begin(token, fd);
  if (!(await transition(c, ["sent"], "accepted", { accepted_at: new Date().toISOString() }))) go(token, "");
  await log(c, "vendor", "Accepted the work order");
  await tell(c, "accepted");
  done(c, "accepted");
}

export async function declineJob(token: string, fd: FormData) {
  const c = await begin(token, fd);
  const reason = str(fd, "reason");
  if (!reason) oops(token, "Please give a reason so we can reassign the job.");
  if (!(await transition(c, ["sent", "accepted"], "declined", { declined_at: new Date().toISOString(), decline_reason: reason }))) go(token, "");
  const { data: wo } = await c.db.from("work_orders").select("assigned_tech_id,status").eq("id", c.d.work_order_id).single();
  await setWoStatus(c, wo?.assigned_tech_id ? "assigned" : "new", { clearVendor: true });
  await log(c, "vendor", `Declined the work order: ${reason}`);
  await tell(c, "declined", { note: reason });
  done(c, "declined");
}

export async function startWork(token: string, fd: FormData) {
  const c = await begin(token, fd);
  const now = new Date().toISOString();
  if (!(await transition(c, ["sent", "accepted"], "in_progress", { started_at: now, accepted_at: c.d.accepted_at ?? now }))) go(token, "");
  await setWoStatus(c, "in_progress");
  await log(c, "vendor", "Started work on site");
  await tell(c, "started");
  done(c, "started");
}

export async function postUpdate(token: string, fd: FormData) {
  const c = await begin(token, fd);
  if (!["accepted", "in_progress", "pending_approval", "work_completed"].includes(c.d.status)) oops(token, "Updates aren't open for this work order.");
  const notes = str(fd, "notes");
  const files = fd.getAll("photos");
  const bad = fileProblems(files);
  if (bad) oops(token, bad);
  const hasFiles = files.some((f) => f instanceof File && f.size > 0);
  if (!notes && !hasFiles) oops(token, "Add a note or at least one photo.");
  const materials = str(fd, "materials");
  const needs = str(fd, "needs") ?? "none";
  const key = str(fd, "client_key");

  const r = await log(c, "vendor_update", notes ?? "Uploaded photos", { materials, needs }, key);
  if (r.duplicate) go(token, "ok=update");
  const saved = await saveAttachments(c.db, "work_order", c.d.work_order_id, null, files, {
    category: str(fd, "photo_kind") ?? "photo",
    dispatchId: c.d.id,
    label: c.actor,
  });
  if (hasFiles && saved.length === 0) oops(token, "Your note was saved, but the photos didn't upload. Please try them again.");
  await tell(c, "update", {
    note: [notes, materials && `Materials: ${materials}`, needs !== "none" && `Needs ${needs === "parts" ? "parts" : needs === "visit" ? "another visit" : "parts + another visit"}`, saved.length && `${saved.length} photo(s)`]
      .filter(Boolean)
      .join("\n"),
  });
  done(c, "update");
}

export async function requestApproval(token: string, fd: FormData) {
  const c = await begin(token, fd);
  if (!["accepted", "in_progress", "pending_approval"].includes(c.d.status)) oops(token, "Approval requests aren't open for this work order.");
  const description = str(fd, "description");
  if (!description) oops(token, "Describe the additional work or expense.");
  const amount = num(fd, "amount");
  const { error } = await c.db.from("approval_requests").insert({
    dispatch_id: c.d.id,
    work_order_id: c.d.work_order_id,
    description,
    amount,
    requested_by_label: c.actor,
    client_key: str(fd, "client_key"),
  });
  if (error?.code === "23505") go(token, "ok=approval");
  if (error) oops(token, "Couldn't send the request. Please try again.");
  await transition(c, ["accepted", "in_progress"], "pending_approval");
  await setWoStatus(c, "pending_approval");
  await log(c, "vendor", `Requested approval for additional work${amount != null ? ` ($${amount.toFixed(2)})` : ""}: ${description}`);
  await tell(c, "approval_requested", { note: description, amount });
  done(c, "approval");
}

type InvoiceInput = { number: string; date: string; amount: number; file: File; notes: string | null; key: string | null };

/**
 * Read invoice fields (optionally prefixed, e.g. "inv_" on the completion form).
 * Returns null when the vendor left the invoice section empty, or an error message if it's half filled.
 */
function readInvoice(fd: FormData, prefix = ""): InvoiceInput | null | string {
  const number = str(fd, `${prefix}invoice_number`);
  const amount = num(fd, `${prefix}amount`);
  const file = fd.get(`${prefix}invoice_file`);
  const hasFile = file instanceof File && file.size > 0;
  if (!number && amount == null && !hasFile) return null;
  if (!number || amount == null || amount < 0) return "To include your invoice, enter the invoice number and total.";
  if (!hasFile) return "To include your invoice, attach the invoice file (PDF, JPG or PNG).";
  const bad = fileProblems([file]);
  if (bad) return bad;
  return { number, date: str(fd, `${prefix}invoice_date`) ?? todayISO(), amount, file, notes: str(fd, `${prefix}notes`), key: str(fd, `${prefix}client_key`) };
}

/** Save an invoice for this dispatch. Safe against double-submits (client key) and duplicate open invoices. */
async function saveInvoice(c: Ctx, inv: InvoiceInput): Promise<{ ok: true; duplicate?: boolean; revised: boolean } | { ok: false; error: string }> {
  if (inv.key) {
    const { data: dup } = await c.db.from("vendor_invoices").select("id").eq("dispatch_id", c.d.id).eq("client_key", inv.key).maybeSingle();
    if (dup) return { ok: true, duplicate: true, revised: false };
  }
  const { data: prev } = await c.db.from("vendor_invoices").select("id,status,version").eq("dispatch_id", c.d.id).order("created_at", { ascending: false }).limit(1);
  const last = prev?.[0];
  if (last && last.status !== "rejected") return { ok: false, error: "An invoice is already in review. You can submit a revision if one is requested." };
  const [attachmentId] = await saveAttachments(c.db, "work_order", c.d.work_order_id, null, [inv.file], { category: "invoice", dispatchId: c.d.id, label: c.actor });
  if (!attachmentId) return { ok: false, error: "The invoice file didn't upload. Check your connection and try again." };
  const { error } = await c.db.from("vendor_invoices").insert({
    work_order_id: c.d.work_order_id,
    dispatch_id: c.d.id,
    vendor_id: c.d.vendor_id,
    invoice_number: inv.number,
    invoice_date: inv.date,
    amount: inv.amount,
    notes: inv.notes,
    attachment_id: attachmentId,
    version: (last?.version ?? 0) + 1,
    submitted_by_label: c.actor,
    client_key: inv.key,
  });
  if (error?.code === "23505") return { ok: true, duplicate: true, revised: false };
  if (error) return { ok: false, error: "Couldn't save the invoice. Please try again." };
  await log(c, "invoice", `Submitted ${last ? "revised " : ""}invoice ${inv.number} for $${inv.amount.toFixed(2)}`);
  return { ok: true, revised: !!last };
}

export async function completeWork(token: string, fd: FormData) {
  const c = await begin(token, fd);
  const notes = str(fd, "work_performed");
  if (!notes) oops(token, "Describe the work performed.");
  const files = fd.getAll("photos");
  const certFiles = fd.getAll("certificate_files");
  const bad = fileProblems([...files, ...certFiles]);
  if (bad) oops(token, bad);
  const certNo = str(fd, "certificate_number");
  const { data: wo } = await c.db.from("work_orders").select("type").eq("id", c.d.work_order_id).single();
  const isCompliance = wo?.type === "compliance";
  if (isCompliance && !certFiles.some((f) => f instanceof File && f.size > 0)) {
    oops(token, "Please attach the certificate or inspection report for this compliance service.");
  }
  // Optional invoice on the same form — validate it before completing so nothing is half done.
  const invoice = readInvoice(fd, "inv_");
  if (typeof invoice === "string") oops(token, invoice);

  const now = new Date().toISOString();
  if (!(await transition(c, ["accepted", "in_progress", "pending_approval"], "work_completed", { completed_at: now, completion_notes: notes, started_at: c.d.started_at ?? now })))
    go(token, "");
  await saveAttachments(c.db, "work_order", c.d.work_order_id, null, files, { category: "completion", dispatchId: c.d.id, label: c.actor });
  const certIds = await saveAttachments(c.db, "work_order", c.d.work_order_id, null, certFiles, { category: "certificate", dispatchId: c.d.id, label: c.actor });
  if (certNo) await c.db.from("work_orders").update({ certificate_number: certNo }).eq("id", c.d.work_order_id);
  if (isCompliance) await log(c, "vendor", `Uploaded certificate${certNo ? ` #${certNo}` : ""} (${certIds.length} file${certIds.length === 1 ? "" : "s"})`);
  await setWoStatus(c, "pending_review", { resolution: notes });
  await log(c, "vendor", `Marked work complete: ${notes}`);

  const inv = invoice ? await saveInvoice(c, invoice) : null;
  // One email to the team covering both.
  await tell(c, "completed", {
    note: notes + (invoice && inv?.ok ? `\n\nInvoice ${invoice.number} submitted with completion.` : ""),
    ...(invoice && inv?.ok ? { amount: invoice.amount, invoiceNumber: invoice.number } : {}),
  });
  if (inv && !inv.ok) go(token, `ok=completed&error=${encodeURIComponent(`Work marked complete, but the invoice wasn't saved: ${inv.error} Please submit it in the Invoice section below.`)}`);
  done(c, invoice ? "completed_invoice" : "completed");
}

export async function submitInvoice(token: string, fd: FormData) {
  const c = await begin(token, fd);
  if (!["work_completed", "closed"].includes(c.d.status)) oops(token, "Mark the work complete before submitting an invoice.");
  const invoice = readInvoice(fd);
  if (!invoice) oops(token, "Invoice number, total and the invoice file are required.");
  if (typeof invoice === "string") oops(token, invoice);
  const r = await saveInvoice(c, invoice);
  if (!r.ok) oops(token, r.error);
  if (!r.duplicate) await tell(c, "invoice", { amount: invoice.amount, invoiceNumber: invoice.number, note: invoice.notes });
  done(c, "invoice");
}

/** From an expired link: email a fresh one to the address on file (never to a typed address). */
export async function requestNewLink(token: string) {
  const db = createAdminClient();
  const r = await resolveToken(db, token);
  if (r.state !== "expired") go(token, "");
  const d = r.dispatch;
  const sentTo = `sent=${encodeURIComponent(maskEmail(d.contact_email))}`;
  if (d.last_emailed_at && Date.now() - new Date(d.last_emailed_at).getTime() < 10 * 60_000) go(token, sentTo);
  const version = d.token_version + 1;
  await db
    .from("vendor_dispatches")
    .update({
      token_version: version,
      token_hash: hashToken(linkTokenFor(d.id, version)),
      token_expires_at: new Date(Date.now() + VENDOR_LINK_DAYS * 86_400_000).toISOString(),
      last_emailed_at: new Date().toISOString(),
    })
    .eq("id", d.id);
  const ctx = await loadDispatchContext(db, d.id);
  if (ctx) {
    await emailVendor(ctx, "new_link", vendorLink(d.id, version));
    await db.from("work_order_events").insert({
      work_order_id: d.work_order_id,
      kind: "dispatch",
      body: "Vendor requested a new link (old one expired); emailed to the address on file",
      actor_type: "vendor",
      actor_label: d.contact_name ?? d.vendor?.name ?? "Vendor",
      visibility: "internal",
    });
  }
  go(token, sentTo); // the old token no longer resolves, so the page shows the "new link sent" message
}
