"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { fileProblems, saveAttachments } from "@/lib/attachments";
import { num, str, todayISO } from "@/lib/format";
import { PAYMENT_LABEL, SUPPLY_CATEGORIES } from "@/lib/constants";
import type { PaymentMethod } from "@/lib/types";

const fail = (back: string, msg: string): never => redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);

/**
 * Log a store supplies purchase (smallwares, cleaning, paper goods…) — not tied to a work order
 * and never counted as R&M. GMs for their locations; techs and admins also for the shop / warehouse.
 */
export async function addSupplyPurchase(fd: FormData) {
  const { supabase, profile } = await getSession();
  const backField = str(fd, "back");
  const back = backField && backField.startsWith("/") && !backField.startsWith("//") ? backField : "/purchases/new";
  if (!["admin", "tech", "manager"].includes(profile.role)) fail(back, "Not allowed");

  const place = str(fd, "site_id");
  if (!place) fail(back, "Pick the location the supplies are for.");
  const shop = place === "shop";
  if (shop && profile.role === "manager") fail(back, "Pick your location.");
  const companyId = shop ? str(fd, "company_id") : null;
  if (shop && !companyId) fail(back, "Pick which company the shop purchase is for.");

  const store = str(fd, "store");
  const total = num(fd, "total");
  if (!store || total == null || total < 0) fail(back, "Vendor and total are required.");
  const file = fd.get("receipt");
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && fd.get("no_receipt") !== "on") fail(back, "Attach a photo of the receipt (or tick “No receipt available”).");
  if (hasFile) {
    const bad = fileProblems([file]);
    if (bad) fail(back, bad);
  }
  const method = (str(fd, "payment_method") ?? "company_card") as PaymentMethod;
  if (!(method in PAYMENT_LABEL)) fail(back, "Pick how it was paid.");
  const category = str(fd, "category") ?? "Other";
  const last4 = str(fd, "card_last4");
  if (last4 && !/^\d{4}$/.test(last4)) fail(back, "Card: enter just the last 4 digits.");

  // Double-submit guard: same person + same form key = already saved.
  const key = str(fd, "client_key");
  if (key) {
    const { data: dup } = await supabase.from("wo_purchases").select("id").eq("purchased_by", profile.id).eq("client_key", key).maybeSingle();
    if (dup) redirect(`/purchases/${dup.id}?receipt=added`);
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from("wo_purchases").insert({
    id,
    kind: "supply",
    work_order_id: null,
    site_id: shop ? null : place,
    company_id: companyId,
    store,
    purchase_date: str(fd, "purchase_date") ?? todayISO(),
    category: (SUPPLY_CATEGORIES as readonly string[]).includes(category) ? category : "Other",
    description: str(fd, "description"),
    subtotal: num(fd, "subtotal"),
    tax: num(fd, "tax"),
    total,
    payment_method: method,
    card_last4: method === "company_card" ? last4 : null,
    purchased_by: profile.id,
    client_key: key,
  });
  if (error?.code === "23505") redirect("/purchases?receipt=added");
  if (error) fail(back, error.code === "42501" ? "You can only log purchases for your own locations." : error.message);

  // The photo is attached to the purchase itself (it follows the purchase's visibility).
  if (hasFile) {
    const [attachmentId] = await saveAttachments(supabase, "purchase", id, profile.id, [file], {
      category: "receipt",
      visibility: "internal",
      label: profile.full_name ?? undefined,
    });
    if (!attachmentId) {
      await supabase.from("wo_purchases").delete().eq("id", id);
      fail(back, "The receipt photo didn't upload. Check your connection and try again.");
    }
    await supabase.from("wo_purchases").update({ receipt_attachment_id: attachmentId }).eq("id", id);
  }

  revalidatePath("/purchases");
  revalidatePath("/");
  if (!shop) revalidatePath(`/sites/${place}`);
  redirect(`/purchases/${id}?receipt=added`);
}
