import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getCompanyScope, getReceiptsToReview, inCompany } from "@/lib/company";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import { fmtDate, fmtMoney, personName } from "@/lib/format";
import { ENTRY_COLS, fmtClockTime, fmtHours, secondsNow, type EntryCost, type TimeEntry } from "@/lib/labor";
import { PERIODS, resolvePeriod } from "@/lib/periods";
import { zonedDateTimeISO } from "@/lib/labor";
import type { WoStatus } from "@/lib/types";
import { Badge, Card, CardHeader, Field, Input, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { TimerClock } from "@/components/TimerClock";

export const metadata = { title: "Technician labor" };
export const dynamic = "force-dynamic";

type Row = TimeEntry & {
  user: { full_name: string | null; email: string | null } | null;
  wo: { id: string; number: number; title: string; status: WoStatus; site: { name: string; code: string | null } | null } | null;
};

export default async function LaborPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireRole("admin");
  const showRates = !!profile.is_super; // hourly rates are super-admin only
  const scope = await getCompanyScope();
  const cid = scope.companyId;
  const period = resolvePeriod(sp.period ?? "this_month", sp.from, sp.to);
  const fromTs = zonedDateTimeISO(period.from, "00:00");
  const toTs = new Date(new Date(zonedDateTimeISO(period.to, "00:00")).getTime() + 86_400_000).toISOString();

  let q = supabase
    .from("time_entries")
    .select(`${ENTRY_COLS}, user:profiles!time_entries_user_id_fkey(full_name,email), wo:work_orders(id,number,title,status,site:sites(name,code))`)
    .gte("started_at", fromTs)
    .lt("started_at", toTs)
    .neq("status", "void")
    .order("started_at", { ascending: false })
    .limit(5000);
  q = inCompany(q, cid);
  if (sp.tech) q = q.eq("user_id", sp.tech);
  if (sp.site) q = q.eq("site_id", sp.site);

  const [{ data: eData }, { data: techData }, { data: siteData }, { data: runData }] = await Promise.all([
    q,
    supabase.from("profiles").select("id,full_name,email,role,active").in("role", ["tech", "admin"]).order("full_name"),
    inCompany(supabase.from("sites").select("id,name,code"), cid).order("name"),
    inCompany(
      supabase.from("time_entries").select(`${ENTRY_COLS}, user:profiles!time_entries_user_id_fkey(full_name,email), wo:work_orders(id,number,title,status,site:sites(name,code))`).in("status", ["running", "paused"]),
      cid,
    ),
  ]);
  const entries = (eData ?? []) as unknown as Row[];
  const running = (runData ?? []) as unknown as Row[];
  const techs = (techData ?? []) as { id: string; full_name: string | null; email: string | null; role: string; active: boolean }[];
  const sites = (siteData ?? []) as { id: string; name: string; code: string | null }[];

  const ids = entries.map((e) => e.id);
  const costs = new Map<string, EntryCost>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from("time_entry_costs").select("entry_id,hours,hourly_rate,cost_override,labor_cost").in("entry_id", ids.slice(i, i + 300));
    ((data ?? []) as EntryCost[]).forEach((c) => costs.set(c.entry_id, c));
  }
  const now = Date.now();
  const hoursOf = (e: Row) => secondsNow(e, now) / 3600;
  const costOf = (e: Row) => Number(costs.get(e.id)?.labor_cost ?? 0);

  // Per technician
  type Sum = { id: string; name: string; hours: number; cost: number; entries: number; wos: Set<string>; completed: Set<string>; noRate: boolean };
  const byTech = new Map<string, Sum>();
  for (const e of entries) {
    const k = e.user_id ?? "none";
    if (!byTech.has(k)) byTech.set(k, { id: k, name: e.user ? personName(e.user) : "Unassigned", hours: 0, cost: 0, entries: 0, wos: new Set(), completed: new Set(), noRate: false });
    const s = byTech.get(k)!;
    s.hours += hoursOf(e);
    s.cost += costOf(e);
    s.entries += 1;
    s.wos.add(e.work_order_id);
    if (e.wo?.status === "completed") s.completed.add(e.work_order_id);
    const c = costs.get(e.id);
    if (e.worked_seconds > 0 && c && c.hourly_rate == null && c.cost_override == null) s.noRate = true;
  }
  const techRows = [...byTech.values()].sort((a, b) => b.hours - a.hours);
  const totalHours = techRows.reduce((t, s) => t + s.hours, 0);
  const totalCost = techRows.reduce((t, s) => t + s.cost, 0);
  const allWos = new Set(entries.map((e) => e.work_order_id));
  const doneWos = new Set(entries.filter((e) => e.wo?.status === "completed").map((e) => e.work_order_id));

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const k of ["period", "from", "to", "site", "tech"]) if (sp[k]) p.set(k, sp[k]!);
    Object.entries(extra).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    return `/labor?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title="Technician labor" subtitle={`${scope.company?.name ?? "All companies"} · ${fmtDate(period.from)} – ${fmtDate(period.to)}`} />

      <AnalyticsTabs active="labor" reviewCount={await getReceiptsToReview()} />
      <form className="mb-5 flex flex-wrap items-end gap-3" action="/labor">
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
        <Field label="Technician">
          <Select name="tech" defaultValue={sp.tech ?? ""}>
            <option value="">All technicians</option>
            {techs.map((t) => (
              <option key={t.id} value={t.id}>
                {personName(t)}
                {t.active ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Location">
          <Select name="site" defaultValue={sp.site ?? ""}>
            <option value="">All locations</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} · ${s.name}` : s.name}
              </option>
            ))}
          </Select>
        </Field>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Show</button>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Labor hours" value={fmtHours(totalHours)} sub={`${entries.length} time entr${entries.length === 1 ? "y" : "ies"}`} />
        <Stat label="Labor cost" value={fmtMoney(totalCost, 2)} sub={showRates && totalHours ? `${fmtMoney(totalCost / totalHours, 2)}/hr average` : `${fmtHours(totalHours)} hrs`} />
        <Stat label="Work orders worked" value={allWos.size} sub={`${doneWos.size} completed`} />
        <Stat label="Timers open now" value={running.length} sub={running.filter((r) => r.status === "running").length + " running"} tone={running.length ? "warning" : undefined} />
      </div>

      {running.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Timers open now" />
          <ul className="divide-y divide-slate-100">
            {running.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                <span className="w-40 font-medium">{e.user ? personName(e.user) : "—"}</span>
                <Link href={`/work-orders/${e.work_order_id}#time`} className="min-w-0 flex-1 truncate hover:text-brand-700">
                  #{e.wo?.number} {e.wo?.title} <span className="text-xs text-slate-500">· {e.wo?.site?.code ?? e.wo?.site?.name}</span>
                </Link>
                <Badge tone={e.status === "running" ? "good" : "warning"}>{e.status === "running" ? "Running" : "Paused"}</Badge>
                <span className="text-xs text-slate-500">since {fmtClockTime(e.started_at)}</span>
                <TimerClock worked={e.worked_seconds} resumedAt={e.status === "running" ? e.last_resumed_at : null} className="w-20 text-right font-mono tabular-nums" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader title="By technician" subtitle="Click a name for their work history" />
        <Table>
          <thead>
            <tr>
              <Th>Technician</Th>
              <Th className="text-right">Work orders</Th>
              <Th className="text-right">Completed</Th>
              <Th className="text-right">Hours</Th>
              <Th className="text-right">Labor cost</Th>
              {showRates && <Th className="text-right">Avg rate</Th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {techRows.length === 0 && (
              <tr>
                <Td colSpan={6} className="py-6 text-center text-slate-500">
                  No time logged in this period.
                </Td>
              </tr>
            )}
            {techRows.map((s) => (
              <tr key={s.id} className={sp.tech === s.id ? "bg-brand-50" : "hover:bg-slate-50"}>
                <Td className="font-medium">
                  {s.id === "none" ? (
                    s.name
                  ) : (
                    <Link href={qs({ tech: sp.tech === s.id ? "" : s.id })} className="hover:text-brand-700">
                      {s.name}
                    </Link>
                  )}
                  {s.noRate && <span className="ml-2 text-xs font-normal text-orange-700">rate missing</span>}
                </Td>
                <Td className="text-right tabular-nums">{s.wos.size}</Td>
                <Td className="text-right tabular-nums">{s.completed.size}</Td>
                <Td className="text-right tabular-nums">{fmtHours(s.hours)}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(s.cost, 2)}</Td>
                {showRates && <Td className="text-right tabular-nums text-slate-500">{s.hours ? fmtMoney(s.cost / s.hours, 2) : "—"}</Td>}
              </tr>
            ))}
            {techRows.length > 1 && (
              <tr className="bg-slate-50 font-semibold">
                <Td>Total</Td>
                <Td className="text-right tabular-nums">{allWos.size}</Td>
                <Td className="text-right tabular-nums">{doneWos.size}</Td>
                <Td className="text-right tabular-nums">{fmtHours(totalHours)}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(totalCost, 2)}</Td>
                {showRates && <Td />}
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title={sp.tech ? `${techRows[0]?.name ?? "Technician"} — work history` : "Time entries"}
          subtitle={entries.length > 300 ? `Latest 300 of ${entries.length}` : `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}
        />
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              {!sp.tech && <Th>Technician</Th>}
              <Th>Work order</Th>
              <Th>Visit</Th>
              <Th>Time</Th>
              <Th className="text-right">Hours</Th>
              {showRates && <Th className="text-right">Rate</Th>}
              <Th className="text-right">Cost</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.slice(0, 300).map((e) => {
              const c = costs.get(e.id);
              return (
                <tr key={e.id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap">{fmtDate(e.started_at)}</Td>
                  {!sp.tech && <Td className="whitespace-nowrap">{e.user ? personName(e.user) : "—"}</Td>}
                  <Td className="min-w-[14rem]">
                    <Link href={`/work-orders/${e.work_order_id}#time`} className="hover:text-brand-700">
                      #{e.wo?.number} {e.wo?.title}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {e.wo?.site?.code ?? e.wo?.site?.name}
                      {e.wo?.status === "completed" && " · completed"}
                    </span>
                  </Td>
                  <Td className="text-xs">
                    {e.visit > 1 ? `Return ${e.visit}` : "1"}
                    {e.source === "manual" && <span className="ml-1 text-slate-400">manual</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-slate-600">
                    {fmtClockTime(e.started_at)}–{e.ended_at ? fmtClockTime(e.ended_at) : e.status === "running" ? "now" : "paused"}
                  </Td>
                  <Td className="text-right tabular-nums">{fmtHours(hoursOf(e))}</Td>
                  {showRates && <Td className="text-right tabular-nums text-slate-500">{c?.cost_override != null ? "imported" : c?.hourly_rate != null ? fmtMoney(c.hourly_rate, 2) : "—"}</Td>}
                  <Td className="text-right tabular-nums">{fmtMoney(costOf(e), 2)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <p className="mt-4 text-xs text-slate-500">
        Hours are in decimal (1.50 = 1 h 30 m). Running timers count up to now; their cost is added each time they&apos;re paused or stopped.
      </p>
    </>
  );
}
