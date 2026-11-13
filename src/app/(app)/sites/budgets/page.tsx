import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Pencil } from "lucide-react";
import { getSession, isSuper } from "@/lib/auth";
import { getCompanyScope, inCompany } from "@/lib/company";
import { addMonthsISO, loadBudgets, monthLabel, monthStartISO, parseMonth, pctUsed } from "@/lib/budgets";
import { fmtMoney } from "@/lib/format";
import { Alert, Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, Stat, Table, Td, Th, btnClass } from "@/components/ui";
import { BudgetBar } from "@/components/BudgetBar";
import { SubmitButton } from "@/components/SubmitButton";
import { saveBudgets } from "./actions";

export const metadata = { title: "Budgets" };
export const dynamic = "force-dynamic";

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  if (profile.role === "vendor") redirect("/work-orders");
  const superMe = isSuper(profile);
  const isAdmin = profile.role === "admin";
  const editing = superMe && sp.edit === "1";

  const thisMonth = monthStartISO();
  const month = parseMonth(sp.month) ?? thisMonth;
  const scope = await getCompanyScope();
  const cid = scope.companyId;
  const showCompany = !cid && scope.companies.length > 1;
  const companyName = new Map(scope.companies.map((c) => [c.id, c.name]));

  const [{ data: sData }, rows, { data: defData }] = await Promise.all([
    inCompany(supabase.from("sites").select("id,code,name,company_id").eq("active", true), cid).order("name"),
    loadBudgets(supabase, month, month),
    supabase.from("site_budgets").select("site_id,monthly_amount"),
  ]);
  const sites = (sData ?? []) as {
    id: string;
    code: string | null;
    name: string;
    company_id: string | null;
  }[];
  const byId = new Map(rows.map((r) => [r.site_id, r]));
  const defaults = new Map(((defData ?? []) as { site_id: string; monthly_amount: number }[]).map((d) => [d.site_id, Number(d.monthly_amount)]));
  const list = sites.map((s) => ({
    ...s,
    b: byId.get(s.id) ?? { budget: null, spent: 0, is_override: false },
  }));
  const budgeted = list.filter((s) => s.b.budget != null);
  const totBudget = budgeted.reduce((t, s) => t + (s.b.budget ?? 0), 0);
  const totSpent = budgeted.reduce((t, s) => t + s.b.spent, 0);
  const over = budgeted.filter((s) => (pctUsed(s.b) ?? 0) > 100).length;
  const near = budgeted.filter((s) => {
    const p = pctUsed(s.b) ?? 0;
    return p >= 80 && p <= 100;
  }).length;
  const totPct = totBudget > 0 ? Math.round((totSpent / totBudget) * 100) : null;

  const qs = (m: string, extra = "") => `/sites/budgets?month=${m.slice(0, 7)}${extra}`;

  return (
    <>
      <PageHeader
        title="Budgets"
        subtitle={`Monthly R&M budget by location, labor included${scope.company ? ` · ${scope.company.name}` : ""}`}
        back={{ href: "/sites", label: "Sites" }}
        actions={
          superMe && (
            <>
              <a href={`/sites/budgets/template?month=${month.slice(0, 7)}`} className={btnClass("secondary")}>
                <Download className="h-4 w-4" aria-hidden /> Export to Excel
              </a>
              <ButtonLink href="/sites/budgets/import" variant="secondary">
                <FileSpreadsheet className="h-4 w-4" aria-hidden /> Import from Excel
              </ButtonLink>
              {!editing && (
                <ButtonLink href={qs(month, "&edit=1")}>
                  <Pencil className="h-4 w-4" aria-hidden /> Edit budgets
                </ButtonLink>
              )}
            </>
          )
        }
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.saved && (
        <Alert tone="good">
          Budgets saved
          {/^\d+$/.test(sp.saved) ? ` (${sp.saved} location${sp.saved === "1" ? "" : "s"} changed)` : ""}.
        </Alert>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={qs(addMonthsISO(month, -1), editing ? "&edit=1" : "")} className={btnClass("secondary", "sm")} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
        <span className="min-w-28 text-center text-sm font-semibold">{monthLabel(month)}</span>
        <Link href={qs(addMonthsISO(month, 1), editing ? "&edit=1" : "")} className={btnClass("secondary", "sm")} aria-label="Next month">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
        {month !== thisMonth && (
          <Link href={qs(thisMonth, editing ? "&edit=1" : "")} className="text-xs font-medium text-brand-700">
            This month
          </Link>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Budget" value={fmtMoney(totBudget)} sub={`${budgeted.length} of ${sites.length} locations have a budget`} />
        <Stat
          label={isAdmin ? "Spent" : "Used"}
          value={isAdmin ? fmtMoney(totSpent) : totPct == null ? "—" : `${totPct}%`}
          sub={isAdmin && totPct != null ? `${totPct}% of budget` : "Labor, parts and vendors"}
          tone={totPct == null ? undefined : totPct > 100 ? "critical" : totPct >= 80 ? "warning" : "good"}
        />
        <Stat label={totBudget - totSpent >= 0 ? "Left" : "Over"} value={fmtMoney(Math.abs(totBudget - totSpent))} sub={monthLabel(month)} />
        <Stat label="Over budget" value={over} sub={`${near} more at 80% or above`} tone={over ? "critical" : near ? "warning" : "good"} />
      </div>

      <form action={saveBudgets}>
        <input type="hidden" name="back" value={qs(month)} />
        <Card>
          <CardHeader
            title={editing ? "Edit monthly budgets" : `${monthLabel(month)} by location`}
            subtitle={
              editing
                ? "The normal monthly budget for each location. Leave blank for no budget. Set a different amount for a single month on the location's page, or with Excel."
                : "Spent counts internal labor on the day it was worked, receipts on their purchase date, and other parts and vendor invoices when the work order is completed."
            }
            action={
              editing && (
                <div className="flex gap-2">
                  <Link href={qs(month)} className={btnClass("ghost", "sm")}>
                    Cancel
                  </Link>
                  <SubmitButton size="sm">Save budgets</SubmitButton>
                </div>
              )
            }
          />
          {sites.length === 0 ? (
            <EmptyState title="No locations visible." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Location</Th>
                  {showCompany && <Th>Company</Th>}
                  {editing ? <Th className="text-right">Monthly budget</Th> : <Th className="text-right">Budget</Th>}
                  {!editing && <Th className="w-2/5">{isAdmin ? "Spent" : "Used"}</Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((s) => {
                  const def = defaults.get(s.id);
                  return (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <Td>
                        <Link href={`/sites/${s.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {s.name}
                        </Link>
                        {s.code && <span className="ml-2 font-mono text-xs text-slate-400">{s.code}</span>}
                      </Td>
                      {showCompany && <Td className="text-xs text-slate-500">{s.company_id ? companyName.get(s.company_id) : "—"}</Td>}
                      {editing ? (
                        <Td className="text-right">
                          <input type="hidden" name="site_ids" value={s.id} />
                          <input type="hidden" name={`prev_${s.id}`} value={def != null ? String(def) : ""} />
                          <div className="ml-auto flex w-36 items-center gap-1">
                            <span className="text-slate-400">$</span>
                            <input
                              name={`amt_${s.id}`}
                              defaultValue={def != null ? String(def) : ""}
                              inputMode="decimal"
                              placeholder="No budget"
                              aria-label={`Monthly budget for ${s.name}`}
                              className="block w-full rounded-lg border-0 px-2 py-1.5 text-right text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
                            />
                          </div>
                          {s.b.is_override && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              {monthLabel(month)}: {fmtMoney(s.b.budget)} (set for this month)
                            </p>
                          )}
                        </Td>
                      ) : (
                        <Td className="whitespace-nowrap text-right tabular-nums">
                          {s.b.budget == null ? <span className="text-slate-400">—</span> : fmtMoney(s.b.budget)}
                          {s.b.is_override && (
                            <span className="ml-1.5">
                              <Badge tone="info" dot={false}>
                                This month
                              </Badge>
                            </span>
                          )}
                        </Td>
                      )}
                      {!editing && (
                        <Td>
                          <BudgetBar budget={s.b.budget} spent={s.b.spent} showSpent={isAdmin} />
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {editing && (
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <Link href={qs(month)} className={btnClass("ghost", "sm")}>
                Cancel
              </Link>
              <SubmitButton size="sm">Save budgets</SubmitButton>
            </div>
          )}
        </Card>
      </form>
      {!superMe && <p className="mt-3 text-xs text-slate-500">Budgets are set by a super admin.</p>}
    </>
  );
}
