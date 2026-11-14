import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, MapPin, Navigation, Pause, Phone, Play, Receipt, Square } from "lucide-react";
import { getSession } from "@/lib/auth";
import { WORKABLE_STATUSES } from "@/lib/constants";
import { addDaysISO, dayLabel, fmtTime, isISODate, personName, relativeDue, dueWhen, todayISO } from "@/lib/format";
import type { WoPriority, WoStatus, WoType } from "@/lib/types";
import { Alert, Card, CardHeader, EmptyState, PageHeader, Select, Button } from "@/components/ui";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { SubmitButton } from "@/components/SubmitButton";
import { TimerClock } from "@/components/TimerClock";
import { ENTRY_COLS, fmtClockTime, type TimeEntry } from "@/lib/labor";
import { changeTimer, startTimer } from "../work-orders/time-actions";
import { ClockCard, type ClockJob, type OpenShift } from "./ClockCard";
import { toDateInput, fmtDate } from "@/lib/format";
import { redirect } from "next/navigation";

export const metadata = { title: "My day" };
export const dynamic = "force-dynamic";

type Job = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  priority: WoPriority;
  status: WoStatus;
  type: WoType;
  scheduled_start: string | null;
  scheduled_date: string | null;
  estimated_hours: number | null;
  location_detail: string | null;
  due_at: string | null;
  site: { name: string; code: string | null; address: string | null; city: string | null; state: string | null; phone: string | null } | null;
  asset: { name: string } | null;
};
const SELECT =
  "id,number,title,description,priority,status,type,scheduled_start,scheduled_date,estimated_hours,location_detail,due_at," +
  "site:sites(name,code,address,city,state,phone), asset:assets(name)";

export default async function MyDayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  if (profile.role === "vendor") redirect("/work-orders");
  if (profile.role === "manager") redirect("/");

  const date = isISODate(sp.date) ? sp.date : todayISO();
  const techId = profile.role === "admin" && sp.tech ? sp.tech : profile.id;
  const isMe = techId === profile.id;

  const [{ data: dayData }, { data: otherData }, { data: techData }] = await Promise.all([
    supabase.from("work_orders").select(SELECT).eq("assigned_tech_id", techId).eq("scheduled_date", date).neq("status", "cancelled").order("scheduled_start", { ascending: true, nullsFirst: false }),
    supabase.from("work_orders").select(SELECT).eq("assigned_tech_id", techId).is("scheduled_date", null).in("status", WORKABLE_STATUSES).order("due_at").limit(20),
    profile.role === "admin"
      ? supabase.from("profiles").select("id,full_name,email").in("role", ["tech", "admin"]).eq("active", true).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
  ]);
  // Open timers for this tech (any work order), so a running timer is always visible here.
  const { data: timerData } = await supabase
    .from("time_entries")
    .select(`${ENTRY_COLS}, wo:work_orders(number,title)`)
    .eq("user_id", techId)
    .in("status", ["running", "paused"])
    .order("started_at");
  const timers = (timerData ?? []) as unknown as (TimeEntry & { wo: { number: number; title: string } | null })[];
  const timerFor = (woId: string) => timers.find((t) => t.work_order_id === woId);
  const jobs = (dayData ?? []) as unknown as Job[];
  const unscheduled = (otherData ?? []) as unknown as Job[];
  const techs = (techData ?? []) as { id: string; full_name: string | null; email: string | null }[];
  const hours = jobs.reduce((s, j) => s + Number(j.estimated_hours || 0), 0);
  const done = jobs.filter((j) => j.status === "completed" || j.status === "awaiting_signoff").length;
  const nav = (d: string) => `/my-day?date=${d}${!isMe ? `&tech=${techId}` : ""}`;
  const back = nav(date);
  const techLabel = isMe ? "My day" : `${personName(techs.find((t) => t.id === techId))}’s day`;

  // Clock in / out (technicians only).
  const { data: techRow } = await supabase.from("profiles").select("role").eq("id", techId).maybeSingle();
  const clocks = (techRow as { role: string } | null)?.role === "tech";
  let shift: OpenShift | null = null;
  let clockJobs: ClockJob[] = [];
  let lastJobId: string | null = null;
  if (clocks) {
    const [{ data: s }, { data: openJobs }] = await Promise.all([
      supabase
        .from("tech_shifts")
        .select("id,clock_in_at,start_reason,first:work_orders!tech_shifts_first_work_order_id_fkey(number,title)")
        .eq("user_id", techId)
        .is("clock_out_at", null)
        .maybeSingle(),
      supabase
        .from("work_orders")
        .select("id,number,title,scheduled_date,site:sites(name,code)")
        .eq("assigned_tech_id", techId)
        .in("status", WORKABLE_STATUSES)
        .order("scheduled_date", { ascending: true, nullsFirst: false })
        .limit(60),
    ]);
    const today = todayISO();
    type J = { id: string; number: number; title: string; scheduled_date: string | null; site: { name: string; code: string | null } | null };
    const open = ((openJobs ?? []) as unknown as J[]).map((j) => ({
      id: j.id,
      number: j.number,
      title: j.title,
      site: j.site?.code ?? j.site?.name ?? null,
      open: true,
      today: j.scheduled_date === today,
    }));
    clockJobs = [...open.filter((j) => j.today), ...open.filter((j) => !j.today)];
    const sh = s as unknown as { id: string; clock_in_at: string; start_reason: string | null; first: { number: number; title: string } | null } | null;
    if (sh) {
      // Jobs timed during this shift come first on Clock out, even if they're no longer open.
      const { data: worked } = await supabase
        .from("time_entries")
        .select("work_order_id,status,started_at,wo:work_orders(id,number,title,status,site:sites(name,code))")
        .eq("user_id", techId)
        .gte("started_at", sh.clock_in_at)
        .neq("status", "void")
        .order("started_at", { ascending: false });
      type W = { work_order_id: string; status: string; wo: { id: string; number: number; title: string; status: WoStatus; site: { name: string; code: string | null } | null } | null };
      const w = (worked ?? []) as unknown as W[];
      lastJobId = (w.find((x) => x.status === "running" || x.status === "paused") ?? w[0])?.work_order_id ?? null;
      const timed: ClockJob[] = [];
      for (const x of w) {
        if (!x.wo || timed.some((t) => t.id === x.wo!.id)) continue;
        timed.push({ id: x.wo.id, number: x.wo.number, title: x.wo.title, site: x.wo.site?.code ?? x.wo.site?.name ?? null, open: WORKABLE_STATUSES.includes(x.wo.status) });
      }
      clockJobs = [...timed, ...clockJobs.filter((j) => !timed.some((t) => t.id === j.id))];
      const { data: br } = await supabase.from("tech_shift_breaks").select("started_at,ended_at").eq("shift_id", sh.id);
      const breaks = (br ?? []) as { started_at: string; ended_at: string | null }[];
      const onLunch = breaks.find((b) => !b.ended_at);
      const lunchMinutes = Math.round(
        breaks.filter((b) => b.ended_at).reduce((t, b) => t + (new Date(b.ended_at!).getTime() - new Date(b.started_at).getTime()) / 60000, 0),
      );
      const startDay = toDateInput(sh.clock_in_at);
      shift = {
        clock_in_at: sh.clock_in_at,
        clockInTime: `${startDay === today ? "" : `${fmtDate(startDay)} `}${fmtClockTime(sh.clock_in_at)}`,
        firstLabel: sh.first ? `#${sh.first.number} ${sh.first.title}` : (sh.start_reason ?? "no work order"),
        staleDate: startDay < today ? startDay : null,
        staleLabel: startDay < today ? fmtDate(startDay) : null,
        lunch: onLunch ? { since: onLunch.started_at, sinceTime: fmtClockTime(onLunch.started_at) } : null,
        lunchMinutes,
      };
    }
  }

  return (
    <>
      <PageHeader
        title={techLabel}
        subtitle={`${dayLabel(date, "long")} · ${jobs.length} job${jobs.length === 1 ? "" : "s"}${hours ? ` · ~${hours}h` : ""}${jobs.length ? ` · ${done} done` : ""}`}
        actions={
          <div className="flex items-center gap-2">
          <Link
            href="/purchases/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            title="Restaurant supplies not tied to a job"
          >
            <Receipt className="h-4 w-4" aria-hidden /> Log a purchase
          </Link>
          <div className="flex items-center rounded-lg bg-white ring-1 ring-slate-300">
            <Link href={nav(addDaysISO(date, -1))} className="px-2 py-2 text-slate-600 hover:bg-slate-50" aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <Link href={nav(todayISO())} className="border-x border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
              Today
            </Link>
            <Link href={nav(addDaysISO(date, 1))} className="px-2 py-2 text-slate-600 hover:bg-slate-50" aria-label="Next day">
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          </div>
        }
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.clock === "in" && <Alert tone="good">Clocked in. Your first job&apos;s timer is running.</Alert>}
      {sp.clock === "out" && <Alert tone="good">Clocked out. Have a good one.</Alert>}
      {sp.clock === "lunch" && <Alert tone="good">Enjoy your lunch. Your job timer is paused.</Alert>}
      {sp.clock === "back" && <Alert tone="good">Welcome back.{sp.resumed ? ` Your timer on #${sp.resumed} is running again.` : ""}</Alert>}
      {sp.clock === "out_done" && <Alert tone="good">Clocked out, and the job was sent to the store&apos;s GM to confirm it&apos;s fixed.</Alert>}
      {clocks && isMe && <ClockCard key={shift ? "on" : "off"} shift={shift} jobs={clockJobs} lastJobId={lastJobId} preselectJobId={sp.clockin || null} />}
      {clocks && !isMe && (
        <p className={`mb-4 rounded-lg px-4 py-2.5 text-sm ring-1 ring-inset ${shift ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : "bg-slate-50 text-slate-600 ring-slate-200"}`}>
          {shift ? `${shift.lunch ? `On lunch since ${shift.lunch.sinceTime} · ` : ""}Clocked in since ${shift.clockInTime} · started on ${shift.firstLabel}` : "Clocked out"}
        </p>
      )}
      {sp.timer?.includes("_paused_") && <Alert tone="good">Timer started. Your other timer (#{sp.timer.split("_paused_")[1]}) was paused, since only one can run at a time.</Alert>}

      {timers.length > 0 && (
        <div className="mb-4 space-y-2">
          {timers.map((t) => (
            <div key={t.id} className={`flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 ring-1 ring-inset ${t.status === "running" ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200"}`}>
              <Clock className="h-4 w-4 text-slate-500" aria-hidden />
              <div className="min-w-0 flex-1">
                <Link href={`/work-orders/${t.work_order_id}#time`} className="block truncate text-sm font-medium text-slate-900 hover:text-brand-700">
                  #{t.wo?.number} {t.wo?.title}
                </Link>
                <p className="text-xs text-slate-500">
                  {t.status === "running" ? "Running" : "Paused"} · started {fmtClockTime(t.started_at)} · visit {t.visit}
                </p>
              </div>
              <TimerClock worked={t.worked_seconds} resumedAt={t.status === "running" ? t.last_resumed_at : null} className="font-mono text-lg font-semibold tabular-nums" />
              {isMe && (
                <form className="flex gap-2">
                  <input type="hidden" name="entry_id" value={t.id} />
                  <input type="hidden" name="back" value={back} />
                  {t.status === "running" ? (
                    <SubmitButton size="sm" variant="secondary" formAction={changeTimer.bind(null, "pause")} pendingText="…">
                      <Pause className="h-3.5 w-3.5" aria-hidden /> Pause
                    </SubmitButton>
                  ) : (
                    <SubmitButton size="sm" variant="secondary" formAction={changeTimer.bind(null, "resume")} pendingText="…">
                      <Play className="h-3.5 w-3.5" aria-hidden /> Resume
                    </SubmitButton>
                  )}
                  <SubmitButton size="sm" formAction={changeTimer.bind(null, "stop")} pendingText="…" confirm="Stop this timer?">
                    <Square className="h-3.5 w-3.5" aria-hidden /> Stop
                  </SubmitButton>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {profile.role === "admin" && (
        <form className="mb-4 flex items-center gap-2">
          <input type="hidden" name="date" value={date} />
          <Select name="tech" defaultValue={techId} className="w-auto">
            {techs.map((t) => (
              <option key={t.id} value={t.id}>
                {personName(t)}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" type="submit">
            View
          </Button>
        </form>
      )}

      {jobs.length === 0 ? (
        <Card>
          <EmptyState title="Nothing scheduled for this day.">
            {profile.role === "admin" ? (
              <Link href={`/schedule?view=day&date=${date}`} className="text-brand-700">
                Open the schedule
              </Link>
            ) : (
              "Check open jobs below, or ask dispatch."
            )}
          </EmptyState>
        </Card>
      ) : (
        <ol className="space-y-3">
          {jobs.map((j, i) => {
            const addr = [j.site?.address, j.site?.city, j.site?.state].filter(Boolean).join(", ");
            const closed = j.status === "completed" || j.status === "awaiting_signoff";
            return (
              <li key={j.id}>
                <Card className={closed ? "opacity-60" : ""}>
                  <div className="flex gap-4 p-4">
                    <div className="flex w-16 flex-none flex-col items-center">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">{i + 1}</span>
                      <span className="mt-1 text-center text-xs font-medium text-slate-700">{fmtTime(j.scheduled_start) || "Anytime"}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <PriorityBadge priority={j.priority} />
                        <StatusBadge status={j.status} />
                        <span className="font-mono text-xs text-slate-400">#{j.number}</span>
                      </div>
                      <Link href={`/work-orders/${j.id}`} className="mt-1 block text-base font-semibold text-slate-900 hover:text-brand-700">
                        {j.title}
                      </Link>
                      <p className="text-sm text-slate-600">
                        {j.site?.name}
                        {j.asset && ` · ${j.asset.name}`}
                        {j.location_detail && ` · ${j.location_detail}`}
                      </p>
                      {j.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{j.description}</p>}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        {addr && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" aria-hidden /> {addr}
                          </span>
                        )}
                        {j.estimated_hours ? (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" aria-hidden /> ~{j.estimated_hours}h
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {addr && (
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                          >
                            <Navigation className="h-3.5 w-3.5" aria-hidden /> Directions
                          </a>
                        )}
                        {j.site?.phone && (
                          <a href={`tel:${j.site.phone}`} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
                            <Phone className="h-3.5 w-3.5" aria-hidden /> Call site
                          </a>
                        )}
                        {isMe && !closed && j.status !== "cancelled" && !timerFor(j.id) && (
                          <form action={startTimer}>
                            <input type="hidden" name="work_order_id" value={j.id} />
                            <input type="hidden" name="back" value={back} />
                            <SubmitButton size="sm" variant="secondary" pendingText="Starting…">
                              <Play className="h-3.5 w-3.5" aria-hidden /> {j.status === "in_progress" ? "Start timer" : "Start work"}
                            </SubmitButton>
                          </form>
                        )}
                        {timerFor(j.id) && (
                          <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${timerFor(j.id)!.status === "running" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>
                            <Clock className="h-3.5 w-3.5" aria-hidden />
                            <TimerClock worked={timerFor(j.id)!.worked_seconds} resumedAt={timerFor(j.id)!.status === "running" ? timerFor(j.id)!.last_resumed_at : null} className="font-mono tabular-nums" />
                          </span>
                        )}
                        {!closed && (
                          <Link href={`/work-orders/${j.id}?add_receipt=1#receipts`} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
                            <Receipt className="h-3.5 w-3.5" aria-hidden /> Add receipt
                          </Link>
                        )}
                        <Link href={`/work-orders/${j.id}`} className="inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
                          {closed ? "View" : "Open job"}
                        </Link>
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      {unscheduled.length > 0 && (
        <Card className="mt-6">
          <CardHeader title={isMe ? "Also assigned to you (not scheduled)" : "Also assigned (not scheduled)"} />
          <ul className="divide-y divide-slate-100">
            {unscheduled.map((j) => (
              <li key={j.id}>
                <Link href={`/work-orders/${j.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="w-12 font-mono text-xs text-slate-400">#{j.number}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{j.title}</p>
                    <p className="text-xs text-slate-500">
                      {j.site?.code ?? j.site?.name} · due {dueWhen(j.due_at)}
                    </p>
                  </div>
                  <PriorityBadge priority={j.priority} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
