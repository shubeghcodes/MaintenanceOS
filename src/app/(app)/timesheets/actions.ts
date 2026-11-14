"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { str } from "@/lib/format";
import { zonedDateTimeISO } from "@/lib/labor";

/** Admin corrects a shift's clock times (e.g. a forgotten clock-out). A reason is required and kept. */
export async function editShift(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const back = str(fd, "back") ?? "/timesheets";
  const safe = back.startsWith("/") && !back.startsWith("//") ? back : "/timesheets";
  const go = (k: string, v: string): never => redirect(`${safe}${safe.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`);
  const inDate = str(fd, "in_date");
  const inTime = str(fd, "in_time");
  const outDate = str(fd, "out_date");
  const outTime = str(fd, "out_time");
  if (!inDate || !inTime) go("error", "Enter the clock-in date and time");
  const { error } = await supabase.rpc("shift_edit", {
    p_shift: str(fd, "shift_id"),
    p_in: zonedDateTimeISO(inDate!, inTime!),
    p_out: outDate && outTime ? zonedDateTimeISO(outDate, outTime) : null,
    p_reason: str(fd, "reason"),
  });
  if (error) go("error", error.message.replace(/^.*?ERROR:\s*/i, ""));
  revalidatePath("/timesheets");
  revalidatePath("/my-day");
  go("saved", "1");
}
