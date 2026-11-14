"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { num, str } from "@/lib/format";
import { zonedDateTimeISO } from "@/lib/labor";

/** Only same-app paths are allowed as return addresses. */
function backTo(fd: FormData, fallback: string) {
  const b = str(fd, "back");
  return b && b.startsWith("/") && !b.startsWith("//") ? b : fallback;
}
function withParam(url: string, key: string, value: string) {
  const [path, hash] = url.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}${hash ? `#${hash}` : ""}`;
}
function friendly(msg: string) {
  return msg.replace(/^.*?ERROR:\s*/i, "").replace(/\s*\(SQLSTATE.*$/, "");
}
function refresh(woId?: string | null) {
  if (woId) revalidatePath(`/work-orders/${woId}`);
  revalidatePath("/my-day");
  revalidatePath("/labor");
  revalidatePath("/rm");
  revalidatePath("/");
}

export async function startTimer(fd: FormData) {
  const { supabase } = await getSession();
  const woId = str(fd, "work_order_id")!;
  const back = backTo(fd, `/work-orders/${woId}#time`);
  const { data, error } = await supabase.rpc("timer_start", { p_wo: woId });
  // Techs who aren't clocked in go to Clock in with this job picked as their first.
  if (error && /clock in first/i.test(error.message)) redirect(`/my-day?clockin=${woId}#clock`);
  if (error) redirect(withParam(back, "error", friendly(error.message)));
  refresh(woId);
  const pausedWo = (data as { paused_wo: number | null } | null)?.paused_wo;
  redirect(withParam(back, "timer", pausedWo ? `started_paused_${pausedWo}` : "started"));
}

export async function changeTimer(action: "pause" | "resume" | "stop", fd: FormData) {
  const { supabase } = await getSession();
  const entryId = str(fd, "entry_id")!;
  const woId = str(fd, "work_order_id");
  const back = backTo(fd, woId ? `/work-orders/${woId}#time` : "/my-day");
  const { data, error } = await supabase.rpc("timer_change", { p_entry: entryId, p_action: action });
  if (error && /clock in first/i.test(error.message)) redirect(`/my-day?clockin=${woId ?? ""}#clock`);
  if (error) redirect(withParam(back, "error", friendly(error.message)));
  refresh(woId);
  const pausedWo = (data as { paused_wo: number | null } | null)?.paused_wo;
  redirect(withParam(back, "timer", pausedWo ? `${action}d_paused_${pausedWo}` : action === "stop" ? "stopped" : `${action}d`));
}

/** Admin: add time a technician didn't record with the timer. */
export async function addManualTime(fd: FormData) {
  const { supabase, profile } = await getSession();
  const woId = str(fd, "work_order_id")!;
  const back = `/work-orders/${woId}#time`;
  if (profile.role !== "admin") redirect(withParam(back, "error", "Only admins can add time manually."));
  const date = str(fd, "date");
  const start = str(fd, "start");
  const end = str(fd, "end");
  if (!date || !start || !end) redirect(withParam(back, "error", "Date, start and end time are required."));
  const { error } = await supabase.rpc("time_entry_manual", {
    p_wo: woId,
    p_user: str(fd, "user_id"),
    p_start: zonedDateTimeISO(date, start),
    p_end: zonedDateTimeISO(date, end),
    p_hours: num(fd, "hours"),
    p_reason: str(fd, "reason") ?? "",
  });
  if (error) redirect(withParam(back, "error", friendly(error.message)));
  refresh(woId);
  redirect(withParam(back, "timer", "added"));
}

/** Admin: correct an entry's times or hours (reason required, audited). */
export async function editTime(fd: FormData) {
  const { supabase, profile } = await getSession();
  const woId = str(fd, "work_order_id")!;
  const back = `/work-orders/${woId}#time`;
  if (profile.role !== "admin") redirect(withParam(back, "error", "Only admins can adjust time."));
  const date = str(fd, "date");
  const endDate = str(fd, "end_date") ?? date;
  const start = str(fd, "start");
  const end = str(fd, "end");
  if (!date || !endDate || !start || !end) redirect(withParam(back, "error", "Date, start and end time are required."));
  const { error } = await supabase.rpc("time_entry_edit", {
    p_entry: str(fd, "entry_id"),
    p_start: zonedDateTimeISO(date, start),
    p_end: zonedDateTimeISO(endDate, end),
    p_hours: num(fd, "hours"),
    p_reason: str(fd, "reason") ?? "",
  });
  if (error) redirect(withParam(back, "error", friendly(error.message)));
  refresh(woId);
  redirect(withParam(back, "timer", "edited"));
}

export async function voidTime(fd: FormData) {
  const { supabase, profile } = await getSession();
  const woId = str(fd, "work_order_id")!;
  const back = `/work-orders/${woId}#time`;
  if (profile.role !== "admin") redirect(withParam(back, "error", "Only admins can void time."));
  const { error } = await supabase.rpc("time_entry_void", { p_entry: str(fd, "entry_id"), p_reason: str(fd, "reason") ?? "" });
  if (error) redirect(withParam(back, "error", friendly(error.message)));
  refresh(woId);
  redirect(withParam(back, "timer", "voided"));
}
