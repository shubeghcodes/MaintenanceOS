"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { str } from "@/lib/format";
import { zonedDateTimeISO } from "@/lib/labor";
import { afterWorkDone } from "@/lib/signoff";

const friendly = (msg: string) => msg.replace(/^.*?ERROR:\s*/i, "").replace(/\s*\(SQLSTATE.*$/, "");
const coord = (fd: FormData, k: string) => {
  const v = Number(str(fd, k));
  return str(fd, k) && Number.isFinite(v) ? v : null;
};
const go = (q: string): never => redirect(`/my-day?${q}#clock`);

function refresh() {
  revalidatePath("/my-day");
  revalidatePath("/timesheets");
  revalidatePath("/work-orders");
  revalidatePath("/");
}

/** Clock in on the first work order (starts its timer), or with a reason when there's no job yet. */
export async function clockIn(fd: FormData) {
  const { supabase, profile } = await getSession();
  if (profile.role !== "tech") go("error=Only+technicians+clock+in");
  const pick = str(fd, "work_order_id");
  const woId = pick && pick !== "none" ? pick : null;
  const reason = woId ? null : str(fd, "reason");
  const { error } = await supabase.rpc("clock_in", {
    p_wo: woId,
    p_reason: reason,
    p_lat: coord(fd, "lat"),
    p_lng: coord(fd, "lng"),
    p_accuracy: coord(fd, "accuracy"),
  });
  if (error) go(`error=${encodeURIComponent(friendly(error.message))}`);
  refresh();
  if (woId) revalidatePath(`/work-orders/${woId}`);
  go("clock=in");
}

/** Clock out on the last work order; optionally mark it finished (which sends it to the GM for sign-off). */
export async function clockOut(fd: FormData) {
  const { supabase, profile } = await getSession();
  if (profile.role !== "tech") go("error=Only+technicians+clock+out");
  const pick = str(fd, "work_order_id");
  const woId = pick && pick !== "none" ? pick : null;
  const reason = woId ? null : str(fd, "reason");
  const finished = woId && fd.get("finished") === "yes";

  // Forgot to clock out on an earlier day: they enter when they actually finished.
  const outDate = str(fd, "out_date");
  const outTime = str(fd, "out_time");
  const at = outDate && outTime ? zonedDateTimeISO(outDate, outTime) : null;

  const { error } = await supabase.rpc("clock_out", {
    p_wo: woId,
    p_reason: reason,
    p_at: at,
    p_lat: coord(fd, "lat"),
    p_lng: coord(fd, "lng"),
    p_accuracy: coord(fd, "accuracy"),
  });
  if (error) go(`error=${encodeURIComponent(friendly(error.message))}`);

  if (finished) {
    const patch: Record<string, unknown> = { status: "completed" };
    const notes = str(fd, "resolution_notes");
    if (notes) patch.resolution_notes = notes;
    const { error: wErr } = await supabase.from("work_orders").update(patch).eq("id", woId);
    if (wErr) go(`clock=out&error=${encodeURIComponent(`Clocked out, but the job couldn't be marked finished: ${friendly(wErr.message)}`)}`);
    after(() => afterWorkDone(woId!, profile.id));
  }
  refresh();
  if (woId) revalidatePath(`/work-orders/${woId}`);
  go(`clock=${finished ? "out_done" : "out"}`);
}

export async function lunchStart() {
  const { supabase } = await getSession();
  const { error } = await supabase.rpc("lunch_start");
  if (error) go(`error=${encodeURIComponent(friendly(error.message))}`);
  refresh();
  go("clock=lunch");
}

export async function lunchEnd() {
  const { supabase } = await getSession();
  const { data, error } = await supabase.rpc("lunch_end");
  if (error) go(`error=${encodeURIComponent(friendly(error.message))}`);
  refresh();
  const wo = (data as { resumed_wo: number | null } | null)?.resumed_wo;
  go(`clock=back${wo ? `&resumed=${wo}` : ""}`);
}
