"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
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

  const { data, error } = await supabase.from("work_orders").insert(row).select("id").single();
  if (error || !data) fail(null, error?.message ?? "Could not create work order");

  await saveAttachments(supabase, "work_order", data.id, profile.id, fd.getAll("files"));
  revalidatePath("/work-orders");
  redirect(`/work-orders/${data.id}?created=1`);
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
  if (profile.role === "manager" && (wo.status !== "new" || wo.requested_by !== profile.id)) {
    fail(id, "Only new requests you submitted can be cancelled");
  }

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
  if (profile.role !== "admin") fail(id, "Only admins can delete work orders");
  const { error } = await supabase.from("work_orders").delete().eq("id", id);
  if (error) fail(id, error.message);
  revalidatePath("/work-orders");
  redirect("/work-orders");
}
