"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getSession, isSuper, requireRole } from "@/lib/auth";
import { notifyAdminsOfRequest, notifyRequester, notifyTechAssigned } from "@/lib/wo-notify";
import { saveAttachments } from "@/lib/attachments";
import { num, str, zonedTimeISO } from "@/lib/format";
import type { WoStatus } from "@/lib/types";

function fail(id: string | null, msg: string): never {
  redirect(`${id ? `/work-orders/${id}` : "/work-orders/new"}?error=${encodeURIComponent(msg)}`);
}

export async function createWorkOrder(fd: FormData) {
  const { supabase, profile } = await getSession();
  if (profile.role === "vendor") fail(null, "Vendors can't create work orders");

  // Only admins assign and schedule; everyone else's work order goes in for approval.
  const isAdmin = profile.role === "admin";
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
    ...(profile.role === "tech" && { type: str(fd, "type") ?? "reactive" }),
    ...(isAdmin && {
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

  const { data, error } = await supabase.from("work_orders").insert(row).select("id,status,priority,assigned_tech_id").single();
  if (error || !data) fail(null, error?.message ?? "Could not create work order");

  await saveAttachments(supabase, "work_order", data.id, profile.id, fd.getAll("files"));
  const woId = data.id as string;
  if (data.status === "requested" && (data.priority === "emergency" || data.priority === "high")) after(() => notifyAdminsOfRequest(woId));
  if (data.assigned_tech_id) after(() => notifyTechAssigned(woId, profile.id));
  revalidatePath("/work-orders");
  revalidatePath("/");
  redirect(`/work-orders/${woId}?created=${data.status === "requested" ? "requested" : "1"}`);
}

const ALLOWED: Record<string, WoStatus[]> = {
  admin: ["new", "assigned", "in_progress", "on_hold", "completed", "cancelled"],
  tech: ["assigned", "in_progress", "on_hold", "completed"],
  vendor: ["in_progress", "on_hold", "completed"],
  manager: ["cancelled"], // managers can withdraw their own request until it's approved
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
    fail(id, "Only requests you submitted that haven't been assigned yet can be cancelled");
  }
  if (wo.status === "requested" && status !== "cancelled") fail(id, "Approve the request first");

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
  }
  if (status === "completed" && wo.status !== "completed") after(() => notifyRequester(id, "completed", profile.id));
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/work-orders");
  revalidatePath("/my-day");
  revalidatePath("/schedule");
  revalidatePath("/");
}

export async function updateAssignment(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (profile.role !== "admin") fail(id, "Only an admin can assign work orders");

  const { data: before } = await supabase.from("work_orders").select("assigned_tech_id").eq("id", id).single();
  const dueDate = str(fd, "due_date");
  const { error } = await supabase
    .from("work_orders")
    .update({
      assigned_tech_id: str(fd, "assigned_tech_id"),
      vendor_id: str(fd, "vendor_id"),
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
  const techId = str(fd, "assigned_tech_id");
  if (techId && techId !== before?.assigned_tech_id) after(() => notifyTechAssigned(id, profile.id));
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/schedule");
  revalidatePath("/my-day");
}

/** Admin approves a request, optionally assigning a technician and schedule in the same step. */
export async function approveWorkOrder(fd: FormData) {
  const { supabase, profile } = await requireRole("admin");
  const id = str(fd, "id")!;
  const { data: wo } = await supabase.from("work_orders").select("status").eq("id", id).single();
  if (!wo) fail(id, "Work order not found");
  if (wo.status !== "requested") fail(id, "This work order has already been approved or closed");

  const dueDate = str(fd, "due_date");
  const techId = str(fd, "assigned_tech_id");
  const scheduled = str(fd, "scheduled_date");
  const { error } = await supabase
    .from("work_orders")
    .update({
      status: "new", // becomes "assigned" automatically when a tech is set
      assigned_tech_id: techId,
      priority: str(fd, "priority") ?? "medium",
      category: str(fd, "category") ?? "Other",
      type: str(fd, "type") ?? "reactive",
      scheduled_date: scheduled,
      scheduled_start: scheduled ? str(fd, "scheduled_start") : null,
      estimated_hours: num(fd, "estimated_hours"),
      nte_amount: num(fd, "nte_amount"),
      ...(dueDate && { due_at: zonedTimeISO(dueDate) }),
    })
    .eq("id", id);
  if (error) fail(id, error.message);

  const note = str(fd, "note");
  await supabase
    .from("work_order_events")
    .insert({ work_order_id: id, user_id: profile.id, kind: "system", body: `Approved request${note ? `: ${note}` : ""}` });

  after(async () => {
    await notifyRequester(id, "approved", profile.id, note);
    if (techId) await notifyTechAssigned(id, profile.id);
  });
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/work-orders");
  revalidatePath("/schedule");
  revalidatePath("/my-day");
  revalidatePath("/");
  if (fd.get("then") === "vendor") redirect(`/work-orders/${id}/dispatch`);
  redirect(`/work-orders/${id}?approved=1`);
}

/** Admin turns down a request (closed as cancelled) with a reason the requester sees. */
export async function rejectWorkOrder(fd: FormData) {
  const { supabase, profile } = await requireRole("admin");
  const id = str(fd, "id")!;
  const reason = str(fd, "reason");
  if (!reason) fail(id, "Add a reason so the requester knows why");
  const { data: wo } = await supabase.from("work_orders").select("status").eq("id", id).single();
  if (wo?.status !== "requested") fail(id, "Only requests awaiting approval can be rejected");
  const { error } = await supabase.from("work_orders").update({ status: "cancelled" }).eq("id", id);
  if (error) fail(id, error.message);
  await supabase.from("work_order_events").insert({ work_order_id: id, user_id: profile.id, kind: "comment", body: `Request not approved: ${reason}` });
  after(() => notifyRequester(id, "rejected", profile.id, reason));
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/work-orders");
  revalidatePath("/");
  redirect(`/work-orders/${id}?rejected=1`);
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
