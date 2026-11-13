import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tone } from "./constants";
import { MONTHS } from "./periods";
import { todayISO } from "./format";

/** Budget vs. spent for one location and month. Spent is all R&M, internal labor included. */
export type BudgetRow = {
  site_id: string;
  month: string;
  budget: number | null;
  spent: number;
  is_override: boolean;
};

/** First day of the month containing `iso` (YYYY-MM-DD). */
export const monthStartISO = (iso: string = todayISO()) => iso.slice(0, 8) + "01";

export function addMonthsISO(monthIso: string, n: number) {
  const y = Number(monthIso.slice(0, 4));
  const m = Number(monthIso.slice(5, 7)) - 1 + n;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/** Last day of the month that starts at `monthIso`. */
export const monthEndISO = (monthIso: string) => {
  const y = Number(monthIso.slice(0, 4));
  const m = Number(monthIso.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export const monthLabel = (monthIso: string) => `${MONTHS[Number(monthIso.slice(5, 7)) - 1]} ${monthIso.slice(0, 4)}`;

/** "2026-11" or "2026-11-01" → "2026-11-01"; anything else → null. */
export function parseMonth(v: string | null | undefined) {
  const m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec((v ?? "").trim());
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-01`;
}

/** Budget status for every location the viewer can see (optionally one), for each month from..to. */
export async function loadBudgets(supabase: SupabaseClient, fromMonth: string, toMonth: string, siteId?: string | null): Promise<BudgetRow[]> {
  const { data, error } = await supabase.rpc("site_budget_status", {
    p_from: fromMonth,
    p_to: monthEndISO(toMonth),
    p_site: siteId ?? null,
  });
  if (error) return []; // budgets migration not run yet
  return ((data ?? []) as BudgetRow[]).map((r) => ({
    ...r,
    budget: r.budget == null ? null : Number(r.budget),
    spent: Number(r.spent),
  }));
}

export const pctUsed = (b: { budget: number | null; spent: number }) =>
  b.budget == null ? null : b.budget > 0 ? Math.round((b.spent / b.budget) * 100) : b.spent > 0 ? 999 : 0;

/** Green under 80%, amber to 100%, red over budget. */
export function budgetTone(pct: number | null): Tone {
  if (pct == null) return "muted";
  return pct > 100 ? "critical" : pct >= 80 ? "warning" : "good";
}

/** "$1,234.50", "1234", "1,234" → number; blank → null; junk → NaN. */
export function parseAmount(v: string | null | undefined) {
  const s = (v ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}
