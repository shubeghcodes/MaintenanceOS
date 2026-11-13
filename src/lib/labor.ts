import type { SupabaseClient } from "@supabase/supabase-js";

const TZ = process.env.NEXT_PUBLIC_TIMEZONE || "America/Los_Angeles";

export type TimeEntry = {
  id: string;
  work_order_id: string;
  site_id: string | null;
  company_id: string | null;
  user_id: string | null;
  visit: number;
  status: "running" | "paused" | "stopped" | "void";
  source: "timer" | "manual";
  started_at: string;
  ended_at: string | null;
  last_resumed_at: string | null;
  worked_seconds: number;
  pause_count: number;
  note: string | null;
  created_at: string;
};

export type EntryCost = { entry_id: string; hours: number; hourly_rate: number | null; cost_override: number | null; labor_cost: number };

export const ENTRY_COLS =
  "id,work_order_id,site_id,company_id,user_id,visit,status,source,started_at,ended_at,last_resumed_at,worked_seconds,pause_count,note,created_at";

/** Seconds worked so far, including the current running stretch. */
export function secondsNow(e: Pick<TimeEntry, "status" | "worked_seconds" | "last_resumed_at">, now = Date.now()) {
  const live = e.status === "running" && e.last_resumed_at ? Math.max(0, Math.floor((now - new Date(e.last_resumed_at).getTime()) / 1000)) : 0;
  return e.worked_seconds + live;
}

/** Reports use decimal hours: 3.5 */
export function fmtHours(h: number | null | undefined) {
  const n = Number(h ?? 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Timers use h:mm:ss */
export function fmtClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** "8:05 AM" for an instant, in the company timezone. */
export function fmtClockTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

/** "HH:MM" for <input type="time"> in the company timezone. */
export function toTimeInput(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
}

/** ISO instant for a local date + "HH:MM" in the company timezone. */
export function zonedDateTimeISO(date: string, time: string) {
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh, mm);
  const offset = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first)).toISOString();
}

/** Admin-only: labor cost per work order (RLS returns nothing for other roles). */
export async function laborCostByWo(supabase: SupabaseClient, woIds: string[]) {
  const map = new Map<string, { hours: number; labor_cost: number; missing_rate: boolean }>();
  if (!woIds.length) return map;
  for (let i = 0; i < woIds.length; i += 300) {
    const { data } = await supabase.from("wo_labor_costs").select("work_order_id,hours,labor_cost,missing_rate").in("work_order_id", woIds.slice(i, i + 300));
    for (const r of (data ?? []) as { work_order_id: string; hours: number; labor_cost: number; missing_rate: boolean }[]) map.set(r.work_order_id, r);
  }
  return map;
}

export type RmLine = {
  category: "labor" | "parts" | "vendor";
  work_order_id: string;
  company_id: string | null;
  site_id: string | null;
  user_id: string | null;
  spent_on: string;
  hours: number | null;
  amount: number;
};

/** R&M ledger rows (labor rows only come back for admins). */
export async function loadRmLines(
  supabase: SupabaseClient,
  f: { from: string; to: string; companyId?: string | null; siteId?: string | null; userId?: string | null; category?: string | null },
) {
  const out: RmLine[] = [];
  for (let page = 0; page < 20; page++) {
    let q = supabase
      .from("rm_cost_lines")
      .select("category,work_order_id,company_id,site_id,user_id,spent_on,hours,amount")
      .gte("spent_on", f.from)
      .lte("spent_on", f.to)
      .order("spent_on")
      .range(page * 1000, page * 1000 + 999);
    if (f.companyId) q = q.eq("company_id", f.companyId);
    if (f.siteId) q = q.eq("site_id", f.siteId);
    if (f.userId) q = q.eq("user_id", f.userId);
    if (f.category) q = q.eq("category", f.category);
    const { data, error } = await q;
    if (error) break;
    const rows = (data ?? []) as RmLine[];
    out.push(...rows.map((r) => ({ ...r, amount: Number(r.amount), hours: r.hours == null ? null : Number(r.hours) })));
    if (rows.length < 1000) break;
  }
  return out;
}

export const RM_CATEGORY_LABEL: Record<RmLine["category"], string> = {
  labor: "Internal technician labor",
  parts: "Parts & materials",
  vendor: "Outside vendor costs",
};
