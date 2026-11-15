import { loadRmLines } from "@/lib/labor";
import { getCompanyScope } from "@/lib/company";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, Pencil, Phone, Plus, Receipt } from "lucide-react";
import { getSession, isSuper } from "@/lib/auth";
import { addMonthsISO, loadBudgets, monthLabel, monthStartISO } from "@/lib/budgets";
import { BudgetBar } from "@/components/BudgetBar";
import { OPEN_STATUSES, ROLE_LABEL, SITE_TYPE_LABEL } from "@/lib/constants";
import { fmtDate, fmtMoney, personName, relativeDue, todayISO } from "@/lib/format";
import type { AssetStatus, Site, UserRole, WoPriority, WoStatus } from "@/lib/types";
import { Alert, Badge, ButtonLink, Card, CardHeader, DefList, EmptyState, PageHeader, Stat } from "@/components/ui";
import { AssetStatusBadge, DueBadge, OverdueBadge, PriorityBadge, StatusBadge } from "@/components/badges";

export default async function SitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  const { data } = await supabase.from("sites").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const site = data as Site & { company_id?: string };
  const scope = await getCompanyScope();
  const companyName = scope.companies.find((c) => c.id === site.company_id)?.name;
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const superMe = isSuper(profile);
  const thisMonth = monthStartISO();

  const [{ data: woData }, spendData, { data: aData }, { data: cData }, { data: mData }] = await Promise.all([
    supabase
      .from("work_orders")
      .select("id,number,title,status,priority,due_at")
      .eq("site_id", id)
      .in("status", OPEN_STATUSES)
      .order("due_at"),
    loadRmLines(supabase, { from: yearStart, to: todayISO(), siteId: id }),
    supabase.from("assets").select("id,name,category,status").eq("site_id", id).neq("status", "retired").order("name"),
    supabase.from("compliance_requirements").select("id,name,next_due_on").eq("site_id", id).eq("active", true).order("next_due_on"),
    supabase.from("site_members").select("user:profiles(id,full_name,email,role,phone)").eq("site_id", id),
  ]);
  const [budgetRows, { data: defData }, { data: ovData }] = await Promise.all([
    loadBudgets(supabase, addMonthsISO(thisMonth, -5), thisMonth, id),
    supabase.from("site_budgets").select("monthly_amount").eq("site_id", id).maybeSingle(),
    supabase.from("site_budget_months").select("month,amount,note").eq("site_id", id).gte("month", addMonthsISO(thisMonth, -12)).order("month"),
  ]);
  const defaultBudget = defData ? Number((defData as { monthly_amount: number }).monthly_amount) : null;
  const overrides = ((ovData ?? []) as { month: string; amount: number; note: string | null }[]).map((o) => ({ ...o, amount: Number(o.amount) }));
  const budgetNow = budgetRows.find((b) => b.month === thisMonth);
  const budgetHistory = budgetRows.filter((b) => b.month < thisMonth && b.budget != null).reverse();
  const upcoming = overrides.filter((o) => o.month > thisMonth);
  const hasBudget = defaultBudget != null || overrides.length > 0;
  const wos = (woData ?? []) as { id: string; number: number; title: string; status: WoStatus; priority: WoPriority; due_at: string | null }[];
  const ytd = spendData.reduce((s, l) => s + l.amount, 0);
  const ytdLabor = spendData.filter((l) => l.category === "labor").reduce((s, l) => s + l.amount, 0);
  const assets = (aData ?? []) as { id: string; name: string; category: string; status: AssetStatus }[];
  const comp = (cData ?? []) as { id: string; name: string; next_due_on: string }[];
  const members = ((mData ?? []) as unknown as { user: { id: string; full_name: string | null; email: string | null; role: UserRole; phone: string | null } | null }[])
    .map((m) => m.user)
    .filter(Boolean) as { id: string; full_name: string | null; email: string | null; role: UserRole; phone: string | null }[];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {site.code && <span className="font-mono text-xl text-slate-400">#{site.code}</span>}
            {site.name}
            {!site.active && <Badge tone="muted">Inactive</Badge>}
          </span>
        }
        subtitle={[companyName, SITE_TYPE_LABEL[site.type], site.brand].filter(Boolean).join(" · ")}
        back={{ href: "/sites", label: "Sites" }}
        actions={
          profile.role !== "vendor" && (
            <>
              {profile.role === "admin" && (
                <ButtonLink href={`/sites/${id}/edit`} variant="secondary">
                  <Pencil className="h-4 w-4" aria-hidden /> Edit site
                </ButtonLink>
              )}
              <ButtonLink href={`/purchases/new?site=${id}`} variant="secondary">
                <Receipt className="h-4 w-4" aria-hidden /> Log a purchase
              </ButtonLink>
              <ButtonLink href={`/work-orders/new?site=${id}`}>
                <Plus className="h-4 w-4" aria-hidden /> New request
              </ButtonLink>
            </>
          )
        }
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.saved && sp.saved !== "budget" && <Alert tone="good">Site saved.</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open work orders" value={wos.length} href={`/work-orders?site=${id}`} />
        <Stat label="R&M spend YTD" value={fmtMoney(ytd)} sub={ytdLabor ? `Incl. ${fmtMoney(ytdLabor)} internal labor` : undefined} href={profile.role === "admin" ? `/rm?period=ytd&site=${id}` : undefined} />
        <Stat label="Assets" value={assets.length} sub={`${assets.filter((a) => a.status === "down").length} down`} href={`/assets?site=${id}`} />
        <Stat label="Compliance items" value={comp.length} sub={`${comp.filter((c) => c.next_due_on < todayISO()).length} overdue`} href={`/compliance?site=${id}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Open work orders" />
          {wos.length === 0 ? (
            <EmptyState title="No open work orders." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {wos.map((w) => (
                <li key={w.id}>
                  <Link href={`/work-orders/${w.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <span className="w-12 font-mono text-xs text-slate-400">#{w.number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{w.title}</span>
                    <OverdueBadge dueAt={w.due_at} status={w.status} />
                    <PriorityBadge priority={w.priority} />
                    <StatusBadge status={w.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Compliance" action={<Link href={`/compliance?site=${id}`} className="text-xs font-medium text-brand-700">All</Link>} />
          {comp.length === 0 ? (
            <EmptyState title="No requirements set up." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {comp.slice(0, 10).map((c) => (
                <li key={c.id}>
                  <Link href={`/compliance/${c.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{c.name}</p>
                      <p className="text-xs text-slate-500">{fmtDate(c.next_due_on)} · {relativeDue(c.next_due_on)}</p>
                    </div>
                    <DueBadge date={c.next_due_on} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Assets" action={<Link href={`/assets?site=${id}`} className="text-xs font-medium text-brand-700">All</Link>} />
          {assets.length === 0 ? (
            <EmptyState title="No assets recorded." />
          ) : (
            <ul className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">
              {assets.map((a) => (
                <li key={a.id} className="sm:border-b sm:border-slate-100">
                  <Link href={`/assets/${a.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{a.name}</p>
                      <p className="text-xs text-slate-500">{a.category}</p>
                    </div>
                    <AssetStatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <div className="space-y-2 px-5 py-4 text-sm">
              {[site.address, site.city, site.state].some(Boolean) ? (
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent([site.address, site.city, site.state, site.zip].filter(Boolean).join(", "))}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-2 text-slate-700 hover:text-brand-700"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <span>
                    {site.address && <span className="block">{site.address}</span>}
                    {[[site.city, site.state].filter(Boolean).join(", "), site.zip].filter(Boolean).join(" ")}
                  </span>
                </a>
              ) : (
                <p className="text-slate-400">No address yet.</p>
              )}
              {site.phone && (
                <a href={`tel:${site.phone}`} className="flex items-center gap-2 text-slate-700 hover:text-brand-700">
                  <Phone className="h-4 w-4 text-slate-400" aria-hidden /> {site.phone}
                </a>
              )}
              {site.sq_ft != null && <p className="text-xs text-slate-500">{site.sq_ft.toLocaleString()} sq ft</p>}
            </div>
            {site.notes && <p className="whitespace-pre-wrap border-t border-slate-100 px-5 py-4 text-sm text-slate-700">{site.notes}</p>}
          </Card>
          {(hasBudget || superMe) && (
            <Card>
              <CardHeader
                title="Monthly budget"
                subtitle="R&M spend vs. budget, labor included"
                action={
                  <Link href={superMe ? `/sites/${id}/edit#budget` : "/sites/budgets"} className="text-xs font-medium text-brand-700">
                    {superMe ? "Edit" : "All locations"}
                  </Link>
                }
              />
              <div className="space-y-4 px-5 py-4">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-500">
                    {monthLabel(thisMonth)}
                    {budgetNow?.budget != null && ` · ${fmtMoney(budgetNow.budget)} budget`}
                  </p>
                  <BudgetBar budget={budgetNow?.budget ?? null} spent={budgetNow?.spent ?? 0} showSpent={profile.role === "admin"} />
                </div>
                {budgetHistory.length > 0 && (
                  <ul className="space-y-2 border-t border-slate-100 pt-3">
                    {budgetHistory.map((b) => (
                      <li key={b.month} className="grid grid-cols-[4.5rem_1fr] items-start gap-2">
                        <span className="text-xs text-slate-500">{monthLabel(b.month)}</span>
                        <BudgetBar budget={b.budget} spent={b.spent} showSpent={profile.role === "admin"} compact />
                      </li>
                    ))}
                  </ul>
                )}
                {upcoming.length > 0 && (
                  <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                    Coming up: {upcoming.slice(0, 4).map((o) => `${monthLabel(o.month)} ${fmtMoney(o.amount)}`).join(" · ")}
                  </p>
                )}
                {!hasBudget && <p className="text-xs text-slate-500">No budget set yet.</p>}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader
              title="Team"
              subtitle="Managed under Users"
              action={
                profile.role === "admin" && (
                  <Link href={`/admin/users?view=sites&site=${id}`} className="text-xs font-medium text-brand-700">
                    Add / manage
                  </Link>
                )
              }
            />
            {members.length === 0 ? (
              <EmptyState title="No one assigned." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {members.map((m) => (
                  <li key={m.id} className="px-5 py-2.5">
                    <p className="text-sm font-medium">{personName(m)}</p>
                    <p className="text-xs text-slate-500">
                      {m.role === "manager" ? "GM" : ROLE_LABEL[m.role]}
                      {m.phone && ` · ${m.phone}`}
                    </p>
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
