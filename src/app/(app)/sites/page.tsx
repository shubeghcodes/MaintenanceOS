import { getCompanyScope, inCompany } from "@/lib/company";
import Link from "next/link";
import { FileSpreadsheet, MapPin, PiggyBank, Plus } from "lucide-react";
import { loadBudgets, monthStartISO } from "@/lib/budgets";
import { BudgetBar } from "@/components/BudgetBar";
import { getSession } from "@/lib/auth";
import { OPEN_STATUSES, SITE_TYPE_LABEL } from "@/lib/constants";
import { daysUntil, isOverdue } from "@/lib/format";
import type { Site } from "@/lib/types";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Sites" };

export default async function SitesPage() {
  const { supabase, profile } = await getSession();
  const scope = await getCompanyScope();
  const cid = scope.companyId;
  const companyName = new Map(scope.companies.map((c) => [c.id, c.name]));
  const showCompany = !cid && scope.companies.length > 1;
  const [{ data: sData }, { data: woData }, { data: cData }, { data: aData }] = await Promise.all([
    inCompany(supabase.from("sites").select("*"), cid).order("active", { ascending: false }).order("name"),
    inCompany(supabase.from("work_orders").select("site_id,status,due_at").in("status", OPEN_STATUSES), cid).limit(5000),
    inCompany(supabase.from("compliance_requirements").select("site_id,next_due_on").eq("active", true), cid),
    inCompany(supabase.from("assets").select("site_id,status").neq("status", "retired"), cid),
  ]);
  const budgets = new Map((await loadBudgets(supabase, monthStartISO(), monthStartISO())).map((b) => [b.site_id, b]));
  const anyBudget = [...budgets.values()].some((b) => b.budget != null);
  const sites = (sData ?? []) as (Site & { company_id?: string })[];
  const wos = (woData ?? []) as { site_id: string; status: string; due_at: string | null }[];
  const comp = (cData ?? []) as { site_id: string; next_due_on: string }[];
  const assets = (aData ?? []) as { site_id: string; status: string }[];

  return (
    <>
      <PageHeader
        title="Sites"
        subtitle={`${scope.company ? `${scope.company.name} · ` : ""}${sites.length} location${sites.length === 1 ? "" : "s"}`}
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
                  <FileSpreadsheet className="h-4 w-4" aria-hidden /> Import from Excel
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sites.map((s) => {
            const open = wos.filter((w) => w.site_id === s.id);
            const overdue = open.filter((w) => isOverdue(w.due_at, w.status)).length;
            const compOver = comp.filter((c) => c.site_id === s.id && (daysUntil(c.next_due_on) ?? 0) < 0).length;
            const down = assets.filter((a) => a.site_id === s.id && a.status === "down").length;
            return (
              <Link key={s.id} href={`/sites/${s.id}`}>
                <Card className={`h-full p-5 transition hover:border-slate-300 hover:shadow ${s.active ? "" : "opacity-60"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs text-slate-400">
                        {s.code}
                        {showCompany && s.company_id && <span className="ml-1 font-sans text-brand-700">{s.code ? "· " : ""}{companyName.get(s.company_id)}</span>}
                      </p>
                      <p className="font-semibold text-slate-900">{s.name}</p>
                    </div>
                    <Badge dot={false}>{SITE_TYPE_LABEL[s.type]}</Badge>
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3 w-3" aria-hidden /> {[s.city, s.state].filter(Boolean).join(", ") || "—"}
                  </p>
                  <div className="mt-4 grid grid-cols-4 gap-2 border-t border-slate-100 pt-3 text-center">
                    <Metric label="Open" value={open.length} />
                    <Metric label="Overdue" value={overdue} bad={overdue > 0} />
                    <Metric label="Compl. due" value={compOver} bad={compOver > 0} />
                    <Metric label="Down" value={down} bad={down > 0} />
                  </div>
                  {budgets.get(s.id)?.budget != null && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Budget this month</p>
                      <BudgetBar budget={budgets.get(s.id)!.budget} spent={budgets.get(s.id)!.spent} showSpent={profile.role === "admin"} compact />
                    </div>
                  )}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function Metric({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div>
      <p className={`text-lg font-semibold tabular-nums ${bad ? "text-red-700" : "text-slate-900"}`}>{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
