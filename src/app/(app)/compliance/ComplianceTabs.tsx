import Link from "next/link";
import clsx from "clsx";
import { CalendarDays, FileCheck2, ListChecks } from "lucide-react";

const TABS = [
  { key: "list", href: "/compliance", label: "Requirements", icon: ListChecks },
  { key: "calendar", href: "/compliance/calendar", label: "Calendar", icon: CalendarDays },
  { key: "certificates", href: "/compliance/certificates", label: "Completed & certificates", icon: FileCheck2 },
] as const;

export function ComplianceTabs({ active, site }: { active: (typeof TABS)[number]["key"]; site?: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map(({ key, href, label, icon: Icon }) => (
        <Link
          key={key}
          href={site ? `${href}?site=${site}` : href}
          className={clsx(
            "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            active === key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden /> {label}
        </Link>
      ))}
    </nav>
  );
}
