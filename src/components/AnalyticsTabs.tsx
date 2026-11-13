import Link from "next/link";
import clsx from "clsx";

const TABS = [
  { key: "rm", href: "/rm", label: "R&M spending" },
  { key: "labor", href: "/labor", label: "Technician labor" },
  { key: "purchases", href: "/purchases", label: "Purchases" },
] as const;

/** Tabs shared by the Analytics pages (admins only). */
export function AnalyticsTabs({ active, reviewCount = 0 }: { active: (typeof TABS)[number]["key"]; reviewCount?: number }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={clsx(
            "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            active === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800",
          )}
        >
          {t.label}
          {t.key === "purchases" && reviewCount > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{reviewCount}</span>
          )}
        </Link>
      ))}
    </div>
  );
}
