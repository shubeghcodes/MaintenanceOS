"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { str } from "@/lib/format";

const BACK = "/schedule/time-off";
const done = (q: string) => {
  revalidatePath("/schedule", "layout");
  revalidatePath("/my-day");
  redirect(`${BACK}?${q}`);
};

export async function addTimeOff(fd: FormData) {
  const { supabase, profile } = await requireRole("admin");
  const userIds = [...new Set((fd.getAll("user_id") as string[]).filter(Boolean))];
  const start = str(fd, "start_date");
  const end = str(fd, "end_date") ?? start;
  if (!userIds.length || !start || !end) redirect(`${BACK}?error=Pick+a+tech+and+the+dates`);
  if (end < start) redirect(`${BACK}?error=The+last+day+is+before+the+first+day`);
  const { error } = await supabase.from("tech_time_off").insert(
    userIds.map((user_id) => ({
      user_id,
      start_date: start,
      end_date: end,
      kind: str(fd, "kind") ?? "vacation",
      note: str(fd, "note"),
      created_by: profile.id,
    })),
  );
  if (error) redirect(`${BACK}?error=${encodeURIComponent(error.message)}`);
  done("added=1");
}

export async function deleteTimeOff(fd: FormData) {
  const { supabase } = await requireRole("admin");
  await supabase.from("tech_time_off").delete().eq("id", str(fd, "id")!);
  done("removed=1");
}

/** Regular weekly days off for every tech listed in the form. */
export async function saveWorkDays(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const ids = [...new Set(fd.getAll("tech") as string[])];
  const rows = ids.map((user_id) => ({
    user_id,
    days_off: (fd.getAll(`off_${user_id}`) as string[]).map(Number).filter((n) => n >= 0 && n <= 6).sort(),
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("tech_work_days").upsert(rows, { onConflict: "user_id" });
  if (error) redirect(`${BACK}?error=${encodeURIComponent(error.message)}`);
  done("days=1");
}
