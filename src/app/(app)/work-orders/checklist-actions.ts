"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { saveAttachments } from "@/lib/attachments";
import { emailApprovalNeeded } from "@/lib/wo-notify";

type Result = { ok: true } | { ok: false; error: string };

async function loadItem(itemId: string) {
  const { supabase, profile } = await getSession();
  if (!(profile.role === "admin" || profile.role === "tech")) return { error: "Only techs and admins can fill in the checklist" } as const;
  const { data: item } = await supabase
    .from("wo_checklist_items")
    .select("id,work_order_id,activity,description,result,followup_wo_id,work_order:work_orders(id,site_id,category,asset_id,number,status)")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { error: "Checklist item not found" } as const;
  const wo = item.work_order as unknown as { id: string; site_id: string; category: string; asset_id: string | null; number: number; status: string };
  if (wo.status === "completed" || wo.status === "cancelled") return { error: "This work order is closed" } as const;
  return { supabase, profile, item, wo } as const;
}

/** Saves the before or after photo for one checklist item (replaces an earlier one). */
export async function uploadChecklistPhoto(fd: FormData): Promise<Result> {
  const itemId = String(fd.get("item_id") ?? "");
  const slot = fd.get("slot") === "before" ? "before" : "after";
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "No photo received" };
  if (!file.type.startsWith("image/")) return { ok: false, error: "Checklist photos must be images" };

  const ctx = await loadItem(itemId);
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Not allowed" };
  const { supabase, profile, item, wo } = ctx;

  const named = new File([file], `${slot}-${item.activity.replace(/[^\w]+/g, "_").slice(0, 40)}.jpg`, { type: file.type });
  const [attId] = await saveAttachments(supabase, "work_order", wo.id, profile.id, [named], { category: "checklist" });
  if (!attId) return { ok: false, error: "Upload failed. Check your signal and try again." };

  const { error } = await supabase
    .from("wo_checklist_items")
    .update(slot === "before" ? { before_attachment_id: attId } : { after_attachment_id: attId })
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/work-orders/${wo.id}`);
  return { ok: true };
}

/**
 * Sets an item's result. Needs repair and N/A need a note. Needs repair also opens a repair request
 * at the same site (admins approve it like any other request) the first time it's chosen.
 */
export async function setChecklistResult(fd: FormData): Promise<Result> {
  const itemId = String(fd.get("item_id") ?? "");
  const result = String(fd.get("result") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;
  if (!["ok", "needs_repair", "na"].includes(result)) return { ok: false, error: "Pick OK, Needs repair or N/A" };
  if ((result === "na" || result === "needs_repair") && !note) {
    return { ok: false, error: result === "na" ? "Say why this doesn't apply" : "Describe what needs repair" };
  }

  const ctx = await loadItem(itemId);
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Not allowed" };
  const { supabase, profile, item, wo } = ctx;

  let followup = item.followup_wo_id as string | null;
  if (result === "needs_repair" && !followup) {
    const { data: rep, error: repErr } = await supabase
      .from("work_orders")
      .insert({
        site_id: wo.site_id,
        asset_id: wo.asset_id,
        title: `Repair: ${item.activity}`,
        description: `Found during PM work order #${wo.number} (${item.activity}).\n\n${note}`,
        category: wo.category,
        priority: "medium",
        type: "reactive",
        requested_by: profile.id,
      })
      .select("id,status,number")
      .single();
    if (repErr || !rep) return { ok: false, error: repErr?.message ?? "Couldn't create the repair request" };
    followup = rep.id;
    if (rep.status === "requested") after(() => emailApprovalNeeded(rep.id));
    await supabase.from("work_order_events").insert({
      work_order_id: wo.id,
      user_id: profile.id,
      kind: "system",
      body: `Repair request #${rep.number} opened from the checklist: ${item.activity}`,
    });
  }

  const { error } = await supabase
    .from("wo_checklist_items")
    .update({ result, note, followup_wo_id: followup })
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/work-orders/${wo.id}`);
  if (followup) revalidatePath("/work-orders");
  return { ok: true };
}
