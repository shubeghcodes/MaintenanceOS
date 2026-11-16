import { getCompanyScope, inCompany } from "@/lib/company";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { WORK_WEEK_START_DAY, WORKABLE_STATUSES } from "@/lib/constants";
import { addDaysISO, dayLabel, isISODate, personName, todayISO, weekStartISO } from "@/lib/format";
import type { WoPriority, WoStatus, WoType } from "@/lib/types";
import { Alert, Button, PageHeader, Select, btnClass } from "@/components/ui";
import { MonthCalendar } from "./MonthCalendar";
import { ScheduleBoard, type BoardJob, type BoardForecast } from "./ScheduleBoard";
import { upcomingDueDates } from "@/lib/pm-forecast";
import { addDays, loadTimeOff, offReason, pmScheduleDate } from "@/lib/time-off";
import { CalendarOff } from "lucide-react";
import type { FreqUnit } from "@/lib/types";

export const metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  number: number;
  title: string;
  priority: WoPriority;
  status: WoStatus;
  type: WoType;
  scheduled_date: string | null;
  scheduled_start: string | null;
  estimated_hours: number | null;
  assigned_tech_id: string | null;
  due_at: string | null;
  site_id: string;
  site: { code: string | null; name: string; address: string | null; city: string | null } | null;
  vendor: { name: string } | null;
};
const SELECT =
  "id,number,title,priority,status,type,scheduled_date,scheduled_start,estimated_hours,assigned_tech_id,due_at,site_id," +
  "site:sites(code,name,address,city), vendor:vendors(name)";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireRole("admin", "tech");
  const { companyId: cid } = await getCompanyScope();
  const today = todayISO();
  const view: "month" | "week" | "day" = sp.view === "day" ? "day" : sp.view === "month" ? "month" : "week";
  const anchor = isISODate(sp.date) ? sp.date : today;
  // Month: whole weeks (Sunday first) covering the 1st through the last day of the anchor's month.
  const monthKey = anchor.slice(0, 7);
  const firstOfMonth = `${monthKey}-01`;
  const lastOfMonth = addDaysISO(shiftMonth(firstOfMonth, 1), -1);
  const start = view === "month" ? weekStartISO(firstOfMonth, 0) : view === "week" ? weekStartISO(anchor, WORK_WEEK_START_DAY) : anchor;
  const span = view === "month" ? (Date.parse(addDaysISO(weekStartISO(lastOfMonth, 0), 7)) - Date.parse(start)) / 86_400_000 : view === "week" ? 7 : 1;
  const days = Array.from({ length: span }, (_, i) => addDaysISO(start, i));
  const end = days[days.length - 1];
  const prevDate = view === "month" ? shiftMonth(firstOfMonth, -1) : addDaysISO(anchor, view === "week" ? -7 : -1);
  const nextDate = view === "month" ? shiftMonth(firstOfMonth, 1) : addDaysISO(anchor, view === "week" ? 7 : 1);

  const [{ data: techData }, { data: schedData }, { data: backlogData }, { data: siteData }, { data: sentData }, { data: pmData }, { data: openPmData }] = await Promise.all([
    supabase.from("profiles").select("id,full_name,email,role").eq("active", true).in("role", ["tech", "admin"]).order("full_name"),
    inCompany(supabase.from("work_orders").select(SELECT).gte("scheduled_date", start).lte("scheduled_date", end).neq("status", "cancelled"), cid),
    view === "month"
      ? Promise.resolve({ data: [] })
      : inCompany(supabase.from("work_orders").select(SELECT).is("scheduled_date", null).in("status", WORKABLE_STATUSES), cid).limit(300),
    inCompany(supabase.from("sites").select("id,code,name").eq("active", true), cid).order("name"),
    profile.role === "admin"
      ? supabase.from("schedule_emails").select("tech_id,schedule_date,sent_at").eq("status", "sent").gte("schedule_date", start).lte("schedule_date", end)
      : Promise.resolve({ data: [] as { tech_id: string; schedule_date: string; sent_at: string }[] }),
    // PM schedules that put their work orders on the calendar: show visits that aren't created yet.
    inCompany(
      supabase
        .from("pm_schedules")
        .select("id,title,next_due_on,lead_days,frequency_interval,frequency_unit,assigned_tech_id,estimated_hours,start_time,site:sites(code,name)")
        .eq("active", true)
        .eq("auto_schedule", true)
        .lte("next_due_on", addDays(end, 61)),
      cid,
    ),
    inCompany(supabase.from("work_orders").select("pm_schedule_id").not("pm_schedule_id", "is", null).not("status", "in", "(completed,cancelled)"), cid),
  ]);

  type PmRow = {
    id: string;
    title: string;
    next_due_on: string;
    lead_days: number;
    frequency_interval: number;
    frequency_unit: FreqUnit;
    assigned_tech_id: string | null;
    estimated_hours: number | null;
    start_time: string | null;
    site: { code: string | null; name: string } | null;
  };
  // Days off: a little beyond the visible days, since a PM due just outside can move in (or out).
  const offInfo = await loadTimeOff(supabase, addDays(start, -31), addDays(end, 61));
  const openPm = new Set(((openPmData ?? []) as { pm_schedule_id: string }[]).map((r) => r.pm_schedule_id));
  let forecast: BoardForecast[] = ((pmData ?? []) as unknown as PmRow[]).flatMap((p) =>
    upcomingDueDates(p, addDays(start, -61), addDays(end, 31), today, openPm.has(p.id))
      // Same rule as the scheduler: land on the tech's nearest working day.
      .map((due) => ({ due, date: pmScheduleDate(offInfo, p.assigned_tech_id, due, today) }))
      .filter(({ date }) => date >= start && date <= end)
      .map(({ due, date }) => ({
      pm_id: p.id,
      due,
      date,
      title: p.title,
      tech_id: p.assigned_tech_id,
      site_code: p.site?.code ?? p.site?.name ?? "",
      start_time: p.start_time,
      estimated_hours: p.estimated_hours,
    })),
  );
  if (sp.tech) forecast = forecast.filter((f) => f.tech_id === sp.tech);

  const scheduled = (schedData ?? []) as unknown as Row[];
  const people = (techData ?? []) as { id: string; full_name: string | null; email: string | null; role: string }[];
  // Rows: every tech, plus admins only if they have work on the calendar this period.
  const busy = new Set([...scheduled.map((r) => r.assigned_tech_id), ...forecast.map((f) => f.tech_id)]);
  let techs = people.filter((p) => p.role === "tech" || busy.has(p.id)).map((p) => ({ id: p.id, name: personName(p) }));
  if (sp.tech) techs = techs.filter((t) => t.id === sp.tech);

  const toJob = (r: Row): BoardJob => ({
    id: r.id,
    number: r.number,
    title: r.title,
    priority: r.priority,
    status: r.status,
    type: r.type,
    scheduled_date: r.scheduled_date,
    scheduled_start: r.scheduled_start,
    estimated_hours: r.estimated_hours,
    assigned_tech_id: r.assigned_tech_id,
    vendor_name: r.vendor?.name ?? null,
    site_id: r.site_id,
    site_code: r.site?.code ?? r.site?.name ?? "",
    site_address: [r.site?.address, r.site?.city].filter(Boolean).join(", ") || null,
    due_at: r.due_at,
  });
  let jobs = [...scheduled, ...((backlogData ?? []) as unknown as Row[])].map(toJob);
  if (sp.tech) jobs = jobs.filter((j) => j.assigned_tech_id === sp.tech || !j.scheduled_date);

  const off: Record<string, string> = {};
  const offByDay: Record<string, string[]> = {};
  for (const t of techs) for (const d of days) {
    const why = offReason(offInfo, t.id, d);
    if (why) {
      off[`${t.id}|${d}`] = why;
      // Month view lists who's off, but not everyone's regular weekend (that would fill every Saturday/Sunday).
      if (view === "month" && (sp.tech || !/regular/i.test(why))) (offByDay[d] ??= []).push(sp.tech ? why : t.name);
    }
  }

  const sent: Record<string, string> = {};
  for (const s of (sentData ?? []) as { tech_id: string; schedule_date: string; sent_at: string }[]) {
    sent[`${s.tech_id}|${s.schedule_date}`] = new Date(s.sent_at).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: process.env.NEXT_PUBLIC_TIMEZONE || "America/Los_Angeles",
    });
  }

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view, date: anchor, tech: sp.tech, ...over };
    Object.entries(merged).forEach(([k, v]) => v && p.set(k, v));
    return `/schedule?${p.toString()}`;
  };
  const dayLabels = Object.fromEntries(days.map((d) => [d, dayLabel(d)]));
  const title =
    view === "month"
      ? new Date(firstOfMonth + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      : view === "week"
        ? `Week of ${dayLabel(start, "long")}`
        : dayLabel(anchor, "long");

  return (
    <>
      <PageHeader title="Schedule" subtitle={title} />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.notice && <Alert tone="good">{sp.notice}</Alert>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg ring-1 ring-slate-300">
          <Link href={qs({ date: prevDate })} className="rounded-l-lg px-2 py-2 text-slate-600 hover:bg-slate-50" aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link href={qs({ date: today })} className="border-x border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Today
          </Link>
          <Link href={qs({ date: nextDate })} className="rounded-r-lg px-2 py-2 text-slate-600 hover:bg-slate-50" aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {(["month", "week", "day"] as const).map((v) => (
            <Link
              key={v}
              href={qs({ view: v })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {v === "month" ? "Month" : v === "week" ? "Week" : "Day"}
            </Link>
          ))}
        </div>
        <form className="flex items-center gap-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={anchor} />
          <Select name="tech" defaultValue={sp.tech ?? ""} className="w-auto py-1.5">
            <option value="">All techs</option>
            {people
              .filter((p) => p.role === "tech")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                </option>
              ))}
          </Select>
          <Button variant="secondary" size="sm" type="submit">
            Show
          </Button>
        </form>
        {profile.role === "admin" && (
          <Link href="/schedule/time-off" className={btnClass("secondary", "sm")}>
            <CalendarOff className="h-4 w-4" aria-hidden /> Days off
          </Link>
        )}
        {view === "day" && (
          <Link href={`/my-day?date=${anchor}${sp.tech ? `&tech=${sp.tech}` : ""}`} className={btnClass("ghost", "sm")}>
            Route view →
          </Link>
        )}
      </div>

      {view === "month" ? (
        <MonthCalendar
          days={days}
          month={monthKey}
          today={today}
          jobs={jobs.filter((j) => j.scheduled_date)}
          forecast={forecast}
          techNames={Object.fromEntries(people.map((p) => [p.id, personName(p)]))}
          off={offByDay}
          canEdit
          dayHref={`/schedule?view=day${sp.tech ? `&tech=${sp.tech}` : ""}&date=`}
          showTech={!sp.tech}
        />
      ) : (
      <ScheduleBoard
        days={days}
        dayLabels={dayLabels}
        techs={techs}
        jobs={jobs}
        forecast={forecast}
        off={off}
        canEdit
        isAdmin={profile.role === "admin"}
        view={view}
        today={today}
        sent={sent}
        backUrl={qs({})}
        sites={((siteData ?? []) as { id: string; code: string | null; name: string }[]).map((s) => ({ id: s.id, code: s.code ?? s.name }))}
      />
      )}
    </>
  );
}

/** First day of the month `n` months from a YYYY-MM-01 date. */
function shiftMonth(firstOfMonth: string, n: number) {
  const d = new Date(firstOfMonth + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  return d.toISOString().slice(0, 10);
}
