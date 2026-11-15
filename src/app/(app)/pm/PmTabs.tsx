import Link from "next/link";

/** Schedules | Templates switch at the top of the PM pages (admins only). */
export function PmTabs({ active }: { active: "schedules" | "templates" }) {
  const tab = (key: typeof active, href: string, label: string) => (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${active === key ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="mb-4 inline-flex gap-1 rounded-lg bg-slate-100 p-1">
      {tab("schedules", "/pm", "Schedules")}
      {tab("templates", "/pm/templates", "Templates")}
    </div>
  );
}
