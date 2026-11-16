import type { FreqUnit } from "./types";

/** Adds one PM interval to an ISO date the way Postgres does (month ends clamp: Jan 31 + 1 month = Feb 28). */
export function addFreq(iso: string, n: number, unit: FreqUnit): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (unit === "day" || unit === "week") {
    const t = new Date(Date.UTC(y, m - 1, d + n * (unit === "week" ? 7 : 1)));
    return t.toISOString().slice(0, 10);
  }
  const months = unit === "year" ? n * 12 : n;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

const minusDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

export type PmForecastSchedule = {
  id: string;
  next_due_on: string;
  lead_days: number;
  frequency_interval: number;
  frequency_unit: FreqUnit;
};

/**
 * Due dates in [from, to] for which the scheduler hasn't created a work order yet.
 * The next due date counts only if it's still outside the lead window, or if the schedule has no open work order
 * (e.g. created today, before the morning job runs). Later dates always count: they're generated in the future.
 */
export function upcomingDueDates(s: PmForecastSchedule, from: string, to: string, today: string, hasOpenWo: boolean): string[] {
  const out: string[] = [];
  let d = s.next_due_on;
  for (let i = 0; i < 400 && d <= to; i++) {
    const notYetGenerated = minusDays(d, s.lead_days) > today || (i === 0 && !hasOpenWo);
    if (d >= from && notYetGenerated) out.push(d);
    d = addFreq(d, Math.max(1, s.frequency_interval), s.frequency_unit);
  }
  return out;
}
