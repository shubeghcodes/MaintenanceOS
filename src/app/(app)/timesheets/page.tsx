import Link from "next/link";
import { ChevronLeft, ChevronRight, MapPin, Pencil } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getReceiptsToReview } from "@/lib/company";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import { addDaysISO, dayLabel, fmtDate, isISODate, personName, toDateInput, todayISO, weekStartISO } from "@/lib/format";
import { fmtClockTime, fmtHours, toTimeInput, zonedDateTimeISO } from "@/lib/labor";
import { Alert, Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Stat, Table, Td, Th, btnClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { editShift } from "./actions";

export const metadata = { title: "Timesheets" };
export const dynamic = "force-dynamic";

type Wo = { id: string; number: number; title: string; site: { name: string; code: string | null } | null } | null;
type Shift = {
  id: string;
  user_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  start_reason: string | null;
  end_reason: string | null;
  in_lat: number | null;
  in_lng: number | null;
  in_accuracy: number | null;
  out_lat: number | null;
  out_lng: number | null;
  out_accuracy: number | null;
  edited: boolean;
  first: Wo;
  last: Wo;
};

const mapUrl = (lat: number | null, lng: number | null) => (lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null);
const woLabel = (w: Wo) => (w ? `#${w.number}${w.site ? ` · ${w.site.code ?? w.site.name}` : ""}` : null);

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin");
  const today = todayISO();
  const week = weekStartISO(isISODate(sp.week) ? sp.week : today);
  const weekEnd = addDaysISO(week, 6);
  const fromTs = zonedDateTimeISO(week, "00:00");
  const toTs = zonedDateTimeISO(addDaysISO(week, 7), "00:00");

  const [{ data: techData }, { data: shiftData }, receiptsToReview] = await Promise.all([
    supabase.from("profiles").select("id,full_name,email").eq("role", "tech").eq("active", true).order("full_name"),
    supabase
      .from("tech_shifts")
      .select(
        "*, first:work_orders!tech_shifts_first_work_order_id_fkey(id,number,title,site:sites(name,code)), last:work_orders!tech_shifts_last_work_order_id_fkey(id,number,title,site:sites(name,code))",
      )
      .or(`and(clock_in_at.gte.${fromTs},clock_in_at.lt.${toTs}),clock_out_at.is.null`)
      .order("clock_in_at"),
    getReceiptsToReview(),
  ]);
  const techs = (techData ?? []) as { id: string; full_name: string | null; email: string | null }[];
  const shifts = ((shiftData ?? []) as unknown as Shift[]).filter((s) => !sp.tech || s.user_id === sp.tech);

  // Job time inside each shift (from the work order timers), for the "on jobs" share.
  const userIds = [...new Set(shifts.map((s) => s.user_id))];
  const earliest = shifts.reduce((m, s) => (s.clock_in_at < m ? s.clock_in_at : m), fromTs);
  const { data: entryData } = userIds.length
    ? await supabase.from("time_entries").select("user_id,started_at,worked_seconds,status,last_resumed_at").in("user_id", userIds).gte("started_at", earliest).neq("status", "void")
    : { data: [] };
  const entries = (entryData ?? []) as { user_id: string; started_at: string; worked_seconds: number; status: string; last_resumed_at: string | null }[];
  const now = Date.now();
  const rows = shifts.map((s) => {
    const end = s.clock_out_at ? new Date(s.clock_out_at).getTime() : now;
    const hours = (end - new Date(s.clock_in_at).getTime()) / 3_600_000;
    const job =
      entries
        .filter((e) => e.user_id === s.user_id && new Date(e.started_at).getTime() >= new Date(s.clock_in_at).getTime() && new Date(e.started_at).getTime() < end)
        .reduce((t, e) => t + e.worked_seconds + (e.status === "running" && e.last_resumed_at ? (now - new Date(e.last_resumed_at).getTime()) / 1000 : 0), 0) / 3600;
    const day = toDateInput(s.clock_in_at);
    return { ...s, day, hours, job, missing: !s.clock_out_at && day < today, live: !s.clock_out_at && day === today };
  });

  const byTech = techs
    .filter((t) => !sp.tech || t.id === sp.tech)
    .map((t) => ({ tech: t, rows: rows.filter((r) => r.user_id === t.id) }))
    .filter((g) => g.rows.length || !sp.tech);
  const total = rows.filter((r) => r.day >= week && r.day <= weekEnd);
  const totHours = total.reduce((t, r) => t + r.hours, 0);
  const totJob = total.reduce((t, r) => t + r.job, 0);
  const missing = rows.filter((r) => r.missing).length;
  const q = (w: string) => `/timesheets?week=${w}${sp.tech ? `&tech=${sp.tech}` : ""}`;
  const back = q(week);

  return (
    <>
      <PageHeader title="Analytics" subtitle="Technician clock in / clock out" />
      <AnalyticsTabs active="timesheets" reviewCount={receiptsToReview} />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.saved && <Alert tone="good">Clock times updated. The change and reason are kept in the shift&apos;s history.</Alert>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={q(addDaysISO(week, -7))} className={btnClass("secondary", "sm")} aria-label="Previous week">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
        <span className="min-w-48 text-center text-sm font-semibold">
          {fmtDate(week)} – {fmtDate(weekEnd)}
        </span>
        <Link href={q(addDaysISO(week, 7))} className={btnClass("secondary", "sm")} aria-label="Next week">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
        {week !== weekStartISO(today) && (
          <Link href={q(today)} className="text-xs font-medium text-brand-700">
            This week
          </Link>
        )}
        <form className="ml-auto flex items-center gap-2">
          <input type="hidden" name="week" value={week} />
          <Select name="tech" defaultValue={sp.tech ?? ""} className="w-auto">
            <option value="">All technicians</option>
            {techs.map((t) => (
              <option key={t.id} value={t.id}>
                {personName(t)}
              </option>
            ))}
          </Select>
          <button className={btnClass("secondary", "sm")}>Show</button>
        </form>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Clocked hours" value={fmtHours(totHours)} sub={`${total.length} shift${total.length === 1 ? "" : "s"} this week`} />
        <Stat label="Hours on jobs" value={fmtHours(totJob)} sub="From work order timers" />
        <Stat
          label="On jobs"
          value={totHours > 0 ? `${Math.round((totJob / totHours) * 100)}%` : "—"}
          sub="Rest is drive, shop and parts time"
        />
        <Stat label="Missing clock-outs" value={missing} sub={missing ? "Fix them below" : "None"} tone={missing ? "critical" : "good"} />
      </div>

      {byTech.length === 0 ? (
        <Card>
          <EmptyState title="No technicians yet." />
        </Card>
      ) : (
        <div className="space-y-6">
          {byTech.map(({ tech, rows: rs }) => {
            const h = rs.filter((r) => r.day >= week).reduce((t, r) => t + r.hours, 0);
            const j = rs.filter((r) => r.day >= week).reduce((t, r) => t + r.job, 0);
            return (
              <Card key={tech.id}>
                <CardHeader
                  title={personName(tech)}
                  subtitle={rs.length ? `${fmtHours(h)} h clocked · ${fmtHours(j)} h on jobs${h > 0 ? ` (${Math.round((j / h) * 100)}%)` : ""}` : "No shifts this week"}
                  action={
                    <Link href={`/my-day?tech=${tech.id}`} className="text-xs font-medium text-brand-700">
                      My day
                    </Link>
                  }
                />
                {rs.length > 0 && (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Day</Th>
                        <Th>Clock in</Th>
                        <Th>Clock out</Th>
                        <Th className="text-right">Hours</Th>
                        <Th className="text-right">On jobs</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rs.map((r) => (
                        <tr key={r.id} className={r.missing ? "bg-red-50/60" : undefined}>
                          <Td className="whitespace-nowrap font-medium text-slate-900">
                            {dayLabel(r.day)}
                            {r.edited && (
                              <span className="ml-2">
                                <Badge tone="muted" dot={false}>
                                  Edited
                                </Badge>
                              </span>
                            )}
                          </Td>
                          <Td>
                            <p className="tabular-nums">{fmtClockTime(r.clock_in_at)}</p>
                            <PunchDetail wo={r.first} reason={r.start_reason} map={mapUrl(r.in_lat, r.in_lng)} accuracy={r.in_accuracy} />
                          </Td>
                          <Td>
                            {r.clock_out_at ? (
                              <>
                                <p className="tabular-nums">
                                  {toDateInput(r.clock_out_at) !== r.day && `${fmtDate(toDateInput(r.clock_out_at))} `}
                                  {fmtClockTime(r.clock_out_at)}
                                </p>
                                <PunchDetail wo={r.last} reason={r.end_reason} map={mapUrl(r.out_lat, r.out_lng)} accuracy={r.out_accuracy} />
                              </>
                            ) : r.missing ? (
                              <Badge tone="critical">Missing clock-out</Badge>
                            ) : (
                              <Badge tone="good">Clocked in now</Badge>
                            )}
                          </Td>
                          <Td className="text-right tabular-nums">{r.missing ? "—" : fmtHours(r.hours)}</Td>
                          <Td className="text-right tabular-nums">
                            {fmtHours(r.job)}
                            {!r.missing && r.hours > 0 && <span className="block text-xs text-slate-500">{Math.round((r.job / r.hours) * 100)}%</span>}
                          </Td>
                          <Td className="text-right">
                            <details className="group relative inline-block text-left">
                              <summary className={`${btnClass(r.missing ? "primary" : "ghost", "sm")} cursor-pointer list-none`}>
                                <Pencil className="h-3.5 w-3.5" aria-hidden /> {r.missing ? "Fix" : "Edit"}
                              </summary>
                              <form action={editShift} className="absolute right-0 z-10 mt-1 w-72 space-y-2 rounded-lg bg-white p-3 shadow-lg ring-1 ring-slate-200">
                                <input type="hidden" name="shift_id" value={r.id} />
                                <input type="hidden" name="back" value={back} />
                                <div className="grid grid-cols-2 gap-2">
                                  <Field label="In date">
                                    <Input type="date" name="in_date" defaultValue={r.day} required />
                                  </Field>
                                  <Field label="In time">
                                    <Input type="time" name="in_time" defaultValue={toTimeInput(r.clock_in_at)} required />
                                  </Field>
                                  <Field label="Out date">
                                    <Input type="date" name="out_date" defaultValue={r.clock_out_at ? toDateInput(r.clock_out_at) : r.day} />
                                  </Field>
                                  <Field label="Out time">
                                    <Input type="time" name="out_time" defaultValue={r.clock_out_at ? toTimeInput(r.clock_out_at) : ""} />
                                  </Field>
                                </div>
                                <Field label="Reason">
                                  <Input name="reason" placeholder="e.g. Forgot to clock out; left 4:45" required />
                                </Field>
                                <SubmitButton size="sm">Save</SubmitButton>
                              </form>
                            </details>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500">
        Attendance only: hours aren&apos;t used for payroll. Locations are recorded only at clock in and clock out, when the phone allows it.
      </p>
    </>
  );
}

function PunchDetail({ wo, reason, map, accuracy }: { wo: Wo; reason: string | null; map: string | null; accuracy: number | null }) {
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
      {wo ? (
        <Link href={`/work-orders/${wo.id}`} className="text-brand-700 hover:underline" title={wo.title}>
          {woLabel(wo)}
        </Link>
      ) : (
        <span>{reason ?? "No work order"}</span>
      )}
      {map ? (
        <a href={map} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-slate-800" title={accuracy ? `Within about ${Math.round(accuracy)} m` : undefined}>
          <MapPin className="h-3 w-3" aria-hidden /> Map
        </a>
      ) : (
        <span className="text-slate-400">No location</span>
      )}
    </p>
  );
}
