import { requireSuper } from "@/lib/auth";
import { getCompanyScope, inCompany } from "@/lib/company";
import { buildBudgetTemplate, type BudgetSite } from "@/lib/budget-import";
import { addMonthsISO, monthStartISO, parseMonth } from "@/lib/budgets";

export const runtime = "nodejs";

/** Current budgets for the selected company, as a workbook that can be edited and imported back. */
export async function GET(req: Request) {
  const { supabase } = await requireSuper();
  const scope = await getCompanyScope();
  const first = parseMonth(new URL(req.url).searchParams.get("month")) ?? monthStartISO();
  const [{ data: s }, { data: d }, { data: m }] = await Promise.all([
    inCompany(supabase.from("sites").select("id,code,name,company_id").eq("active", true), scope.companyId).order("name"),
    supabase.from("site_budgets").select("site_id,monthly_amount"),
    supabase.from("site_budget_months").select("site_id,month,amount").gte("month", first).lt("month", addMonthsISO(first, 12)),
  ]);
  const company = new Map(scope.companies.map((c) => [c.id, c.name]));
  const def = new Map(((d ?? []) as { site_id: string; monthly_amount: number }[]).map((x) => [x.site_id, Number(x.monthly_amount)]));
  const over = new Map<string, Map<string, number>>();
  for (const x of (m ?? []) as {
    site_id: string;
    month: string;
    amount: number;
  }[]) {
    if (!over.has(x.site_id)) over.set(x.site_id, new Map());
    over.get(x.site_id)!.set(x.month, Number(x.amount));
  }
  const sites: BudgetSite[] = (
    (s ?? []) as {
      id: string;
      code: string | null;
      name: string;
      company_id: string | null;
    }[]
  ).map((x) => ({
    id: x.id,
    code: x.code,
    name: x.name,
    company: x.company_id ? (company.get(x.company_id) ?? null) : null,
    monthly: def.get(x.id) ?? null,
    overrides: over.get(x.id) ?? new Map(),
  }));
  const buf = await buildBudgetTemplate(sites, first);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="MaintenanceOS-budgets-${first.slice(0, 7)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
