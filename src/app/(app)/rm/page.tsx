import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getCompanyScope, getReceiptsToReview, inCompany } from "@/lib/company";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import { fmtDate, fmtMoney } from "@/lib/format";
import { fmtHours, loadRmLines, RM_CATEGORY_LABEL, type RmLine } from "@/lib/labor";
import { MONTHS, PERIODS, resolvePeriod } from "@/lib/periods";
import { STATUS_LABEL } from "@/lib/constants";
import type { WoStatus } from "@/lib/types";
import { Alert, Card, CardHeader, Field, Input, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "R&M spending" };
export const dynamic = "force-dynamic";

type Bucket = { laborHours: number; labor: number; parts: number; vendor: number; total: number };
const empty = (): Bucket => ({ laborHours: 0, labor: 0, parts: 0, vendor: 0, total: 0 });
function add(b: Bucket, l: RmLine) {
  if (l.category === "labor") {
    b.labor += l.amount;
    b.laborHours += Number(l.hours ?? 0);
  } else if (l.category === "parts") b.parts += l.amount;
  else b.vendor += l.amount;
  b.total += l.amount;
}
function group(lines: RmLine[], key: (l: RmLine) => string | null) {
  const m = new Map<string, Bucket>();
  for (const l of lines) {
    const k = key(l);
    if (!k) continue;
    if (!m.has(k)) m.set(k, empty());
    add(m.get(k)!, l);
  }
  return m;
}

export default async function RmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin");
  const scope = await getCompanyScope();
  const cid = scope.companyId;
  const period = resolvePeriod(sp.period, sp.from, sp.to);
  const year = Number(period.to.slice(0, 4));

  const [{ data: siteData }, lines, yearLines] = await Promise.all([
    inCompany(supabase.from("sites").select("id,name,code,company_id"), cid).order("name"),
    loadRmLines(supabase, { from: period.from, to: period.to, companyId: cid, siteId: sp.site || null }),
    loadRmLines(supabase, { from: `${year}-01-01`, to: `${year}-12-31`, companyId: cid, siteId: sp.site || null }),
  ]);
  const sites = (siteData ?? []) as { id: string; name: string; code: string | null; company_id: string }[];
  const siteName = new Map(sites.map((s) => [s.id, s.code ? `${s.code} · ${s.name}` : s.name]));
  const companyName = new Map(scope.companies.map((c) => [c.id, c.name]));

  const total = empty();
  lines.forEach((l) => add(total, l));
  const bySite = [...group(lines, (l) => l.site_id)].sort((a, b) => b[1].total - a[1].total);
  const byCompany = [...group(lines, (l) => l.company_id)].sort((a, b) => b[1].total - a[1].total);
  const byWo = [...group(lines, (l) => l.work_order_id)].sort((a, b) => b[1].total - a[1].total);
  const topWo = byWo.slice(0, 100);
  const { data: woData } = topWo.length
    ? await supabase.from("work_orders").select("id,number,title,status,site_id").in("id", topWo.map(([id]) => id))
    : { data: [] };
  const woInfo = new Map(((woData ?? []) as { id: string; number: number; title: string; status: WoStatus; site_id: string }[]).map((w) => [w.id, w]));

  // Monthly / quarterly / annual for the year of the period end.
  const byMonth = group(yearLines, (l) => l.spent_on.slice(5, 7));
  const yearTotal = empty();
  yearLines.forEach((l) => add(yearTotal, l));

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.period) p.set("period", sp.period);
    if (sp.from) p.set("from", sp.from);
    if (sp.to) p.set("to", sp.to);
    if (sp.site) p.set("site", sp.site);
    Object.entries(extra).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    return `/rm?${p.toString()}`;
  };
  const pct = (v: number) => (total.total ? Math.round((v / total.total) * 100) : 0);

  return (
    <>
      <PageHeader
        title="R&M spending"
        subtitle={`${scope.company?.name ?? "All companies"}${sp.site ? ` · ${siteName.get(sp.site) ?? ""}` : ""} · ${fmtDate(period.from)} – ${fmtDate(period.to)}`}
      />

      <AnalyticsTabs active="rm" reviewCount={await getReceiptsToReview()} />
      <form className="mb-5 flex flex-wrap items-end gap-3" action="/rm">
        <Field label="Period">
          <Select name="period" defaultValue={period.key}>
            {PERIODS.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" hint="Custom only">
          <Input type="date" name="from" defaultValue={period.from} />
        </Field>
        <Field label="To">
          <Input type="date" name="to" defaultValue={period.to} />
        </Field>
        <Field label="Location">
          <Select name="site" defaultValue={sp.site ?? ""}>
            <option value="">All locations</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {siteName.get(s.id)}
              </option>
            ))}
          </Select>
        </Field>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Show</button>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Internal labor" value={fmtMoney(total.labor)} sub={`${fmtHours(total.laborHours)} hrs · ${pct(total.labor)}% of R&M`} href="/labor" />
        <Stat label="Parts & materials" value={fmtMoney(total.parts)} sub={`Receipts + other parts · ${pct(total.parts)}%`} />
        <Stat label="Outside vendors" value={fmtMoney(total.vendor)} sub={`Vendor invoices · ${pct(total.vendor)}%`} href="/vendor-jobs" />
        <Stat label="Total R&M" value={fmtMoney(total.total)} sub="Including internal labor" />
      </div>

      {total.total > 0 && (
        <div className="mb-6 flex h-3 overflow-hidden rounded-full bg-slate-100" title="Labor · Parts · Vendor">
          <div className="bg-brand-600" style={{ width: `${pct(total.labor)}%` }} />
          <div className="bg-amber-400" style={{ width: `${pct(total.parts)}%` }} />
          <div className="bg-slate-500" style={{ width: `${pct(total.vendor)}%` }} />
        </div>
      )}
      {total.total === 0 && <Alert tone="info">No R&M costs in this period{cid ? " for this company" : ""}.</Alert>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="By location" subtitle={`${bySite.length} location${bySite.length === 1 ? "" : "s"} with spend`} />
          <BucketTable
            rows={bySite.map(([id, b]) => ({ id, label: siteName.get(id) ?? "Other location", href: qs({ site: id }), b }))}
            total={total}
          />
        </Card>
        {!cid && scope.companies.length > 1 ? (
          <Card>
            <CardHeader title="By company" />
            <BucketTable rows={byCompany.map(([id, b]) => ({ id, label: companyName.get(id) ?? "—", b }))} total={total} />
          </Card>
        ) : (
          <Card>
            <CardHeader title={`${year} by month`} subtitle="Monthly, quarterly and annual" />
            <MonthTable byMonth={byMonth} yearTotal={yearTotal} />
          </Card>
        )}
      </div>

      {!cid && scope.companies.length > 1 && (
        <Card className="mt-6">
          <CardHeader title={`${year} by month`} subtitle="Monthly, quarterly and annual" />
          <MonthTable byMonth={byMonth} yearTotal={yearTotal} />
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="By work order" subtitle={byWo.length > 100 ? `Top 100 of ${byWo.length} by total` : `${byWo.length} work order${byWo.length === 1 ? "" : "s"}`} />
        <Table>
          <thead>
            <tr>
              <Th>Work order</Th>
              <Th>Location</Th>
              <Th className="text-right">Labor hrs</Th>
              <Th className="text-right">Labor</Th>
              <Th className="text-right">Parts</Th>
              <Th className="text-right">Vendor</Th>
              <Th className="text-right">Total</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {topWo.map(([id, b]) => {
              const w = woInfo.get(id);
              return (
                <tr key={id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/work-orders/${id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      #{w?.number} {w?.title}
                    </Link>
                    {w && <span className="ml-2 text-xs text-slate-500">{STATUS_LABEL[w.status]}</span>}
                  </Td>
                  <Td className="text-xs text-slate-600">{w ? siteName.get(w.site_id) : ""}</Td>
                  <Td className="text-right tabular-nums">{b.laborHours ? fmtHours(b.laborHours) : "—"}</Td>
                  <Td className="text-right tabular-nums">{b.labor ? fmtMoney(b.labor, 2) : "—"}</Td>
                  <Td className="text-right tabular-nums">{b.parts ? fmtMoney(b.parts, 2) : "—"}</Td>
                  <Td className="text-right tabular-nums">{b.vendor ? fmtMoney(b.vendor, 2) : "—"}</Td>
                  <Td className="text-right font-medium tabular-nums">{fmtMoney(b.total, 2)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <p className="mt-4 text-xs text-slate-500">
        {RM_CATEGORY_LABEL.labor} is counted on the day the time was worked, receipts on their purchase date, and other parts and vendor invoices when the work order
        is completed. Labor is costed at each technician&apos;s rate in effect that day.
      </p>
    </>
  );
}

function BucketTable({ rows, total }: { rows: { id: string; label: string; href?: string; b: Bucket }[]; total: Bucket }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th></Th>
          <Th className="text-right">Labor</Th>
          <Th className="text-right">Parts</Th>
          <Th className="text-right">Vendor</Th>
          <Th className="text-right">Total</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50">
            <Td className="font-medium">
              {r.href ? (
                <Link href={r.href} className="hover:text-brand-700">
                  {r.label}
                </Link>
              ) : (
                r.label
              )}
              {r.b.laborHours > 0 && <span className="block text-xs font-normal text-slate-500">{fmtHours(r.b.laborHours)} labor hrs</span>}
            </Td>
            <Td className="text-right tabular-nums">{fmtMoney(r.b.labor)}</Td>
            <Td className="text-right tabular-nums">{fmtMoney(r.b.parts)}</Td>
            <Td className="text-right tabular-nums">{fmtMoney(r.b.vendor)}</Td>
            <Td className="text-right font-medium tabular-nums">{fmtMoney(r.b.total)}</Td>
          </tr>
        ))}
        <tr className="bg-slate-50 font-semibold">
          <Td>Total</Td>
          <Td className="text-right tabular-nums">{fmtMoney(total.labor)}</Td>
          <Td className="text-right tabular-nums">{fmtMoney(total.parts)}</Td>
          <Td className="text-right tabular-nums">{fmtMoney(total.vendor)}</Td>
          <Td className="text-right tabular-nums">{fmtMoney(total.total)}</Td>
        </tr>
      </tbody>
    </Table>
  );
}

function MonthTable({ byMonth, yearTotal }: { byMonth: Map<string, Bucket>; yearTotal: Bucket }) {
  const row = (label: string, b: Bucket, strong?: boolean) => (
    <tr key={label} className={strong ? "bg-slate-50 font-semibold" : "hover:bg-slate-50"}>
      <Td className={strong ? "" : "pl-8"}>{label}</Td>
      <Td className="text-right tabular-nums">{b.laborHours ? fmtHours(b.laborHours) : "—"}</Td>
      <Td className="text-right tabular-nums">{fmtMoney(b.labor)}</Td>
      <Td className="text-right tabular-nums">{fmtMoney(b.parts)}</Td>
      <Td className="text-right tabular-nums">{fmtMoney(b.vendor)}</Td>
      <Td className="text-right tabular-nums">{fmtMoney(b.total)}</Td>
    </tr>
  );
  const out: React.ReactNode[] = [];
  for (let q = 0; q < 4; q++) {
    const qb = empty();
    for (let m = q * 3; m < q * 3 + 3; m++) {
      const b = byMonth.get(String(m + 1).padStart(2, "0")) ?? empty();
      qb.laborHours += b.laborHours;
      qb.labor += b.labor;
      qb.parts += b.parts;
      qb.vendor += b.vendor;
      qb.total += b.total;
      out.push(row(MONTHS[m], b));
    }
    out.push(row(`Q${q + 1}`, qb, true));
  }
  out.push(row("Year", yearTotal, true));
  return (
    <Table>
      <thead>
        <tr>
          <Th></Th>
          <Th className="text-right">Labor hrs</Th>
          <Th className="text-right">Labor</Th>
          <Th className="text-right">Parts</Th>
          <Th className="text-right">Vendor</Th>
          <Th className="text-right">Total</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">{out}</tbody>
    </Table>
  );
}
