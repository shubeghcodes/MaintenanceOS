import Link from "next/link";
import clsx from "clsx";
import { ChevronRight, FileSpreadsheet, PiggyBank, Plus, Search } from "lucide-react";
import { getCompanyScope, inCompany } from "@/lib/company";
import { loadBudgets, monthStartISO } from "@/lib/budgets";
import { BudgetBar } from "@/components/BudgetBar";
import { getSession } from "@/lib/auth";
import { OPEN_STATUSES, SITE_TYPE_LABEL } from "@/lib/constants";
import { daysUntil, isOverdue, personName } from "@/lib/format";
import type { Site, SiteType } from "@/lib/types";
import { Badge, ButtonLink, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";

export const metadata = { title: "Sites" };

type Filter = "all" | "attention" | SiteType | "inactive";

export default async function SitesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  const scope = await getCompanyScope();
  const cid = scope.companyId;
  const companyName = new Map(scope.companies.map((c) => [c.id, c.name]));
  const showCompany = !cid && scope.companies.length > 1;
  const [{ data: sData }, { data: woData }, { data: cData }, { data: aData }, { data: mData }] = await Promise.all([
    inCompany(supabase.from("sites").select("*"), cid).order("code", { nullsFirst: false }).order("name"),
    inCompany(supabase.from("work_orders").select("site_id,status,due_at").in("status", OPEN_STATUSES), cid).limit(5000),
    inCompany(supabase.from("compliance_requirements").select("site_id,next_due_on").eq("active", true), cid),
    inCompany(supabase.from("assets").select("site_id,status").neq("status", "retired"), cid),
    supabase.from("site_members").select("site_id,user:profiles(full_name,email,role,active)"),
  ]);
  const budgets = new Map((await loadBudgets(supabase, monthStartISO(), monthStartISO())).map((b) => [b.site_id, b]));
  const anyBudget = [...budgets.values()].some((b) => b.budget != null);
  const sites = (sData ?? []) as (Site & { company_id?: string })[];
  const wos = (woData ?? []) as { site_id: string; status: string; due_at: string | null }[];
  const comp = (cData ?? []) as { site_id: string; next_due_on: string }[];
  const assets = (aData ?? []) as { site_id: string; status: string }[];
  const members = (mData ?? []) as unknown as { site_id: string; user: { full_name: string | null; email: string | null; role: string; active: boolean } | null }[];

  const stats = new Map(
    sites.map((s) => {
      const open = wos.filter((w) => w.site_id === s.id);
      const overdue = open.filter((w) => isOverdue(w.due_at, w.status)).length;
      const compOver = comp.filter((c) => c.site_id === s.id && (daysUntil(c.next_due_on) ?? 0) < 0).length;
      const down = assets.filter((a) => a.site_id === s.id && a.status === "down").length;
      const gms = members.filter((m) => m.site_id === s.id && m.user?.role === "manager" && m.user.active).map((m) => personName(m.user!));
      return [s.id, { open: open.length, overdue, compOver, down, gms, attention: overdue + compOver + down > 0 }];
    }),
  );

  const types = (Object.keys(SITE_TYPE_LABEL) as SiteType[]).filter((t) => sites.some((s) => s.type === t));
  const filters: [Filter, string][] = [
    ["all", "All"],
    ["attention", "Needs attention"],
    ...(types.length > 1 ? types.map((t) => [t, SITE_TYPE_LABEL[t]] as [Filter, string]) : []),
    ...(sites.some((s) => !s.active) ? ([["inactive", "Inactive"]] as [Filter, string][]) : []),
  ];
  const filter: Filter = filters.some(([k]) => k === sp.show) ? (sp.show as Filter) : "all";
  const q = (sp.q ?? "").trim().toLowerCase();
  const pass = (s: Site, f: Filter) =>
    f === "inactive" ? !s.active : s.active && (f === "all" || (f === "attention" ? stats.get(s.id)!.attention : s.type === f));
  const count = (f: Filter) => sites.filter((s) => pass(s, f)).length;
  const rows = sites
    .filter((s) => pass(s, filter))
    .filter((s) => !q || [s.code, s.name, s.city, s.address, s.brand, ...stats.get(s.id)!.gms].some((v) => (v ?? "").toLowerCase().includes(q)));

  const href = (f: Filter) => {
    const p = new URLSearchParams();
    if (f !== "all") p.set("show", f);
    if (sp.q) p.set("q", sp.q);
    return `/sites${p.size ? `?${p}` : ""}`;
  };
  const active = sites.filter((s) => s.active).length;

  return (
    <>
      <PageHeader
        title="Sites"
        subtitle={`${scope.company ? `${scope.company.name} · ` : ""}${active} active location${active === 1 ? "" : "s"}`}
        actions={
          <>
            {(anyBudget || profile.is_super) && (
              <ButtonLink href="/sites/budgets" variant="secondary">
                <PiggyBank className="h-4 w-4" aria-hidden /> Budgets
              </ButtonLink>
            )}
            {profile.role === "admin" && (
              <>
                <ButtonLink href="/sites/import" variant="secondary">
                  <FileSpreadsheet className="h-4 w-4" aria-hidden /> Import
                </ButtonLink>
                <ButtonLink href="/sites/new">
                  <Plus className="h-4 w-4" aria-hidden /> Add site
                </ButtonLink>
              </>
            )}
          </>
        }
      />

      {sites.length === 0 ? (
        <Card>
          <EmptyState title="No sites visible.">{profile.role === "admin" ? "Add your first location, or import them all from Excel." : "Ask an admin to add you to your location."}</EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {filters.map(([k, label]) => (
                <Link
                  key={k}
                  href={href(k)}
                  className={clsx(
                    "rounded-full px-3 py-1 text-sm ring-1 ring-inset",
                    filter === k ? "bg-brand-50 font-medium text-brand-700 ring-brand-300" : "text-slate-600 ring-slate-200 hover:bg-slate-50",
                  )}
                >
                  {label} <span className={clsx("tabular-nums", k === "attention" && count(k) > 0 ? "text-red-600" : "text-slate-400")}>{count(k)}</span>
                </Link>
              ))}
            </div>
            <form action="/sites" className="ml-auto flex w-full gap-2 sm:w-auto">
              {filter !== "all" && <input type="hidden" name="show" value={filter} />}
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
                <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search store #, name, city or GM" className="pl-8" />
              </div>
              <button className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">Go</button>
            </form>
          </div>

          <Card className="overflow-hidden">
            {rows.length === 0 ? (
              <EmptyState title="No sites match.">
                <Link href="/sites" className="font-medium text-brand-700">
                  Clear filters
                </Link>
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-5 py-2.5">Location</th>
                      <th className="hidden px-3 py-2.5 lg:table-cell">GM</th>
                      <th className="px-3 py-2.5 text-center">Open</th>
                      <th className="px-3 py-2.5 text-center">Overdue</th>
                      <th className="hidden px-3 py-2.5 text-center sm:table-cell">Compliance due</th>
                      <th className="hidden px-3 py-2.5 text-center sm:table-cell">Down</th>
                      {anyBudget && <th className="hidden w-48 px-3 py-2.5 md:table-cell">Budget this month</th>}
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((s) => {
                      const st = stats.get(s.id)!;
                      const b = budgets.get(s.id);
                      const link = `/sites/${s.id}`;
                      return (
                        <tr key={s.id} className={clsx("group hover:bg-slate-50", !s.active && "text-slate-400")}>
                          <td className="px-5 py-3">
                            <Link href={link} className="block">
                              <span className="flex flex-wrap items-center gap-x-2">
                                {s.code && <span className="font-mono text-xs text-slate-500">#{s.code}</span>}
                                <span className={clsx("font-medium", s.active ? "text-slate-900" : "text-slate-500")}>{s.name}</span>
                                {!s.active && <Badge tone="muted">Inactive</Badge>}
                              </span>
                              <span className="block text-xs text-slate-500">
                                {[[s.city, s.state].filter(Boolean).join(", "), SITE_TYPE_LABEL[s.type], showCompany && s.company_id ? companyName.get(s.company_id) : null]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </Link>
                          </td>
                          <td className="hidden px-3 py-3 text-slate-700 lg:table-cell">
                            {st.gms.length ? st.gms.join(", ") : <span className="text-slate-300">—</span>}
                          </td>
                          <Num value={st.open} />
                          <Num value={st.overdue} bad />
                          <Num value={st.compOver} bad className="hidden sm:table-cell" />
                          <Num value={st.down} bad className="hidden sm:table-cell" />
                          {anyBudget && (
                            <td className="hidden px-3 py-3 md:table-cell">
                              <BudgetBar budget={b?.budget ?? null} spent={b?.spent ?? 0} showSpent={profile.role === "admin"} compact />
                            </td>
                          )}
                          <td className="px-4 py-3 text-right">
                            <Link href={link} aria-label={`Open ${s.name}`} className="inline-flex text-slate-400 group-hover:text-brand-700">
                              <ChevronRight className="h-4 w-4" aria-hidden />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function Num({ value, bad, className }: { value: number; bad?: boolean; className?: string }) {
  return (
    <td className={clsx("px-3 py-3 text-center tabular-nums", className)}>
      {value === 0 ? <span className="text-slate-300">0</span> : <span className={bad ? "font-semibold text-red-700" : "font-medium text-slate-900"}>{value}</span>}
    </td>
  );
}
