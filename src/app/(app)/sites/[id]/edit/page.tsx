import { notFound } from "next/navigation";
import { getCompanyScope } from "@/lib/company";
import { isSuper, requireRole } from "@/lib/auth";
import { addMonthsISO, monthLabel, monthStartISO } from "@/lib/budgets";
import { fmtMoney } from "@/lib/format";
import type { Site } from "@/lib/types";
import { Alert, Card, Field, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { FormSection } from "@/components/FormSection";
import { deleteBudgetMonth, saveBudgetMonth, saveSiteBudget } from "../../budgets/actions";
import { SiteForm } from "../../SiteForm";

export const metadata = { title: "Edit site" };

export default async function EditSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireRole("admin");
  const { data } = await supabase.from("sites").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const site = data as Site & { company_id?: string };
  const scope = await getCompanyScope();
  const superMe = isSuper(profile);
  const thisMonth = monthStartISO();
  const back = `/sites/${id}/edit#budget`;

  const [{ data: defData }, { data: ovData }] = superMe
    ? await Promise.all([
        supabase.from("site_budgets").select("monthly_amount").eq("site_id", id).maybeSingle(),
        supabase.from("site_budget_months").select("month,amount,note").eq("site_id", id).gte("month", addMonthsISO(thisMonth, -12)).order("month"),
      ])
    : [{ data: null }, { data: null }];
  const defaultBudget = defData ? Number((defData as { monthly_amount: number }).monthly_amount) : null;
  const overrides = ((ovData ?? []) as { month: string; amount: number; note: string | null }[]).map((o) => ({ ...o, amount: Number(o.amount) }));

  return (
    <>
      <PageHeader title={`Edit ${site.code ? `#${site.code}` : "site"}`} subtitle={site.name} back={{ href: `/sites/${id}`, label: site.name }} />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.saved === "budget" && <Alert tone="good">Budget saved.</Alert>}

      <SiteForm site={site} companies={scope.companies} />

      {superMe && (
        <Card className="mt-6">
          <FormSection
            id="budget"
            title="Monthly R&M budget"
            help="Labor, parts and vendor costs. Everyone at this location sees how much is used; only admins see dollars spent."
          >
            <form action={saveSiteBudget} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="site_id" value={id} />
              <input type="hidden" name="back" value={back} />
              <Field label="Normal monthly budget" hint="Leave blank for no budget." className="w-60">
                <Input name="monthly_amount" inputMode="decimal" defaultValue={defaultBudget != null ? String(defaultBudget) : ""} placeholder="2500" />
              </Field>
              <SubmitButton variant="secondary">Save</SubmitButton>
            </form>
          </FormSection>
          <FormSection title="Different amount for a month" help="For months that differ from the normal budget, like a bigger summer HVAC month.">
            {overrides.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {overrides.map((o) => (
                  <li key={o.month} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{monthLabel(o.month)}</span> · {fmtMoney(o.amount)}
                      {o.note && <span className="text-slate-500"> · {o.note}</span>}
                    </span>
                    <form action={deleteBudgetMonth}>
                      <input type="hidden" name="site_id" value={id} />
                      <input type="hidden" name="month" value={o.month} />
                      <input type="hidden" name="back" value={back} />
                      <SubmitButton variant="ghost" size="sm">
                        Use normal budget
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={saveBudgetMonth} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="site_id" value={id} />
              <input type="hidden" name="back" value={back} />
              <Field label="Month" className="w-44">
                <Input type="month" name="month" defaultValue={addMonthsISO(thisMonth, 1).slice(0, 7)} required />
              </Field>
              <Field label="Budget" className="w-32">
                <Input name="amount" inputMode="decimal" placeholder="4000" required />
              </Field>
              <Field label="Note (optional)" className="min-w-40 flex-1">
                <Input name="note" placeholder="AC tune-ups" />
              </Field>
              <SubmitButton variant="secondary">Set for month</SubmitButton>
            </form>
          </FormSection>
        </Card>
      )}
    </>
  );
}
