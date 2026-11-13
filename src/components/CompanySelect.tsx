"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { setCompany } from "@/app/(app)/companies/actions";

const NEW = "__new__";

/** "Select Company" dropdown. Remembers the choice across pages; "All companies" shows everything combined. */
export function CompanySelect({
  companies,
  value,
  canManage,
  variant = "light",
  label,
}: {
  companies: { id: string; name: string; active: boolean }[];
  value: string | null;
  canManage: boolean;
  variant?: "light" | "dark";
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = companies.filter((c) => c.active || c.id === value);

  return (
    <label className={clsx("block", pending && "opacity-60")}>
      {label && <span className={clsx("mb-1 block text-xs font-medium", variant === "dark" ? "text-slate-400" : "text-slate-600")}>{label}</span>}
      <select
        aria-label={label ?? "Select company"}
        value={value ?? "all"}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          if (v === NEW) {
            router.push("/companies?new=1");
            return;
          }
          start(async () => {
            await setCompany(v);
            router.refresh();
          });
        }}
        className={clsx(
          "block w-full rounded-lg border-0 py-2 pl-3 pr-8 text-sm font-medium ring-1 ring-inset focus:ring-2 focus:ring-inset focus:ring-brand-500",
          variant === "dark" ? "bg-white/10 text-white ring-white/15 [&>option]:text-slate-900" : "bg-white text-slate-900 ring-slate-300",
        )}
      >
        <option value="all">All companies</option>
        {active.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        {canManage && <option value={NEW}>+ Add new company…</option>}
      </select>
    </label>
  );
}
