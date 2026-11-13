"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, requireRole } from "@/lib/auth";
import { sendDaySchedules } from "@/lib/schedule-email";
import { isISODate, str } from "@/lib/format";
import { after } from "next/server";
import { emailTechAssigned } from "@/lib/wo-notify";

/** Drag-and-drop move on the calendar. `date: null` = back to the unscheduled list. */
export async function moveWorkOrder(input: {
  id: string;
  techId?: string | null;
  date: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, profile } = await getSession();
  if (!(profile.role === "admin" || profile.role === "tech")) return { ok: false, error: "Only admins and techs can schedule work." };
  if (input.date !== null && !isISODate(input.date)) return { ok: false, error: "Invalid date" };

  const { data: cur } = await supabase.from("work_orders").select("assigned_tech_id,status").eq("id", input.id).maybeSingle();
  if (!cur) return { ok: false, error: "You don't have access to that work order." };
  if (cur.status === "requested") return { ok: false, error: "Approve this work order first." };
  const reassign = input.techId !== undefined && input.techId !== cur.assigned_tech_id;
  if (reassign && profile.role !== "admin") return { ok: false, error: "Only an admin can reassign work to another technician." };

  const patch: Record<string, unknown> = { scheduled_date: input.date };
  if (reassign) patch.assigned_tech_id = input.techId;
  if (input.date === null) patch.scheduled_start = null;

  const { data, error } = await supabase.from("work_orders").update(patch).eq("id", input.id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "You don't have access to that work order." };
  if (reassign && input.techId) after(() => emailTechAssigned(input.id, profile.id));
  revalidatePath("/schedule");
  revalidatePath("/my-day");
  return { ok: true };
}

/** Email the day's schedule to one tech or every tech with jobs that day. */
export async function emailSchedules(fd: FormData) {
  const { supabase, profile } = await requireRole("admin");
  const date = str(fd, "date");
  const techId = str(fd, "tech_id");
  const back = str(fd, "back") ?? "/schedule";
  const sep = back.includes("?") ? "&" : "?";
  if (!isISODate(date)) redirect(`${back}${sep}error=Invalid+date`);

  let results;
  try {
    results = await sendDaySchedules(supabase, { date, techIds: techId ? [techId] : undefined, sentBy: profile.id });
  } catch (e) {
    redirect(`${back}${sep}error=${encodeURIComponent(e instanceof Error ? e.message : "Send failed")}`);
  }
  const sent = results.filter((r) => r.status === "sent");
  const problems = results.filter((r) => r.status !== "sent" && r.error !== "No jobs scheduled");
  const msg =
    results.length === 0
      ? "No techs have jobs scheduled that day."
      : [
          sent.length ? `Emailed ${sent.map((r) => r.name).join(", ")}.` : "",
          problems.map((r) => `${r.name}: ${r.error}`).join(" · "),
        ]
          .filter(Boolean)
          .join(" ");
  revalidatePath("/schedule");
  redirect(`${back}${sep}${sent.length && !problems.length ? "notice" : "error"}=${encodeURIComponent(msg || "Nothing sent.")}`);
}
