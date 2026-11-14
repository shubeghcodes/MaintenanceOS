"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, requireRole } from "@/lib/auth";
import { fileProblems, saveAttachments } from "@/lib/attachments";
import { num, str, todayISO } from "@/lib/format";
import { PAYMENT_LABEL, PURCHASE_CATEGORIES } from "@/lib/constants";
import type { PaymentMethod } from "@/lib/types";

/** Where to go after an action: the "back" field, else the work order, else the Purchases page. */
const backTo = (fd: FormData, woId: string | null) => {
  const b = str(fd, "back");
  return b && b.startsWith("/") && !b.startsWith("//") ? b : woId ? `/work-orders/${woId}` : "/purchases";
};
const go = (url: string, key: string, msg: string): never => redirect(`${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}#receipts`);

function refresh(woId: string | null) {
  if (woId) revalidatePath(`/work-orders/${woId}`);
  revalidatePath("/purchases");
  revalidatePath("/");
}

/** Add a receipt (photo + amount) to a work order. Admins, techs and store managers. */
export async function addPurchase(fd: FormData) {
  const { supabase, profile } = await getSession();
  const woId = str(fd, "work_order_id")!;
  const back = backTo(fd, woId);
  if (profile.role === "vendor") go(back, "error", "Not allowed");

  const store = str(fd, "store");
  const total = num(fd, "total");
  if (!store || total == null || total < 0) go(back, "error", "Store and total are required.");
  const file = fd.get("receipt");
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && fd.get("no_receipt") !== "on") go(back, "error", "Attach a photo of the receipt (or tick “No receipt available”).");
  if (hasFile) {
    const bad = fileProblems([file]);
    if (bad) go(back, "error", bad);
  }
  const method = (str(fd, "payment_method") ?? "company_card") as PaymentMethod;
  if (!(method in PAYMENT_LABEL)) go(back, "error", "Pick how it was paid.");
  const category = str(fd, "category") ?? "Parts";
  const last4 = str(fd, "card_last4");
  if (last4 && !/^\d{4}$/.test(last4)) go(back, "error", "Card: enter just the last 4 digits.");

  // Double-submit guard: same person + same form key = already saved.
  const key = str(fd, "client_key");
  if (key) {
    const { data: dup } = await supabase.from("wo_purchases").select("id").eq("purchased_by", profile.id).eq("client_key", key).maybeSingle();
    if (dup) go(back, "receipt", "added");
  }

  let attachmentId: string | null = null;
  if (hasFile) {
    [attachmentId] = await saveAttachments(supabase, "work_order", woId, profile.id, [file], {
      category: "receipt",
      visibility: "internal",
      label: profile.full_name ?? undefined,
    });
    if (!attachmentId) go(back, "error", "The receipt photo didn't upload. Check your connection and try again.");
  }

  const { error } = await supabase.from("wo_purchases").insert({
    kind: "part",
    work_order_id: woId,
    store,
    purchase_date: str(fd, "purchase_date") ?? todayISO(),
    category: (PURCHASE_CATEGORIES as readonly string[]).includes(category) ? category : "Other",
    description: str(fd, "description"),
    subtotal: num(fd, "subtotal"),
    tax: num(fd, "tax"),
    total,
    payment_method: method,
    card_last4: method === "company_card" ? last4 : null,
    receipt_attachment_id: attachmentId,
    purchased_by: profile.id,
    client_key: key,
  });
  if (error?.code === "23505") go(back, "receipt", "added");
  if (error) go(back, "error", error.message);
  refresh(woId);
  go(back, "receipt", "added");
}

/** Admin review: approve or reject (rejected receipts drop out of the work order cost). */
export async function reviewPurchase(decision: "approved" | "rejected", fd: FormData) {
  const { supabase, profile } = await requireRole("admin");
  const id = str(fd, "purchase_id")!;
  const note = str(fd, "note");
  const { data: p } = await supabase.from("wo_purchases").select("work_order_id,status").eq("id", id).maybeSingle();
  if (!p) redirect("/purchases");
  const back = backTo(fd, p.work_order_id);
  if (decision === "rejected" && !note) go(back, "error", "Add a reason when rejecting a receipt.");
  const { error } = await supabase
    .from("wo_purchases")
    .update({ status: decision, review_note: note, reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) go(back, "error", error.message);
  refresh(p.work_order_id);
  revalidatePath(`/purchases/${id}`);
  go(back, "receipt", decision);
}

export async function markReimbursed(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "purchase_id")!;
  const { data: p } = await supabase
    .from("wo_purchases")
    .update({ reimbursed_at: str(fd, "reimbursed_at") ?? todayISO(), reimbursement_ref: str(fd, "reimbursement_ref") })
    .eq("id", id)
    .eq("payment_method", "personal")
    .is("reimbursed_at", null)
    .select("work_order_id")
    .maybeSingle();
  if (!p) redirect("/purchases?error=Already+reimbursed");
  refresh(p.work_order_id);
  revalidatePath(`/purchases/${id}`);
  go(backTo(fd, p.work_order_id), "receipt", "reimbursed");
}

export async function deletePurchase(fd: FormData) {
  const { supabase } = await getSession();
  const id = str(fd, "purchase_id")!;
  const { data: p } = await supabase.from("wo_purchases").delete().eq("id", id).select("work_order_id,receipt_attachment_id").maybeSingle();
  if (!p) redirect("/purchases?error=Couldn%E2%80%99t+delete+that+receipt");
  if (p.receipt_attachment_id) await supabase.from("attachments").delete().eq("id", p.receipt_attachment_id);
  refresh(p.work_order_id);
  const back = backTo(fd, p.work_order_id);
  go(back.startsWith(`/purchases/${id}`) ? "/purchases" : back, "receipt", "deleted");
}
