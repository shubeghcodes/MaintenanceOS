"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import {
  Boxes,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  ListChecks,
  Send,
  Receipt,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { UserRole } from "@/lib/types";
import { CompanySelect } from "./CompanySelect";

const NAV: { href: string; label: string; icon: typeof Wrench; roles: UserRole[] }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "manager", "tech"] },
  { href: "/my-day", label: "My day", icon: ListChecks, roles: ["tech"] },
  { href: "/work-orders", label: "Work orders", icon: ClipboardList, roles: ["admin", "manager", "tech", "vendor"] },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, roles: ["admin", "tech"] },
  { href: "/vendor-jobs", label: "Vendor work", icon: Send, roles: ["admin", "tech"] },
  { href: "/purchases", label: "Purchases", icon: Receipt, roles: ["admin", "tech"] },
  { href: "/pm", label: "Preventive maint.", icon: CalendarClock, roles: ["admin", "manager", "tech"] },
  { href: "/compliance", label: "Compliance", icon: ShieldCheck, roles: ["admin", "manager", "tech"] },
  { href: "/assets", label: "Assets", icon: Boxes, roles: ["admin", "manager", "tech"] },
  { href: "/sites", label: "Sites", icon: Building2, roles: ["admin", "manager", "tech"] },
  { href: "/vendors", label: "Vendors", icon: Truck, roles: ["admin", "tech"] },
  { href: "/companies", label: "Companies", icon: Briefcase, roles: ["admin"] },
  { href: "/admin/users", label: "Users", icon: Users, roles: ["admin"] },
];

type CompanyPicker = { companies: { id: string; name: string; active: boolean }[]; value: string | null } | null;

export function Sidebar({ role, name, roleLabel, companyPicker }: { role: UserRole; name: string; roleLabel: string; companyPicker?: CompanyPicker }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => n.roles.includes(role));

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={clsx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
              active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 px-4 py-4">
      <Link href="/account" onClick={() => setOpen(false)} className="block rounded-md hover:opacity-80">
        <p className="truncate text-sm font-medium text-white">{name}</p>
        <p className="text-xs text-slate-400">{roleLabel} · My account</p>
      </Link>
      <form action="/auth/signout" method="post" className="mt-3">
        <button className="flex items-center gap-2 text-xs text-slate-400 hover:text-white">
          <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
        </button>
      </form>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2 px-6 py-5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
        <Wrench className="h-4 w-4 text-white" aria-hidden />
      </div>
      <span className="text-base font-semibold text-white">MaintainOS</span>
    </div>
  );

  const picker = companyPicker && (
    <div className="px-4 pb-4">
      <CompanySelect companies={companyPicker.companies} value={companyPicker.value} canManage={role === "admin"} variant="dark" label="Company" />
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-slate-900 px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-brand-100" aria-hidden />
          <span className="font-semibold text-white">MaintainOS</span>
        </div>
        <button onClick={() => setOpen(true)} className="text-slate-200" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-slate-900">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-5 text-slate-300" aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {brand}
            {picker}
            {nav}
            {footer}
          </aside>
        </div>
      )}

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-slate-900 lg:flex">
        {brand}
        {picker}
        <div className="flex flex-1 flex-col overflow-y-auto">{nav}</div>
        {footer}
      </aside>
    </>
  );
}
