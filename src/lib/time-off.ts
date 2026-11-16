import type { SupabaseClient } from "@supabase/supabase-js";

export type TimeOffKind = "vacation" | "sick" | "personal" | "holiday" | "other";
export const TIME_OFF_LABEL: Record<TimeOffKind, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  holiday: "Holiday",
  other: "Other",
};
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type TimeOffEntry = { id: string; user_id: string; start_date: string; end_date: string; kind: TimeOffKind; note: string | null };
export type OffInfo = { daysOff: Map<string, number[]>; entries: TimeOffEntry[] };

const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const shift = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Regular days off for everyone, plus time off overlapping [from, to]. */
export async function loadTimeOff(supabase: SupabaseClient, from: string, to: string): Promise<OffInfo> {
  const [{ data: w }, { data: t }] = await Promise.all([
    supabase.from("tech_work_days").select("user_id,days_off"),
    supabase.from("tech_time_off").select("id,user_id,start_date,end_date,kind,note").lte("start_date", to).gte("end_date", from).order("start_date"),
  ]);
  return {
    daysOff: new Map(((w ?? []) as { user_id: string; days_off: number[] }[]).map((r) => [r.user_id, r.days_off ?? []])),
    entries: (t ?? []) as TimeOffEntry[],
  };
}

/** Why a tech is off that day ("Vacation", "Regular day off"), or null if they're working. */
export function offReason(info: OffInfo, userId: string | null, iso: string): string | null {
  if (!userId) return null;
  const e = info.entries.find((x) => x.user_id === userId && iso >= x.start_date && iso <= x.end_date);
  if (e) return TIME_OFF_LABEL[e.kind] + (e.note ? `: ${e.note}` : "");
  if (info.daysOff.get(userId)?.includes(dow(iso))) return "Regular day off";
  return null;
}

/** Same rule as the database's pm_schedule_date(): nearest working day on/before the due date (not before today), else after. */
export function pmScheduleDate(info: OffInfo, userId: string | null, due: string, today: string): string {
  const d = due > today ? due : today;
  if (!userId || !offReason(info, userId, d)) return d;
  for (let i = 1; i <= 30; i++) {
    const back = shift(d, -i);
    if (back < today) break;
    if (!offReason(info, userId, back)) return back;
  }
  for (let i = 1; i <= 60; i++) {
    const fwd = shift(d, i);
    if (!offReason(info, userId, fwd)) return fwd;
  }
  return d;
}

export { shift as addDays };
