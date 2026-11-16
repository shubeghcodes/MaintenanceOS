"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { fileProblems, saveAttachments } from "@/lib/attachments";
import { num, str } from "@/lib/format";
import { PART_READY_WHERE, type PartStatus } from "@/lib/constants";
import { emailPartRequested, emailPartUpdate } from "@/lib/wo-notify";

/**
 * Parts on a work order. The database enforces who can do what (see 0030_parts.sql):
 * techs request and can order up to the company's approval limit; admins approve, order anything and fix mistakes.
 */

const go = (woId: string, key: string, msg: string): never => redirect(`/work-orders/${woId}?${key}=${encodeURIComponent(msg)}#parts`);

function refresh(woId: string) {
  revalidatePath(`/work-orders/${woId}`);
  revalidatePath("/work-orders");
  revalidatePath("/parts");
  revalidatePath("/my-day");
  revalidatePath("/");
}

async function staff() {
  const s = await getSession();
  if (s.profile.role !== "admin" && s.profile.role !== "tech") redirect("/");
  return s;
}

function details(fd: FormData) {
  return {
    name: str(fd, "name"),
    part_number: str(fd, "part_number"),
    quantity: num(fd, "quantity") ?? 1,
    notes: str(fd, "notes"),
    supplier: str(fd, "supplier"),
    link: str(fd, "link"),
    est_cost: num(fd, "est_cost"),
  };
}

/** Request a part (tech or admin). */
export async function requestPart(fd: FormData) {
  const { supabase, profile } = await staff();
  const woId = str(fd, "work_order_id")!;
  const row = details(fd);
  if (!row.name) go(woId, "error", "Describe the part you need.");
  if (row.quantity <= 0) go(woId, "error", "Quantity must be more than 0.");
  if (row.link && !/^https?:\/\//i.test(row.link)) row.link = `https://${row.link}`;

  let photo_id: string | null = null;
  const file = fd.get("photo");
  if (file instanceof File && file.size > 0) {
    const bad = fileProblems([file]);
    if (bad) go(woId, "error", bad);
    [photo_id] = await saveAttachments(supabase, "work_order", woId, profile.id, [file], { category: "part", label: profile.full_name ?? undefined });
  }
  const { data, error } = await supabase
    .from("wo_parts")
    .insert({ ...row, work_order_id: woId, photo_id: photo_id ?? null })
    .select("id")
    .single();
  if (error || !data) return go(woId, "error", error?.message ?? "Couldn't save the part.");
  after(() => emailPartRequested(data.id, profile.id));
  refresh(woId);
  go(woId, "part", "requested");
}

/** Change a part's details (name, part #, qty, supplier, cost…). */
export async function updatePart(fd: FormData) {
  const { supabase } = await staff();
  const woId = str(fd, "work_order_id")!;
  const id = str(fd, "part_id")!;
  const row = details(fd);
  if (!row.name) go(woId, "error", "Describe the part you need.");
  const { error } = await supabase.from("wo_parts").update(row).eq("id", id);
  if (error) go(woId, "error", error.message);
  refresh(woId);
  go(woId, "part", "saved");
}

/** Move a part along: approve, ordered, ready, installed, cancelled (or reopen, admins). */
export async function setPartStatus(status: PartStatus, fd: FormData) {
  const { supabase, profile } = await staff();
  const woId = str(fd, "work_order_id")!;
  const id = str(fd, "part_id")!;
  const patch: Record<string, unknown> = { status };

  if (status === "ordered" || status === "ready") {
    const cost = num(fd, "cost");
    if (cost != null) {
      if (cost < 0) go(woId, "error", "Cost can't be negative.");
      patch.cost = cost;
    }
    const supplier = str(fd, "supplier");
    if (supplier) patch.supplier = supplier;
    const ref = str(fd, "order_ref");
    if (ref) patch.order_ref = ref;
    if (status === "ordered") patch.eta = str(fd, "eta");
  }
  if (status === "ready") {
    const where = str(fd, "ready_location");
    if (where && !(where in PART_READY_WHERE)) go(woId, "error", "Pick where the part is.");
    patch.ready_location = where;
    patch.location_note = str(fd, "location_note");
  }
  if (status === "cancelled") {
    const reason = str(fd, "cancel_reason");
    if (!reason) go(woId, "error", "Give a reason for cancelling the part");
    patch.cancel_reason = reason;
  }

  const { error } = await supabase.from("wo_parts").update(patch).eq("id", id);
  if (error) go(woId, "error", error.message);
  if (status === "ordered" || status === "ready") after(() => emailPartUpdate(id, profile.id));
  refresh(woId);
  go(woId, "part", status);
}

/** Delete a part request that was added by mistake (the person who asked, before anything happens; admins any time). */
export async function deletePart(fd: FormData) {
  const { supabase } = await staff();
  const woId = str(fd, "work_order_id")!;
  const { error, count } = await supabase.from("wo_parts").delete({ count: "exact" }).eq("id", str(fd, "part_id")!);
  if (error) go(woId, "error", error.message);
  if (!count) go(woId, "error", "Only the person who asked can remove a part, before it's approved or ordered. Cancel it instead.");
  refresh(woId);
  go(woId, "part", "removed");
}
