"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { emailApprovalNeeded, emailGmsNote, emailRequesterApproved, emailRequesterDeclined, emailTechAssigned, emailTechSentBack } from "@/lib/wo-notify";
import { afterClosed, afterWorkDone } from "@/lib/signoff";
import { sendAndRecord } from "@/lib/dispatch";
import { ACTIVE_DISPATCH } from "@/lib/constants";
import { getSession, isSuper } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveAttachments } from "@/lib/attachments";
import { num, str, zonedTimeISO } from "@/lib/format";
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
      assigned_tech_id: str(fd, "assigned_tech_id"),
      vendor_id: str(fd, "vendor_id"),
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

  const { data: wo } = await supabase.from("work_orders").select("status,requested_by").eq("id", id).single();
  if (!wo) fail(id, "Work order not found");
  if (profile.role === "manager" && (!["requested", "new"].includes(wo.status) || wo.requested_by !== profile.id)) {
    fail(id, "Only requests you submitted that haven't been started can be cancelled");
  }
  if (wo.status === "requested" && profile.role !== "admin" && status !== "cancelled") fail(id, "This work order is waiting for approval by an admin");

  const patch: Record<string, unknown> = { status };
  if (status === "completed") {
    const notes = str(fd, "resolution_notes");
    if (notes) patch.resolution_notes = notes;
    const cert = str(fd, "certificate_number");
    if (cert) patch.certificate_number = cert;
  }
  const { error } = await supabase.from("work_orders").update(patch).eq("id", id);
  if (error) fail(id, error.message);

  if (note) {
    await supabase.from("work_order_events").insert({ work_order_id: id, user_id: profile.id, kind: "comment", body: note });
    after(() => emailGmsNote(id, { body: note, authorId: profile.id }));
  }
  // Store jobs now wait for the GM's sign-off; others close and send the closing emails.
  if (status === "completed" && wo.status !== "completed") after(() => afterWorkDone(id, profile.id));
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/work-orders");
  revalidatePath("/my-day");
  revalidatePath("/schedule");
  revalidatePath("/");
}

export async function updateAssignment(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (!(profile.role === "admin" || profile.role === "tech")) fail(id, "Not allowed");

  const { data: before } = await supabase.from("work_orders").select("status,assigned_tech_id").eq("id", id).maybeSingle();
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
  if (body) {
    const { error } = await supabase
      .from("work_order_events")
      .insert({ work_order_id: id, user_id: profile.id, kind: "comment", body });
    if (error) fail(id, error.message);
    after(() => emailGmsNote(id, { body, authorId: profile.id }));
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
  const { error } = await supabase.from("work_orders").delete().eq("id", id);
  if (error) fail(id, error.message);
  revalidatePath("/work-orders");
  redirect("/work-orders");
}
