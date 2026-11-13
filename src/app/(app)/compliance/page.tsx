import { getCompanyScope, inCompany } from "@/lib/company";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { daysUntil, fmtDate, fmtFreq } from "@/lib/format";
import { SITE_TYPE_LABEL } from "@/lib/constants";
import type { ComplianceRequirement } from "@/lib/types";
import { Alert, Button, ButtonLink, Card, CardHeader, EmptyState, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { DueBadge } from "@/components/badges";
import { SubmitButton } from "@/components/SubmitButton";
import { ComplianceTabs } from "./ComplianceTabs";
import { runComplianceEmails } from "./actions";
import { Send } from "lucide-react";
import { applyTemplate } from "./actions";

export const metadata = { title: "Compliance" };

type Row = ComplianceRequirement & { site: { id: string; name: string; code: string | null } | null; vendor: { name: string } | null };

export default async function CompliancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  const { companyId: cid } = await getCompanyScope();
  const { sites } = await getLookups(supabase);
  const isAdmin = profile.role === "admin";

  let q = supabase
    .from("compliance_requirements")
    .select("*, site:sites(id,name,code), vendor:vendors(name)")
    .eq("active", true)
    .order("next_due_on");
  q = inCompany(q, cid);
  if (sp.site) q = q.eq("site_id", sp.site);
  if (sp.category) q = q.eq("category", sp.category);
  const { data } = await q;
  const all = (data ?? []) as unknown as Row[];

  const bucket = (r: Row) => {
    const d = daysUntil(r.next_due_on) ?? 0;
    return d < 0 ? "overdue" : d <= 30 ? "due_soon" : "current";
  };
  const counts = { overdue: 0, due_soon: 0, current: 0 };
  all.forEach((r) => counts[bucket(r)]++);
  const rows = sp.status ? all.filter((r) => bucket(r) === sp.status) : all;
  const rate = all.length ? Math.round(((all.length - counts.overdue) / all.length) * 100) : null;
  const categories = [...new Set(all.map((r) => r.category))].sort();

  return (
    <>
      <PageHeader
        title="Compliance"
        subtitle="Inspections, certifications, permits and required services for every site."
        actions={
          isAdmin && (
            <>
              <form action={runComplianceEmails}>
                <input type="hidden" name="back" value="/compliance" />
                <SubmitButton variant="secondary" pendingText="Sending…">
                  <Send className="h-4 w-4" aria-hidden /> Email due items to vendors
                </SubmitButton>
              </form>
              <ButtonLink href={`/compliance/new${sp.site ? `?site=${sp.site}` : ""}`}>
                <Plus className="h-4 w-4" aria-hidden /> Add requirement
              </ButtonLink>
            </>
          )
        }
      />
      <ComplianceTabs active="list" site={sp.site} />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.notice && <Alert tone="good">{sp.notice}</Alert>}
      {sp.added && (
        <Alert tone="good">
          Added {sp.added} standard item{sp.added === "1" ? "" : "s"}. Each is set due in 30 days — open each one and set the real date from the last
          certificate.
        </Alert>
      )}
      {sp.generated && <Alert tone="good">Scheduler ran — {sp.generated} work order(s) created.</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Compliant" value={rate == null ? "—" : `${rate}%`} sub={`${all.length - counts.overdue} of ${all.length} items current`} tone={rate == null ? undefined : rate === 100 ? "good" : rate >= 90 ? "warning" : "critical"} />
        <Stat label="Overdue" value={counts.overdue} tone={counts.overdue ? "critical" : "good"} sub="Past due date" href={`/compliance?status=overdue${sp.site ? `&site=${sp.site}` : ""}`} />
        <Stat label="Due in 30 days" value={counts.due_soon} tone={counts.due_soon ? "warning" : "good"} sub="Schedule vendors now" href={`/compliance?status=due_soon${sp.site ? `&site=${sp.site}` : ""}`} />
        <Stat label="Current" value={counts.current} tone="good" sub="More than 30 days out" href={`/compliance?status=current${sp.site ? `&site=${sp.site}` : ""}`} />
      </div>

      <Card className="mb-4 p-3">
        <form className="flex flex-wrap gap-2">
          <Select name="site" defaultValue={sp.site ?? ""} className="w-auto">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ?? s.name}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={sp.status ?? ""} className="w-auto">
            <option value="">Any status</option>
            <option value="overdue">Overdue</option>
            <option value="due_soon">Due in 30 days</option>
            <option value="current">Current</option>
          </Select>
          <Select name="category" defaultValue={sp.category ?? ""} className="w-auto">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Button variant="secondary" type="submit">
            Filter
          </Button>
        </form>
      </Card>

      <Card className="mb-6">
        {rows.length === 0 ? (
          <EmptyState title="No compliance items match.">{isAdmin && "Use “Add standard checklist” below to start a site from a template."}</EmptyState>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Requirement</Th>
                <Th>Site</Th>
                <Th>Frequency</Th>
                <Th>Last done</Th>
                <Th>Next due</Th>
                <Th>Status</Th>
                <Th>Scheduled</Th>
                <Th>Vendor</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/compliance/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {r.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {r.category}
                      {r.authority && ` · ${r.authority}`}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{r.site?.code ?? r.site?.name}</Td>
                  <Td className="whitespace-nowrap">{fmtFreq(r.frequency_interval, r.frequency_unit)}</Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(r.last_completed_on)}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(r.next_due_on)}</Td>
                  <Td>
                    <DueBadge date={r.next_due_on} />
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {r.scheduled_for ? <span className="font-medium text-blue-800">{fmtDate(r.scheduled_for)}</span> : <Link href={`/compliance/calendar?month=${r.next_due_on.slice(0, 7)}`} className="text-slate-400 hover:text-brand-700">Not scheduled</Link>}
                  </Td>
                  <Td className="text-xs">
                    {r.vendor?.name ?? "—"}
                    {r.vendor && !r.auto_dispatch && <div className="text-slate-400">auto-email off</div>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {isAdmin && sites.length > 0 && (
        <Card>
          <CardHeader title="Add standard checklist" subtitle="Adds common requirements for the site’s type (QSR, dine-in, or commercial RE). Skips items the site already has." />
          <form action={applyTemplate} className="flex flex-wrap items-center gap-2 p-5">
            <Select name="site_id" required defaultValue={sp.site ?? ""} className="w-auto">
              <option value="" disabled>
                Pick a site…
              </option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code ? `${s.code} · ` : ""}
                  {s.name} ({SITE_TYPE_LABEL[s.type]})
                </option>
              ))}
            </Select>
            <SubmitButton variant="secondary" pendingText="Adding…">
              Add checklist
            </SubmitButton>
            <p className="w-full text-xs text-slate-500">Frequencies are common defaults — confirm with your fire marshal, health department, landlord and insurer.</p>
          </form>
        </Card>
      )}
    </>
  );
}
