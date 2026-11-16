"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { emailApprovalNeeded, emailGmsNote, emailPartRequested, notifyNote, emailRequesterApproved, emailRequesterDeclined, emailTechAssigned, emailTechSentBack } from "@/lib/wo-notify";
import { afterClosed, afterWorkDone } from "@/lib/signoff";
import { sendAndRecord } from "@/lib/dispatch";
import { ACTIVE_DISPATCH, HOLD_REASONS } from "@/lib/constants";
import { getSession, isSuper } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailCancelledDispatches } from "@/lib/vendor-notify";
import { saveAttachments } from "@/lib/attachments";
import { fmtDate, num, str, zonedTimeISO } from "@/lib/format";
import type { WoStatus } from "@/lib/types";

function fail(id: string | null, msg: string): never {
  redirect(`${id ? `/work-orders/${id}` : "/work-orders/new"}?error=${encodeURIComponent(msg)}`);
}

export async function createWorkOrder(fd: FormData) {
  const { supabase, profile } = await getSession();
  if (profile.role === "vendor") fail(null, "Vendors can't create work orders");

  const isStaff = profile.role === "admin" || profile.role === "tech";
  const dueDate = str(fd, "due_date");
  const row = {
    site_id: str(fd, "site_id"),
    asset_id: str(fd, "asset_id"),
    title: str(fd, "title"),
    description: str(fd, "description"),
    category: str(fd, "category") ?? "Other",
    location_detail: str(fd, "location_detail"),
    priority: str(fd, "priority") ?? "medium",
    requested_by: profile.id,
    ...(isStaff && {
      type: str(fd, "type") ?? "reactive",
      // Only admins assign a technician or vendor (also enforced in the database).
      ...(profile.role === "admin" && { assigned_tech_id: str(fd, "assigned_tech_id"), vendor_id: str(fd, "vendor_id") }),
      nte_amount: num(fd, "nte_amount"),
      due_at: dueDate ? zonedTimeISO(dueDate) : null,
      scheduled_date: str(fd, "scheduled_date"),
      scheduled_start: str(fd, "scheduled_start"),
      estimated_hours: num(fd, "estimated_hours"),
    }),
  };
  if (!row.site_id || !row.title) fail(null, "Site and title are required");

  const { data, error } = await supabase.from("work_orders").insert(row).select("id,status,assigned_tech_id").single();
  if (error || !data) fail(null, error?.message ?? "Could not create work order");
  // Requests from GMs and techs wait for an admin; admins' own work orders go straight to the tech.
  if (data.status === "requested") after(() => emailApprovalNeeded(data.id));
  else if (data.assigned_tech_id) after(() => emailTechAssigned(data.id, profile.id));

  await saveAttachments(supabase, "work_order", data.id, profile.id, fd.getAll("files"));
  revalidatePath("/work-orders");
  revalidatePath("/");
  redirect(`/work-orders/${data.id}?created=${data.status === "requested" ? "approval" : "1"}`);
}

/** Admin approves a request and assigns it to a technician in one step. */
export async function approveWorkOrder(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (profile.role !== "admin") fail(id, "Only an admin can approve work orders");
  const techId = str(fd, "assigned_tech_id");
  if (!techId) fail(id, "Pick the technician to assign, or send it to a vendor instead");
  const { data: wo } = await supabase.from("work_orders").select("status").eq("id", id).maybeSingle();
  if (!wo) fail(id, "Work order not found");
  if (wo.status !== "requested") fail(id, "This work order was already approved or closed");

  const scheduled = str(fd, "scheduled_date");
  const dueDate = str(fd, "due_date");
  const { error } = await supabase
    .from("work_orders")
    .update({
      assigned_tech_id: techId,
      priority: str(fd, "priority") ?? "medium",
      category: str(fd, "category") ?? "Other",
      scheduled_date: scheduled,
      scheduled_start: scheduled ? str(fd, "scheduled_start") : null,
      estimated_hours: num(fd, "estimated_hours"),
      ...(dueDate && { due_at: zonedTimeISO(dueDate) }),
    })
    .eq("id", id);
  if (error) fail(id, error.message);
  const note = str(fd, "note");
  await supabase.from("work_order_events").insert({ work_order_id: id, user_id: profile.id, kind: "system", body: `Approved${note ? `: ${note}` : ""}` });
  after(async () => {
    await emailTechAssigned(id, profile.id, note);
    await emailRequesterApproved(id, profile.id, "tech", note);
  });
  revalidateWo(id);
  redirect(`/work-orders/${id}?approved=tech`);
}

/** Admin declines a request; the person who asked gets the reason. */
export async function declineWorkOrder(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (profile.role !== "admin") fail(id, "Only an admin can decline work orders");
  const reason = str(fd, "reason");
  if (!reason) fail(id, "Give a reason so the requester knows why");
  const { data: wo } = await supabase.from("work_orders").select("status").eq("id", id).maybeSingle();
  if (!wo || wo.status !== "requested") fail(id, "Only work orders waiting for approval can be declined");
  const { error } = await supabase.from("work_orders").update({ status: "cancelled" }).eq("id", id);
  if (error) fail(id, error.message);
  await supabase.from("work_order_events").insert({ work_order_id: id, user_id: profile.id, kind: "comment", body: `Not approved: ${reason}` });
  after(() => emailRequesterDeclined(id, profile.id, reason));
  revalidateWo(id);
  redirect(`/work-orders/${id}?approved=declined`);
}

/** GM (or admin) confirms the work is done: closes the work order. */
export async function signOffWorkOrder(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (!(profile.role === "manager" || profile.role === "admin")) fail(id, "Only the store's GM or an admin can sign off");
  const { data: wo } = await supabase.from("work_orders").select("status").eq("id", id).maybeSingle();
  if (!wo || wo.status !== "awaiting_signoff") fail(id, "This work order isn't waiting for sign-off");
  const note = str(fd, "note");
  const { error } = await supabase
    .from("work_orders")
    .update({ status: "completed", signed_off_at: new Date().toISOString(), signoff_note: note })
    .eq("id", id);
  if (error) fail(id, error.message);
  await supabase
    .from("work_order_events")
    .insert({ work_order_id: id, user_id: profile.id, kind: "system", body: `Signed off: confirmed fixed${note ? `. ${note}` : ""}` });
  after(() => afterClosed(id, profile.id, note));
  revalidateWo(id);
  redirect(`/work-orders/${id}?signoff=done`);
}

/** Admin closes a job the GM hasn't signed off, with a reason. */
export async function closeForGm(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (profile.role !== "admin") fail(id, "Only an admin can close this for the GM");
  const reason = str(fd, "reason");
  if (!reason) fail(id, "Give a reason for closing without the GM's sign-off");
  const { data: wo } = await supabase.from("work_orders").select("status").eq("id", id).maybeSingle();
  if (!wo || wo.status !== "awaiting_signoff") fail(id, "This work order isn't waiting for sign-off");
  const { error } = await supabase
    .from("work_orders")
    .update({ status: "completed", signed_off_at: new Date().toISOString(), signoff_note: reason })
    .eq("id", id);
  if (error) fail(id, error.message);
  await supabase.from("work_order_events").insert({ work_order_id: id, user_id: profile.id, kind: "system", body: `Closed without GM sign-off: ${reason}` });
  after(() => afterClosed(id, profile.id));
  revalidateWo(id);
  redirect(`/work-orders/${id}?signoff=closed`);
}

/** GM (or admin) says it isn't fixed: back to the same tech or vendor as a return visit. */
export async function sendBackNotFixed(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (!(profile.role === "manager" || profile.role === "admin")) fail(id, "Only the store's GM or an admin can send this back");
  const note = str(fd, "note");
  if (!note) fail(id, "Say what's still wrong so the tech or vendor knows");
  const { data: wo } = await supabase.from("work_orders").select("status").eq("id", id).maybeSingle();
  if (!wo || wo.status !== "awaiting_signoff") fail(id, "This work order isn't waiting for sign-off");
  const { error } = await supabase.from("work_orders").update({ status: "in_progress" }).eq("id", id);
  if (error) fail(id, error.message);
  // Shared, so a vendor sees it on their link too.
  await supabase.from("work_order_events").insert({ work_order_id: id, user_id: profile.id, kind: "comment", body: `Not fixed: ${note}`, visibility: "shared" });

  // A vendor job reopens on their link and they get the note; otherwise the tech is emailed.
  const db = createAdminClient();
  const { data: d } = await db
    .from("vendor_dispatches")
    .select("id,token_version,status")
    .eq("work_order_id", id)
    .in("status", [...ACTIVE_DISPATCH, "closed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (d) {
    await db.from("vendor_dispatches").update({ status: "in_progress", completed_at: null, closed_at: null }).eq("id", d.id);
    after(() => sendAndRecord(db, d.id, d.token_version, "sent_back", { note }));
  } else {
    after(() => emailTechSentBack(id, profile.id, note));
  }
  revalidateWo(id);
  redirect(`/work-orders/${id}?signoff=sent_back`);
}

function revalidateWo(id: string) {
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/work-orders");
  revalidatePath("/schedule");
  revalidatePath("/my-day");
  revalidatePath("/");
}

const ALLOWED: Record<string, WoStatus[]> = {
  admin: ["new", "assigned", "in_progress", "on_hold", "completed", "cancelled"],
  tech: ["assigned", "in_progress", "on_hold", "completed"],
  vendor: ["in_progress", "on_hold", "completed"],
  manager: ["cancelled"], // managers can withdraw their own request while it's still new
};

/** Bound per button: setStatus.bind(null, "completed"). */
export async function setStatus(status: WoStatus, fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  const note = str(fd, "note");

  if (!ALLOWED[profile.role]?.includes(status)) fail(id, "You can't set that status");
  if (status === "on_hold" && profile.role === "tech") fail(id, "Fill in the progress report to put this job on hold");

  const { data: wo } = await supabase.from("work_orders").select("status,requested_by").eq("id", id).single();
  if (!wo) fail(id, "Work order not found");
  if (profile.role === "manager" && (!["requested", "new"].includes(wo.status) || wo.requested_by !== profile.id)) {
    fail(id, "Only requests you submitted that haven't been started can be cancelled");
  }
  if (wo.status === "requested" && profile.role !== "admin" && status !== "cancelled") fail(id, "This work order is waiting for approval by an admin");

  // A tech starting the job starts their timer too (timer_start also sets the job In progress).
  let timer: string | null = null;
  if (status === "in_progress" && profile.role === "tech" && wo.status !== "in_progress") {
    const { data: t, error: tErr } = await supabase.rpc("timer_start", { p_wo: id });
    if (tErr && /clock in first/i.test(tErr.message)) redirect(`/my-day?clockin=${id}#clock`);
    if (tErr) fail(id, tErr.message);
    const pausedWo = (t as { paused_wo: number | null } | null)?.paused_wo;
    timer = pausedWo ? `started_paused_${pausedWo}` : "started";
  }

  const patch: Record<string, unknown> = { status };
  if (status === "completed") {
    const notes = str(fd, "resolution_notes");
    if (notes) patch.resolution_notes = notes;
    const cert = str(fd, "certificate_number");
    if (cert) patch.certificate_number = cert;
  }
  const savedAt = new Date(Date.now() - 2000).toISOString();
  const { error } = await supabase.from("work_orders").update(patch).eq("id", id);
  if (error) fail(id, error.message);

  if (note) {
    await supabase.from("work_order_events").insert({ work_order_id: id, user_id: profile.id, kind: "comment", body: note });
    after(() => emailGmsNote(id, { body: note, authorId: profile.id }));
  }
  // Store jobs now wait for the GM's sign-off; others close and send the closing emails.
  if (status === "cancelled") after(() => emailCancelledDispatches(createAdminClient(), id, savedAt));
  if (status === "completed" && wo.status !== "completed") after(() => afterWorkDone(id, profile.id));
  if (status === "on_hold") await stopMyTimer(supabase, id, profile.id, profile.role === "admin");
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/work-orders");
  revalidatePath("/my-day");
  revalidatePath("/schedule");
  revalidatePath("/labor");
  revalidatePath("/");
  if (timer) redirect(`/work-orders/${id}?timer=${timer}#time`);
}

/**
 * Putting a job on hold stops the timer on it (time so far is kept; starting again opens a new entry).
 * A tech stops their own; an admin stops everyone's on that job.
 */
async function stopMyTimer(supabase: Awaited<ReturnType<typeof getSession>>["supabase"], woId: string, userId: string, everyone = false) {
  let q = supabase.from("time_entries").select("id").eq("work_order_id", woId).in("status", ["running", "paused"]);
  if (!everyone) q = q.eq("user_id", userId);
  const { data } = await q;
  for (const e of (data ?? []) as { id: string }[]) await supabase.rpc("timer_change", { p_entry: e.id, p_action: "stop" });
}

export async function updateAssignment(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (!(profile.role === "admin" || profile.role === "tech")) fail(id, "Not allowed");

  const savedAt = new Date(Date.now() - 2000).toISOString();
  const { data: before } = await supabase.from("work_orders").select("status,assigned_tech_id,vendor_id").eq("id", id).maybeSingle();
  if (before?.status === "requested") fail(id, "Approve this work order first (use Approve & assign)");
  const dueDate = str(fd, "due_date");
  // Only admins choose who does the work; techs can still adjust the schedule and details.
  const isAdmin = profile.role === "admin";
  const techId = isAdmin ? str(fd, "assigned_tech_id") : before?.assigned_tech_id ?? null;
  const { error } = await supabase
    .from("work_orders")
    .update({
      ...(isAdmin && { assigned_tech_id: techId, vendor_id: str(fd, "vendor_id") }),
      priority: str(fd, "priority") ?? "medium",
      type: str(fd, "type") ?? "reactive",
      category: str(fd, "category") ?? "Other",
      nte_amount: num(fd, "nte_amount"),
      scheduled_date: str(fd, "scheduled_date"),
      scheduled_start: str(fd, "scheduled_date") ? str(fd, "scheduled_start") : null,
      estimated_hours: num(fd, "estimated_hours"),
      ...(dueDate && { due_at: zonedTimeISO(dueDate) }),
    })
    .eq("id", id);
  if (error) fail(id, error.message);
  if (before?.vendor_id) after(() => emailCancelledDispatches(createAdminClient(), id, savedAt));
  if (techId && techId !== before?.assigned_tech_id) after(() => emailTechAssigned(id, profile.id));
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/schedule");
  revalidatePath("/my-day");
}

export async function updateCosts(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (profile.role === "manager") fail(id, "Not allowed");

  const patch: Record<string, unknown> = {
    vendor_invoice_amount: num(fd, "vendor_invoice_amount") ?? 0,
    invoice_number: str(fd, "invoice_number"),
    resolution_notes: str(fd, "resolution_notes"),
  };
  // Labor comes from time entries now; only other parts are typed in here.
  if (profile.role !== "vendor") patch.parts_cost = num(fd, "parts_cost") ?? 0;
  const { error } = await supabase.from("work_orders").update(patch).eq("id", id);
  if (error) fail(id, error.message);
  revalidatePath(`/work-orders/${id}`);
}

export async function addComment(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  const body = str(fd, "body");
  // Admins and techs can keep a note from the store's GM (pricing, vendor issues).
  const staffOnly = fd.get("staff_only") === "on" && (profile.role === "admin" || profile.role === "tech");
  if (body) {
    const { error } = await supabase
      .from("work_order_events")
      .insert({ work_order_id: id, user_id: profile.id, kind: "comment", body, staff_only: staffOnly });
    if (error) fail(id, error.message);
    if (profile.role !== "vendor") after(() => notifyNote(id, { body, authorId: profile.id, staffOnly }));
    else after(() => emailGmsNote(id, { body, authorId: profile.id }));
  }
  revalidatePath(`/work-orders/${id}`);
}

export async function uploadWoFiles(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  const saved = await saveAttachments(supabase, "work_order", id, profile.id, fd.getAll("files"), {
    visibility: fd.get("internal") === "on" ? "internal" : "shared",
    category: ["certificate", "document", "invoice"].includes(str(fd, "category") ?? "") ? str(fd, "category")! : "photo",
  });
  const n = saved.length;
  if (n > 0) {
    await supabase
      .from("work_order_events")
      .insert({ work_order_id: id, user_id: profile.id, kind: "system", body: `Uploaded ${n} file${n > 1 ? "s" : ""}` });
  }
  revalidatePath(`/work-orders/${id}`);
}

export async function deleteWorkOrder(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (!isSuper(profile)) fail(id, "Only a super admin can delete work orders");
  // Keep the paper trail: invoices and receipts stay reviewable under Analytics → Invoices / Purchases.
  const [{ count: inv }, { count: files }, { count: rec }] = await Promise.all([
    supabase.from("vendor_invoices").select("id", { count: "exact", head: true }).eq("work_order_id", id),
    supabase.from("attachments").select("id", { count: "exact", head: true }).eq("entity_type", "work_order").eq("entity_id", id).in("category", ["invoice", "vendor_receipt"]),
    supabase.from("wo_purchases").select("id", { count: "exact", head: true }).eq("work_order_id", id),
  ]);
  if ((inv ?? 0) + (files ?? 0) + (rec ?? 0) > 0) fail(id, "This work order has invoices or receipts, so it can't be deleted. Cancel it instead; its records stay on file.");
  const { error } = await supabase.from("work_orders").delete().eq("id", id);
  if (error) fail(id, error.message);
  revalidatePath("/work-orders");
  redirect("/work-orders");
}

/**
 * Technician puts a job on hold. A progress report is required: work done so far, why it's on hold,
 * what's left / the next step, plus optional parts needed, expected return date and photos.
 * The tech's running timer on this job is paused, and the store's GMs get the report by email.
 */
export async function putOnHoldWithReport(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (!(profile.role === "tech" || profile.role === "admin")) fail(id, "You can't put this job on hold");

  const workDone = str(fd, "work_done");
  const reason = str(fd, "hold_reason");
  const nextSteps = str(fd, "next_steps");
  const parts = str(fd, "parts_needed");
  const returnOn = str(fd, "return_on");
  if (!workDone || !reason || !HOLD_REASONS[reason] || !nextSteps) {
    fail(id, "Progress report: work done, reason for hold and what's left are required");
  }
  if (reason === "parts" && !parts) fail(id, "Progress report: list the parts you're waiting on");

  const { data: wo } = await supabase.from("work_orders").select("status").eq("id", id).single();
  if (!wo) fail(id, "Work order not found");
  if (["requested", "awaiting_signoff", "completed", "cancelled", "on_hold"].includes(wo.status)) fail(id, "This job can't be put on hold right now");

  const { error } = await supabase.from("work_orders").update({ status: "on_hold" }).eq("id", id);
  if (error) fail(id, error.message);

  // Pause this tech's running timer on the job.
  const { data: running } = await supabase
    .from("time_entries")
    .select("id")
    .eq("work_order_id", id)
    .eq("user_id", profile.id)
    .eq("status", "running");
  for (const t of running ?? []) await supabase.rpc("timer_change", { p_entry: t.id, p_action: "pause" });

  const saved = await saveAttachments(supabase, "work_order", id, profile.id, fd.getAll("files"));
  const body = [
    `On hold: ${HOLD_REASONS[reason]}`,
    `Work done: ${workDone}`,
    `What's left / next step: ${nextSteps}`,
    parts && `Parts needed: ${parts}`,
    returnOn && `Expected back: ${fmtDate(returnOn)}`,
  ]
    .filter(Boolean)
    .join("\n");
  await supabase.from("work_order_events").insert({
    work_order_id: id,
    user_id: profile.id,
    kind: "progress_report",
    body,
    meta: { hold_reason: reason, work_done: workDone, next_steps: nextSteps, parts_needed: parts, return_on: returnOn, files: saved.length },
  });
  after(() => emailGmsNote(id, { body: `Progress report — ${body}`, authorId: profile.id }));

  // Waiting on parts: open a part request from what they typed, unless parts are already being tracked.
  if (reason === "parts" && parts) {
    const { count } = await supabase
      .from("wo_parts")
      .select("id", { count: "exact", head: true })
      .eq("work_order_id", id)
      .in("status", ["requested", "approved", "ordered"]);
    if (!count) {
      const { data: part } = await supabase.from("wo_parts").insert({ work_order_id: id, name: parts.slice(0, 200), quantity: 1 }).select("id").single();
      if (part) after(() => emailPartRequested(part.id, profile.id));
    }
  }

  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/work-orders");
  revalidatePath("/my-day");
  revalidatePath("/schedule");
  revalidatePath("/");
  await stopMyTimer(supabase, id, profile.id, profile.role === "admin");
  revalidatePath("/my-day");
  revalidatePath("/labor");
  redirect(`/work-orders/${id}?held=1${reason === "parts" ? "#parts" : ""}`);
}
