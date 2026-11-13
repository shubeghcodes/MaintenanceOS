import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getCompanyScope } from "@/lib/company";
import { OPEN_STATUSES } from "@/lib/constants";
import { Alert, Badge, Card, CardHeader, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { saveCompany } from "./actions";

export const metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin");
  const scope = await getCompanyScope();

  if (!scope.enabled) {
    return (
      <>
        <PageHeader title="Companies" />
        <Alert>
          Run <code>supabase/migrations/0009_companies.sql</code> in the Supabase SQL editor to turn on companies. Your existing sites will be placed in a
          starting company you can rename.
        </Alert>
      </>
    );
  }

  const [{ data: sData }, { data: wData }] = await Promise.all([
    supabase.from("sites").select("company_id,active"),
    supabase.from("work_orders").select("company_id").in("status", OPEN_STATUSES).limit(10000),
  ]);
  const sites = (sData ?? []) as { company_id: string; active: boolean }[];
  const open = (wData ?? []) as { company_id: string }[];

  return (
    <>
      <PageHeader title="Companies" subtitle="Each company has its own locations, work orders and maintenance records. Switch between them from the dashboard." />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.created && (
        <Alert tone="good">
          {sp.created} was created and is now selected. <Link href="/sites/new" className="font-medium underline">Add its first location →</Link>
        </Alert>
      )}
      {sp.saved && <Alert tone="good">Company updated.</Alert>}

      <Card className="mb-6">
        <details open={!!sp.new || scope.companies.length === 0}>
          <summary className="cursor-pointer list-none px-5 py-3.5 text-sm font-semibold text-brand-700">+ Add new company</summary>
          <form action={saveCompany} className="grid gap-4 border-t border-slate-100 p-5 md:grid-cols-3">
            <Field label="Company name">
              <Input name="name" required placeholder="e.g. Sunrise Foods LLC" autoFocus={!!sp.new} />
            </Field>
            <Field label="Legal name" hint="Optional">
              <Input name="legal_name" />
            </Field>
            <Field label="Notes" hint="Optional">
              <Input name="notes" />
            </Field>
            <div className="md:col-span-3">
              <SubmitButton pendingText="Creating…">Create company</SubmitButton>
            </div>
          </form>
        </details>
      </Card>

      <div className="space-y-3">
        {scope.companies.map((c) => {
          const siteCount = sites.filter((s) => s.company_id === c.id && s.active).length;
          const openCount = open.filter((w) => w.company_id === c.id).length;
          return (
            <Card key={c.id} className={c.active ? "" : "opacity-60"}>
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c.name}</p>
                    {c.legal_name && <p className="text-xs text-slate-500">{c.legal_name}</p>}
                  </div>
                  {scope.companyId === c.id && <Badge tone="info">Selected</Badge>}
                  {!c.active && <Badge tone="muted">Inactive</Badge>}
                  <span className="text-xs text-slate-500">
                    {siteCount} location{siteCount === 1 ? "" : "s"} · {openCount} open work order{openCount === 1 ? "" : "s"}
                  </span>
                  <span className="text-xs font-medium text-brand-700">Edit</span>
                </summary>
                <form action={saveCompany} className="grid gap-4 border-t border-slate-100 p-5 md:grid-cols-3">
                  <input type="hidden" name="id" value={c.id} />
                  <Field label="Company name">
                    <Input name="name" required defaultValue={c.name} />
                  </Field>
                  <Field label="Legal name">
                    <Input name="legal_name" defaultValue={c.legal_name ?? ""} />
                  </Field>
                  <Field label="Notes" className="md:row-span-2">
                    <Textarea name="notes" defaultValue={c.notes ?? ""} />
                  </Field>
                  <label className="flex items-center gap-2 text-sm md:col-span-2">
                    <input type="checkbox" name="active" defaultChecked={c.active} className="rounded border-slate-300" />
                    Active (shown in the company dropdown)
                  </label>
                  <div className="md:col-span-3">
                    <SubmitButton size="sm">Save company</SubmitButton>
                  </div>
                </form>
              </details>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        To move a location to another company, open the site and change its company. Its work orders, assets, PM schedules and compliance items move with it.
      </p>
    </>
  );
}
