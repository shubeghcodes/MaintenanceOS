import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getCompanyScope, inCompany, WO_COMPANY_COL, WO_COMPANY_JOIN } from "@/lib/company";
import { CompanySelect } from "@/components/CompanySelect";
import { OPEN_STATUSES } from "@/lib/constants";
import { addDaysISO, daysUntil, fmtDate, fmtFreq, fmtMoney, isOverdue, relativeDue, dueWhen, todayISO } from "@/lib/format";
import type { AssetStatus, FreqUnit, WoPriority, WoStatus, WoType } from "@/lib/types";
import { ButtonLink, Card, CardHeader, EmptyState, Stat } from "@/components/ui";
import { AssetStatusBadge, DueBadge, PriorityBadge, StatusBadge } from "@/components/badges";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

type OpenWo = {
  id: string;
  number: number;
  title: string;
  status: WoStatus;
  priority: WoPriority;
  type: WoType;
  due_at: string | null;
  site_id: string;
  company_id?: string;
  site: { code: string | null; name: string } | null;
};
type DoneWo = {
  id: string;
  type: WoType;
  site_id: string;
  company_id?: string;
  category: string;
  created_at: string;
  completed_at: string;
  due_at: string | null;
  total_cost: number;
};

export default async function Dashboard() {
  const { supabase, profile } = await getSession();
  if (profile.role === "vendor") redirect("/work-orders");

  const today = todayISO();
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const monthStart = today.slice(0, 8) + "01";

  const isStaff = profile.role === "admin" || profile.role === "tech";
  const scope = await getCompanyScope();
  const cid = scope.companyId;
  const co = scope.enabled ? ",company_id" : "";
  const woJoin = cid ? `id, ${WO_COMPANY_JOIN}` : "id";
  const vendorCount = <Q,>(q: Q) => inCompany(q, cid, WO_COMPANY_COL);
  const [vendorAction, openRes, doneRes, compRes, pmRes, assetRes, siteRes] = await Promise.all([
    isStaff
      ? Promise.all([
          vendorCount(supabase.from("approval_requests").select(woJoin, { count: "exact", head: true }).eq("status", "pending")),
          vendorCount(supabase.from("vendor_dispatches").select(woJoin, { count: "exact", head: true }).eq("status", "work_completed")),
          vendorCount(supabase.from("vendor_invoices").select(woJoin, { count: "exact", head: true }).in("status", ["submitted", "under_review"])),
        ]).then(([a, b, c]) => ({ approvals: a.count ?? 0, reviews: b.count ?? 0, invoices: c.count ?? 0 }))
      : Promise.resolve({ approvals: 0, reviews: 0, invoices: 0 }),
    inCompany(
      supabase.from("work_orders").select(`id,number,title,status,priority,type,due_at,site_id${co},site:sites(code,name)`).in("status", OPEN_STATUSES),
      cid,
    ).limit(2000),
    inCompany(
      supabase.from("work_orders").select(`id,type,site_id${co},category,created_at,completed_at,due_at,total_cost`).eq("status", "completed").gte("completed_at", since90),
      cid,
    ).limit(5000),
    inCompany(supabase.from("compliance_requirements").select("id,name,next_due_on,site:sites(code,name)").eq("active", true), cid)
      .lte("next_due_on", addDaysISO(today, 30))
      .order("next_due_on"),
    inCompany(supabase.from("pm_schedules").select("id,title,next_due_on,frequency_interval,frequency_unit,site:sites(code,name)").eq("active", true), cid)
      .lte("next_due_on", addDaysISO(today, 14))
      .order("next_due_on")
      .limit(8),
    inCompany(supabase.from("assets").select("id,name,status,site:sites(code,name)").in("status", ["down", "needs_repair"]), cid)
      .order("status")
      .limit(8),
    inCompany(supabase.from("sites").select(`id,code,name${co}`).eq("active", true), cid).order("name"),
  ]);

  const open = (openRes.data ?? []) as unknown as OpenWo[];
  const done = (doneRes.data ?? []) as unknown as DoneWo[];
  const compliance = (compRes.data ?? []) as unknown as { id: string; name: string; next_due_on: string; site: { code: string | null; name: string } | null }[];
  const pms = (pmRes.data ?? []) as unknown as { id: string; title: string; next_due_on: string; frequency_interval: number; frequency_unit: FreqUnit; site: { code: string | null; name: string } | null }[];
  const assetsDown = (assetRes.data ?? []) as unknown as { id: string; name: string; status: AssetStatus; site: { code: string | null; name: string } | null }[];
  const sites = (siteRes.data ?? []) as unknown as { id: string; code: string | null; name: string; company_id?: string }[];

  // KPIs
  const overdue = open.filter((w) => isOverdue(w.due_at, w.status));
  const urgent = open.filter((w) => w.priority === "emergency" || w.priority === "high");
  const unassigned = open.filter((w) => w.status === "new");
  const pmDone = done.filter((w) => w.type === "preventive");
  const pmOnTime = pmDone.filter((w) => !w.due_at || new Date(w.completed_at) <= new Date(w.due_at));
  const pmRate = pmDone.length ? Math.round((pmOnTime.length / pmDone.length) * 100) : null;
  const compOverdue = compliance.filter((c) => (daysUntil(c.next_due_on) ?? 0) < 0);
  const reactive30 = done.filter((w) => w.type === "reactive" && w.completed_at >= new Date(Date.now() - 30 * 86_400_000).toISOString());
  const avgHours = reactive30.length
    ? reactive30.reduce((s, w) => s + (new Date(w.completed_at).getTime() - new Date(w.created_at).getTime()) / 3_600_000, 0) / reactive30.length
    : null;
  const monthDone = done.filter((w) => w.completed_at.slice(0, 10) >= monthStart);
  const spendMtd = monthDone.reduce((s, w) => s + Number(w.total_cost || 0), 0);

  // Per-site rollup
  const perSite = sites
    .map((s) => ({
      ...s,
      open: open.filter((w) => w.site_id === s.id).length,
      overdue: overdue.filter((w) => w.site_id === s.id).length,
      spend: monthDone.filter((w) => w.site_id === s.id).reduce((t, w) => t + Number(w.total_cost || 0), 0),
    }))
    .sort((a, b) => b.spend - a.spend || b.open - a.open);
  const maxSpend = Math.max(1, ...perSite.map((s) => s.spend));
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const completed30 = done.filter((w) => w.completed_at >= since30);

  // Consolidated view across companies ("All companies")
  const perCompany =
    scope.enabled && !cid && scope.companies.length > 1
      ? scope.companies
          .map((c) => ({
            ...c,
            sites: sites.filter((s) => s.company_id === c.id).length,
            open: open.filter((w) => w.company_id === c.id).length,
            overdue: overdue.filter((w) => w.company_id === c.id).length,
            completed: completed30.filter((w) => w.company_id === c.id).length,
            spend: monthDone.filter((w) => w.company_id === c.id).reduce((t, w) => t + Number(w.total_cost || 0), 0),
          }))
          .filter((c) => c.active || c.sites || c.open)
      : [];

  // Attention list: overdue first, then emergencies/high, then unassigned
  const rank = (w: OpenWo) => (isOverdue(w.due_at, w.status) ? 0 : w.priority === "emergency" ? 1 : w.priority === "high" ? 2 : w.status === "new" ? 3 : 9);
  const attention = open.filter((w) => rank(w) < 9).sort((a, b) => rank(a) - rank(b) || (a.due_at ?? "").localeCompare(b.due_at ?? "")).slice(0, 8);

  const firstName = (profile.full_name ?? "").split(" ")[0];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{firstName ? `Hi, ${firstName}` : "Dashboard"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {fmtDate(today)} · {scope.company ? `${scope.company.name} · ` : scope.enabled && scope.companies.length > 1 ? "All companies · " : ""}
            {sites.length} site{sites.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {scope.enabled && profile.role !== "manager" && (
            <div className="w-64">
              <CompanySelect companies={scope.companies} value={cid} canManage={profile.role === "admin"} label="Select Company" />
            </div>
          )}
          {scope.enabled && profile.role === "admin" && (
            <ButtonLink href="/companies?new=1" variant="secondary">
              <Plus className="h-4 w-4" aria-hidden /> Add New Company
            </ButtonLink>
          )}
          <ButtonLink href="/work-orders/new">
            <Plus className="h-4 w-4" aria-hidden /> {profile.role === "manager" ? "Submit request" : "New work order"}
          </ButtonLink>
        </div>
      </div>

      {vendorAction.approvals + vendorAction.reviews + vendorAction.invoices > 0 && (
        <Link href="/vendor-jobs?show=action" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-orange-50 px-4 py-3 text-sm text-orange-950 ring-1 ring-inset ring-orange-200 hover:bg-orange-100">
          <b>Vendors are waiting on you:</b>
          {vendorAction.approvals > 0 && <span>{vendorAction.approvals} approval request{vendorAction.approvals > 1 ? "s" : ""}</span>}
          {vendorAction.reviews > 0 && <span>{vendorAction.reviews} completed job{vendorAction.reviews > 1 ? "s" : ""} to review</span>}
          {vendorAction.invoices > 0 && <span>{vendorAction.invoices} invoice{vendorAction.invoices > 1 ? "s" : ""} to review</span>}
          <span className="ml-auto font-medium">Open vendor work →</span>
        </Link>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Locations" value={sites.length} sub={scope.company ? scope.company.name : "Active sites"} href="/sites" />
        <Stat label="Completed" value={completed30.length} sub="Work orders, last 30 days" href="/work-orders?status=completed" />
        <Stat label="Open work orders" value={open.length} sub={`${unassigned.length} unassigned`} href="/work-orders" />
        <Stat
          label="Overdue"
          value={overdue.length}
          sub={overdue.length ? "Past due date" : "None past due"}
          tone={overdue.length ? "critical" : "good"}
          href="/work-orders?status=overdue"
        />
        <Stat label="Emergency + high" value={urgent.length} sub="Open, high priority" tone={urgent.length ? "serious" : "good"} href="/work-orders" />
        <Stat
          label="PM on-time"
          value={pmRate == null ? "—" : `${pmRate}%`}
          sub={`${pmOnTime.length}/${pmDone.length} PMs, last 90 days`}
          tone={pmRate == null ? undefined : pmRate >= 90 ? "good" : pmRate >= 75 ? "warning" : "critical"}
          href="/pm"
        />
        <Stat
          label="Compliance overdue"
          value={compOverdue.length}
          sub={`${compliance.length - compOverdue.length} more due in 30 days`}
          tone={compOverdue.length ? "critical" : compliance.length ? "warning" : "good"}
          href="/compliance"
        />
        <Stat
          label="R&M spend MTD"
          value={fmtMoney(spendMtd)}
          sub={avgHours == null ? "Completed work this month" : `Avg reactive close: ${avgHours < 48 ? `${avgHours.toFixed(1)} h` : `${(avgHours / 24).toFixed(1)} d`}`}
        />
      </div>

      {perCompany.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="By company" subtitle="All companies combined. Pick one from Select Company to focus on it." />
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 text-right font-medium">Locations</th>
                  <th className="px-3 py-2 text-right font-medium">Open</th>
                  <th className="px-3 py-2 text-right font-medium">Overdue</th>
                  <th className="px-3 py-2 text-right font-medium">Completed 30d</th>
                  <th className="px-5 py-2 text-right font-medium">Spend MTD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {perCompany.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5 font-medium">{c.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.sites}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.open}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${c.overdue ? "font-semibold text-red-700" : "text-slate-400"}`}>{c.overdue}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.completed}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{fmtMoney(c.spend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Needs attention" subtitle="Overdue, emergency, high priority and unassigned" action={<Link href="/work-orders" className="text-xs font-medium text-brand-700">View all</Link>} />
          {attention.length === 0 ? (
            <EmptyState title="Nothing urgent. Nice." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((w) => (
                <li key={w.id}>
                  <Link href={`/work-orders/${w.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <span className="w-12 font-mono text-xs text-slate-400">#{w.number}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{w.title}</p>
                      <p className="text-xs text-slate-500">
                        {w.site?.code ?? w.site?.name} · {isOverdue(w.due_at, w.status) ? <span className="font-medium text-red-700">overdue</span> : `due ${dueWhen(w.due_at)}`}
                      </p>
                    </div>
                    <PriorityBadge priority={w.priority} />
                    <span className="hidden sm:block">
                      <StatusBadge status={w.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Compliance due" subtitle="Overdue or due within 30 days" action={<Link href="/compliance" className="text-xs font-medium text-brand-700">View all</Link>} />
          {compliance.length === 0 ? (
            <EmptyState title="All compliance items are current." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {compliance.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <Link href={`/compliance/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-slate-500">
                        {c.site?.code ?? c.site?.name} · {fmtDate(c.next_due_on)}
                      </p>
                    </div>
                    <DueBadge date={c.next_due_on} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="By site" subtitle="Open work and completed spend this month" />
          {perSite.length === 0 ? (
            <EmptyState title="No sites yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2 font-medium">Site</th>
                    <th className="px-3 py-2 text-right font-medium">Open</th>
                    <th className="px-3 py-2 text-right font-medium">Overdue</th>
                    <th className="w-1/2 px-5 py-2 font-medium">Spend MTD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {perSite.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-5 py-2.5">
                        <Link href={`/sites/${s.id}`} className="font-medium hover:text-brand-700">
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.open}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${s.overdue ? "font-semibold text-red-700" : "text-slate-400"}`}>{s.overdue}</td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-3" title={`${s.name}: ${fmtMoney(s.spend)}`}>
                          <div className="h-2 flex-1 rounded-full bg-slate-100">
                            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${(s.spend / maxSpend) * 100}%` }} />
                          </div>
                          <span className="w-20 text-right text-xs tabular-nums text-slate-700">{fmtMoney(s.spend)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="PM coming up" subtitle="Next 14 days" action={<Link href="/pm" className="text-xs font-medium text-brand-700">Schedules</Link>} />
            {pms.length === 0 ? (
              <EmptyState title="No PMs due in the next two weeks." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {pms.map((p) => (
                  <li key={p.id}>
                    <Link href={`/pm/${p.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-slate-50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.title}</p>
                        <p className="text-xs text-slate-500">
                          {p.site?.code ?? p.site?.name} · {fmtFreq(p.frequency_interval, p.frequency_unit)}
                        </p>
                      </div>
                      <span className="whitespace-nowrap text-xs text-slate-600">{relativeDue(p.next_due_on)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Equipment down" action={<Link href="/assets?status=down" className="text-xs font-medium text-brand-700">Assets</Link>} />
            {assetsDown.length === 0 ? (
              <EmptyState title="All equipment operational." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {assetsDown.map((a) => (
                  <li key={a.id}>
                    <Link href={`/assets/${a.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-slate-50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.name}</p>
                        <p className="text-xs text-slate-500">{a.site?.code ?? a.site?.name}</p>
                      </div>
                      <AssetStatusBadge status={a.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
