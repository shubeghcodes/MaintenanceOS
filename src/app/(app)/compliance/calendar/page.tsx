import Link from "next/link";
import { ChevronLeft, ChevronRight, Send } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { DISPATCH_LABEL } from "@/lib/constants";
import { addDaysISO, todayISO, weekStartISO } from "@/lib/format";
import type { DispatchStatus } from "@/lib/types";
import { Alert, Button, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { ComplianceTabs } from "../ComplianceTabs";
import { runComplianceEmails } from "../actions";
import { ComplianceCalendar, type CalDone, type CalItem, type CalVendor } from "./ComplianceCalendar";

export const metadata = { title: "Compliance calendar" };
export const dynamic = "force-dynamic";

export default async function ComplianceCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  const today = todayISO();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);
  const first = `${month}-01`;
  const nextMonth = (() => {
    const [y, m] = month.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  })();
  const prevMonth = (() => {
    const [y, m] = month.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const gridStart = weekStartISO(first);
  const lastOfMonth = addDaysISO(`${nextMonth}-01`, -1);
  const gridEnd = addDaysISO(weekStartISO(lastOfMonth), 6);
  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let d = gridStart; d <= gridEnd; d = addDaysISO(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDaysISO(d, i)).map((x) => ({ date: x, inMonth: x.startsWith(month) })));
  }

  const { sites } = await getLookups(supabase);
  let rq = supabase
    .from("compliance_requirements")
    .select("id,name,category,next_due_on,scheduled_for,vendor_id,site_id,site:sites(code,name),vendor:vendors(name,email)")
    .eq("active", true);
  if (sp.site) rq = rq.eq("site_id", sp.site);
  if (sp.category) rq = rq.eq("category", sp.category);
  let dq = supabase
    .from("compliance_records")
    .select("id,requirement_id,completed_on,result,certificate_number,req:compliance_requirements!inner(name,site_id,category,site:sites(code,name))")
    .gte("completed_on", gridStart)
    .lte("completed_on", gridEnd);
  if (sp.site) dq = dq.eq("req.site_id", sp.site);
  if (sp.category) dq = dq.eq("req.category", sp.category);

  const [{ data: reqData }, { data: doneData }, { data: woData }, { data: vData }] = await Promise.all([
    rq,
    dq,
    supabase
      .from("work_orders")
      .select("id,compliance_requirement_id,dispatches:vendor_dispatches(status,created_at)")
      .eq("type", "compliance")
      .not("status", "in", "(completed,cancelled)"),
    supabase.from("vendors").select("id,name,email,trades").eq("active", true).order("name"),
  ]);

  type Req = { id: string; name: string; category: string; next_due_on: string; scheduled_for: string | null; vendor_id: string | null; site: { code: string | null; name: string } | null; vendor: { name: string; email: string | null } | null };
  const openWo = new Map<string, { id: string; dispatch: string | null }>();
  for (const w of (woData ?? []) as unknown as { id: string; compliance_requirement_id: string; dispatches: { status: DispatchStatus; created_at: string }[] }[]) {
    const latest = [...(w.dispatches ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    openWo.set(w.compliance_requirement_id, { id: w.id, dispatch: latest ? DISPATCH_LABEL[latest.status] : null });
  }
  const items: CalItem[] = ((reqData ?? []) as unknown as Req[]).map((r) => ({
    id: r.id,
    name: r.name,
    site: r.site?.code ?? r.site?.name ?? "",
    category: r.category,
    next_due_on: r.next_due_on,
    scheduled_for: r.scheduled_for,
    vendor_id: r.vendor_id,
    vendor_name: r.vendor?.name ?? null,
    vendor_email: r.vendor?.email ?? null,
    dispatch: openWo.get(r.id)?.dispatch ?? null,
    wo_id: openWo.get(r.id)?.id ?? null,
  }));
  const done: CalDone[] = ((doneData ?? []) as unknown as { id: string; requirement_id: string; completed_on: string; result: string; certificate_number: string | null; req: { name: string; site: { code: string | null; name: string } | null } }[]).map((d) => ({
    id: d.id,
    requirement_id: d.requirement_id,
    name: d.req.name,
    site: d.req.site?.code ?? d.req.site?.name ?? "",
    date: d.completed_on,
    result: d.result,
    certificate_number: d.certificate_number,
  }));
  const categories = [...new Set(items.map((i) => i.category))].sort();
  const monthLabel = new Date(first + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const qs = (m: string) => `/compliance/calendar?month=${m}${sp.site ? `&site=${sp.site}` : ""}${sp.category ? `&category=${encodeURIComponent(sp.category)}` : ""}`;
  const isAdmin = profile.role === "admin";

  return (
    <>
      <PageHeader
        title="Compliance"
        subtitle="Schedule upcoming inspections and services. Vendors are emailed a secure work order link automatically."
        actions={
          isAdmin && (
            <form action={runComplianceEmails}>
              <input type="hidden" name="back" value={qs(month)} />
              <SubmitButton variant="secondary" pendingText="Sending…">
                <Send className="h-4 w-4" aria-hidden /> Email due items to vendors now
              </SubmitButton>
            </form>
          )
        }
      />
      <ComplianceTabs active="calendar" site={sp.site} />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.notice && <Alert tone="good">{sp.notice}</Alert>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg bg-white ring-1 ring-slate-300">
          <Link href={qs(prevMonth)} className="px-2 py-2 text-slate-600 hover:bg-slate-50" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link href={qs(today.slice(0, 7))} className="border-x border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
            Today
          </Link>
          <Link href={qs(nextMonth)} className="px-2 py-2 text-slate-600 hover:bg-slate-50" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <h2 className="mr-auto text-lg font-semibold text-slate-900">{monthLabel}</h2>
        <form className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="month" value={month} />
          <Select name="site" defaultValue={sp.site ?? ""} className="w-auto py-1.5">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ?? s.name}
              </option>
            ))}
          </Select>
          <Select name="category" defaultValue={sp.category ?? ""} className="w-auto py-1.5">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" type="submit">
            Filter
          </Button>
        </form>
      </div>

      <ComplianceCalendar
        weeks={weeks}
        month={month}
        today={today}
        items={items}
        done={done}
        vendors={(vData ?? []) as CalVendor[]}
        canEdit={isAdmin}
        backUrl={qs(month)}
      />
    </>
  );
}
