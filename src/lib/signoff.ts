import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./supabase/admin";
import { SIGNOFF_AUTO_CLOSE_DAYS } from "./constants";
import { addDaysISO, todayISO, toDateInput } from "./format";
import { sendAndRecord } from "./dispatch";
import { emailRequesterCompleted, emailSignoffRequest } from "./wo-notify";

/** The day a work order waiting for sign-off closes on its own (company timezone). */
export const signoffClosesOn = (requestedAt: string) => addDaysISO(toDateInput(requestedAt), SIGNOFF_AUTO_CLOSE_DAYS);

/**
 * After someone marks work complete: if it's now waiting for the GM, ask them;
 * if it closed outright (no GM at the location, PM, compliance), send the closing emails.
 */
export async function afterWorkDone(woId: string, actorId: string | null) {
  const db = createAdminClient();
  const { data } = await db.from("work_orders").select("status,signoff_requested_at").eq("id", woId).maybeSingle();
  const wo = data as { status: string; signoff_requested_at: string | null } | null;
  if (!wo) return;
  if (wo.status === "awaiting_signoff") await emailSignoffRequest(woId, { closesOn: signoffClosesOn(wo.signoff_requested_at ?? new Date().toISOString()) });
  else if (wo.status === "completed") await afterClosed(woId, actorId);
}

/** A work order just closed: tell the vendor (if one did the job) and the person who asked. */
export async function afterClosed(woId: string, actorId: string | null, note?: string | null) {
  const db = createAdminClient();
  const { data } = await db
    .from("vendor_dispatches")
    .select("id,token_version,status")
    .eq("work_order_id", woId)
    .in("status", ["closed", "work_completed"])
    .order("created_at", { ascending: false })
    .limit(1);
  const d = (data ?? [])[0] as { id: string; token_version: number } | undefined;
  if (d) await sendAndRecord(db, d.id, d.token_version, "closed", { note });
  await emailRequesterCompleted(woId, actorId);
}

/** Daily job: remind GMs after a day, and close jobs nobody signed off after SIGNOFF_AUTO_CLOSE_DAYS. */
export async function processSignoffs(db: SupabaseClient = createAdminClient()) {
  const { data } = await db.from("work_orders").select("id,number,signoff_requested_at,signoff_reminded_at").eq("status", "awaiting_signoff").limit(1000);
  const today = todayISO();
  const out = { reminded: 0, closed: 0, errors: [] as string[] };
  for (const w of (data ?? []) as { id: string; number: number; signoff_requested_at: string | null; signoff_reminded_at: string | null }[]) {
    const asked = w.signoff_requested_at ?? new Date().toISOString();
    const closesOn = signoffClosesOn(asked);
    try {
      if (today >= closesOn) {
        const { error } = await db
          .from("work_orders")
          .update({
            status: "completed",
            signed_off_at: new Date().toISOString(),
            signoff_method: "auto",
            signoff_note: `Closed automatically: no sign-off within ${SIGNOFF_AUTO_CLOSE_DAYS} days`,
          })
          .eq("id", w.id)
          .eq("status", "awaiting_signoff");
        if (error) throw new Error(error.message);
        await db.from("work_order_events").insert({
          work_order_id: w.id,
          kind: "system",
          body: `Closed automatically: the GM didn't sign off within ${SIGNOFF_AUTO_CLOSE_DAYS} days`,
        });
        await afterClosed(w.id, null);
        out.closed++;
      } else if (!w.signoff_reminded_at && today >= addDaysISO(toDateInput(asked), 1)) {
        await emailSignoffRequest(w.id, { reminder: true, closesOn });
        await db.from("work_orders").update({ signoff_reminded_at: new Date().toISOString() }).eq("id", w.id);
        out.reminded++;
      }
    } catch (e) {
      out.errors.push(`#${w.number}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return out;
}
