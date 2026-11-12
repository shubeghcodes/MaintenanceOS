import type { FreqUnit } from "./types";

const TZ = process.env.NEXT_PUBLIC_TIMEZONE || "America/Los_Angeles";

export function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  // Plain dates (YYYY-MM-DD) are calendar dates — don't shift them by timezone.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T12:00:00") : new Date(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
}

export function fmtDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  });
}

export function fmtMoney(value: number | null | undefined, digits = 0) {
  if (value == null) return "—";
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtFreq(n: number, unit: FreqUnit) {
  if (n === 1) return { day: "Daily", week: "Weekly", month: "Monthly", year: "Annually" }[unit];
  if (unit === "month" && n === 3) return "Quarterly";
  if (unit === "month" && n === 6) return "Semi-annually";
  return `Every ${n} ${unit}s`;
}

/** Today's date (YYYY-MM-DD) in the company timezone. */
export function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

export function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from today until a YYYY-MM-DD date (negative = past). */
export function daysUntil(iso: string | null | undefined) {
  if (!iso) return null;
  const a = new Date(todayISO() + "T12:00:00Z").getTime();
  const b = new Date(iso.slice(0, 10) + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Lowercase phrase that reads after "due"/"next": "today", "in 3d", "5d overdue". */
export function dueWhen(iso: string | null | undefined) {
  const d = daysUntil(iso);
  if (d == null) return "—";
  if (d === 0) return "today";
  if (d < 0) return `${-d}d overdue`;
  return `in ${d}d`;
}

export function relativeDue(iso: string | null | undefined) {
  const d = daysUntil(iso);
  if (d == null) return "—";
  if (d === 0) return "Due today";
  if (d < 0) return `${-d}d overdue`;
  return `In ${d}d`;
}

export function isOverdue(dueAt: string | null, status: string) {
  return !!dueAt && !["completed", "cancelled"].includes(status) && new Date(dueAt).getTime() < Date.now();
}

export function personName(p: { full_name: string | null; email: string | null } | null | undefined) {
  if (!p) return "—";
  return p.full_name || p.email || "—";
}

/** Read a trimmed string (or null) from FormData. */
export function str(fd: FormData, key: string) {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
export function num(fd: FormData, key: string) {
  const v = str(fd, key);
  if (v == null) return null;
  const n = Number(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** ISO instant for `date` at `hour`:00 in the company timezone (e.g. a 5pm due time). */
export function zonedTimeISO(date: string, hour = 17) {
  const guess = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  const tzHour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(guess),
  );
  let diff = hour - tzHour;
  if (diff > 12) diff -= 24;
  if (diff < -12) diff += 24;
  return new Date(guess.getTime() + diff * 3_600_000).toISOString();
}

/** YYYY-MM-DD for an instant, in the company timezone (for <input type="date"> defaults). */
export function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-CA", { timeZone: TZ });
}

/** "08:30:00" → "8:30 AM" */
export function fmtTime(t: string | null | undefined) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Monday of the week containing a YYYY-MM-DD date. */
export function weekStartISO(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  return addDaysISO(iso, -dow);
}

/** "Mon 11/16" style labels for calendar headers. */
export function dayLabel(iso: string, style: "short" | "long" = "short") {
  const d = new Date(iso + "T12:00:00Z");
  return style === "short"
    ? d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" })
    : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

export function isISODate(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
