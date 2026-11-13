import clsx from "clsx";
import { fmtMoney } from "@/lib/format";

/**
 * Spent vs. budget bar. Admins (`showSpent`) see the dollars spent; everyone else sees
 * % used and what's left, so the internal labor inside "spent" isn't itemized.
 */
export function BudgetBar({ budget, spent, showSpent, compact }: { budget: number | null; spent: number; showSpent: boolean; compact?: boolean }) {
  if (budget == null) return <span className="text-xs text-slate-400">No budget</span>;
  const pct = budget > 0 ? Math.round((spent / budget) * 100) : spent > 0 ? 999 : 0;
  const left = budget - spent;
  const color = pct > 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  const text = clsx("tabular-nums", pct > 100 ? "font-medium text-red-700" : "text-slate-600");
  const pctText = pct >= 999 ? "Over" : `${pct}%`;
  return (
    <div className="min-w-0">
      <div className={clsx("rounded-full bg-slate-100", compact ? "h-1.5" : "h-2")}>
        <div className={clsx("rounded-full", color, compact ? "h-1.5" : "h-2")} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className={clsx("mt-1 flex flex-wrap justify-between gap-x-2 text-xs", text)}>
        <span>
          {showSpent ? `${fmtMoney(spent)} of ${fmtMoney(budget)}` : `${pctText} used`}
          {showSpent && <span className="text-slate-400"> · {pctText}</span>}
        </span>
        <span>{left >= 0 ? `${fmtMoney(left)} left` : `${fmtMoney(-left)} over`}</span>
      </p>
    </div>
  );
}
