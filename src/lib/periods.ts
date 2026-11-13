import { isISODate, todayISO } from "./format";

export const PERIODS = [
  ["this_month", "This month"],
  ["last_month", "Last month"],
  ["this_quarter", "This quarter"],
  ["last_quarter", "Last quarter"],
  ["ytd", "Year to date"],
  ["last_year", "Last year"],
  ["last_12", "Last 12 months"],
  ["custom", "Custom dates"],
] as const;

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** Resolve a period preset (or custom from/to) to inclusive YYYY-MM-DD bounds in the company timezone. */
export function resolvePeriod(p: string | undefined, from?: string, to?: string) {
  const today = todayISO();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const q = Math.floor(m / 3);
  const key = PERIODS.some(([k]) => k === p) ? (p as (typeof PERIODS)[number][0]) : "this_month";
  switch (key) {
    case "last_month":
      return { key, from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    case "this_quarter":
      return { key, from: iso(y, q * 3, 1), to: today };
    case "last_quarter":
      return { key, from: iso(y, q * 3 - 3, 1), to: iso(y, q * 3, 0) };
    case "ytd":
      return { key, from: iso(y, 0, 1), to: today };
    case "last_year":
      return { key, from: iso(y - 1, 0, 1), to: iso(y - 1, 11, 31) };
    case "last_12":
      return { key, from: iso(y, m - 11, 1), to: today };
    case "custom":
      if (isISODate(from) && isISODate(to) && from <= to) return { key, from, to };
      return { key: "this_month" as const, from: iso(y, m, 1), to: today };
    default:
      return { key: "this_month" as const, from: iso(y, m, 1), to: today };
  }
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
