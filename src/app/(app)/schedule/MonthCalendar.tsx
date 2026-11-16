"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import clsx from "clsx";
import { CalendarClock, Search } from "lucide-react";
import type { WoPriority } from "@/lib/types";
import { moveWorkOrder } from "./actions";
import type { BoardForecast, BoardJob } from "./ScheduleBoard";

const BAR: Record<WoPriority, string> = {
  emergency: "border-l-red-600",
  high: "border-l-orange-500",
  medium: "border-l-amber-400",
  low: "border-l-slate-300",
};
const RANK: Record<WoPriority, number> = { emergency: 0, high: 1, medium: 2, low: 3 };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_PER_DAY = 4;

function fmtTime(t: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h >= 12 ? "p" : "a"}`;
}
const initials = (name: string) =>
  name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Month at a glance: every scheduled job and upcoming PM per day. Drag a job to another day to move it (same tech). */
export function MonthCalendar({
  days,
  month,
  today,
  jobs: initialJobs,
  forecast,
  techNames,
  off,
  canEdit,
  dayHref,
  showTech,
  sites,
}: {
  /** Every day in the grid (whole weeks, Sunday first). */
  days: string[];
  /** "YYYY-MM" of the month being shown; other days are greyed. */
  month: string;
  today: string;
  jobs: BoardJob[];
  forecast: BoardForecast[];
  techNames: Record<string, string>;
  /** date → names of techs off that day. */
  off: Record<string, string[]>;
  canEdit: boolean;
  /** Link to the day view, with the date appended. */
  dayHref: string;
  /** Show who each job is assigned to (off when filtered to one tech). */
  showTech: boolean;
  sites: { id: string; code: string }[];
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  useEffect(() => setJobs(initialJobs), [initialJobs]);

  const term = q.trim().toLowerCase();
  const backlog = jobs
    .filter((j) => !j.scheduled_date && !["completed", "cancelled"].includes(j.status))
    .filter((j) => !siteFilter || j.site_id === siteFilter)
    .filter((j) => !onlyUnassigned || (!j.assigned_tech_id && !j.vendor_name))
    .filter((j) => !term || j.title.toLowerCase().includes(term) || String(j.number).includes(term) || j.site_code.toLowerCase().includes(term))
    .sort((a, b) => RANK[a.priority] - RANK[b.priority] || (a.due_at ?? "z").localeCompare(b.due_at ?? "z"));

  const byDay = new Map<string, BoardJob[]>();
  for (const j of jobs) if (j.scheduled_date) byDay.set(j.scheduled_date, [...(byDay.get(j.scheduled_date) ?? []), j]);
  const pmByDay = new Map<string, BoardForecast[]>();
  for (const f of forecast) pmByDay.set(f.date, [...(pmByDay.get(f.date) ?? []), f]);

  function drop(date: string | null) {
    const id = drag;
    setDrag(null);
    setOver(null);
    const job = jobs.find((j) => j.id === id);
    if (!job || job.scheduled_date === date) return;
    const before = jobs;
    setJobs(jobs.map((j) => (j.id === id ? { ...j, scheduled_date: date, ...(date === null && { scheduled_start: null }) } : j)));
    setError(null);
    start(async () => {
      const res = await moveWorkOrder({ id: job.id, date });
      if (!res.ok) {
        setJobs(before);
        setError(res.error);
      } else router.refresh();
    });
  }

  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));

  return (
    <div>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className={clsx("overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200", pending && "opacity-80")}>
        <div className="min-w-[760px]">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2">
                {d}
              </div>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0">
              {week.map((d) => {
                const inMonth = d.startsWith(month);
                const list = (byDay.get(d) ?? []).sort(
                  (a, b) => (a.scheduled_start ?? "99").localeCompare(b.scheduled_start ?? "99") || RANK[a.priority] - RANK[b.priority],
                );
                const pms = pmByDay.get(d) ?? [];
                const shown = list.slice(0, MAX_PER_DAY);
                const pmShown = pms.slice(0, Math.max(0, MAX_PER_DAY - shown.length));
                const more = list.length + pms.length - shown.length - pmShown.length;
                const hours = list.reduce((s, j) => s + Number(j.estimated_hours || 0), 0) + pms.reduce((s, p) => s + Number(p.estimated_hours || 0), 0);
                const offNames = off[d] ?? [];
                return (
                  <div
                    key={d}
                    onDragOver={(e) => {
                      if (!drag) return;
                      e.preventDefault();
                      setOver(d);
                    }}
                    onDragLeave={() => setOver((o) => (o === d ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      drop(d);
                    }}
                    className={clsx(
                      "min-h-[7.5rem] border-r border-slate-100 p-1.5 last:border-r-0",
                      !inMonth && "bg-slate-50/70",
                      d === today && "bg-brand-50/40",
                      over === d && "bg-brand-50 ring-2 ring-inset ring-brand-300",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <Link
                        href={`${dayHref}${d}`}
                        className={clsx(
                          "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold",
                          d === today ? "bg-brand-600 text-white" : inMonth ? "text-slate-800 hover:bg-slate-100" : "text-slate-400 hover:bg-slate-100",
                        )}
                        title="Open this day"
                      >
                        {Number(d.slice(8))}
                      </Link>
                      {hours > 0 && <span className="text-[10px] text-slate-400">{Math.round(hours * 10) / 10}h</span>}
                    </div>
                    {offNames.length > 0 && (
                      <p className="mb-1 truncate rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-800" title={`Off: ${offNames.join(", ")}`}>
                        Off: {offNames.length > 2 ? `${offNames.length} techs` : offNames.join(", ")}
                      </p>
                    )}
                    <div className="space-y-1">
                      {shown.map((j) => {
                        const done = j.status === "completed" || j.status === "awaiting_signoff";
                        const tech = j.assigned_tech_id ? techNames[j.assigned_tech_id] : null;
                        return (
                          <Link
                            key={j.id}
                            href={`/work-orders/${j.id}`}
                            draggable={canEdit && !done}
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "move";
                              setDrag(j.id);
                            }}
                            onDragEnd={() => {
                              setDrag(null);
                              setOver(null);
                            }}
                            title={`#${j.number} ${j.title} · ${j.site_code}${tech ? ` · ${tech}` : j.vendor_name ? ` · ${j.vendor_name}` : ""}`}
                            className={clsx(
                              "block truncate rounded border-l-[3px] bg-white px-1.5 py-0.5 text-[11px] leading-4 shadow-sm ring-1 ring-slate-200 hover:ring-brand-300",
                              BAR[j.priority],
                              done && "opacity-50 line-through",
                              canEdit && !done && "cursor-grab active:cursor-grabbing",
                              drag === j.id && "opacity-40",
                            )}
                          >
                            {j.scheduled_start && <span className="font-medium text-slate-500">{fmtTime(j.scheduled_start)} </span>}
                            <span className="font-medium text-slate-900">{j.title}</span>
                            <span className="text-slate-500"> · {j.site_code}</span>
                            {showTech && (tech || j.vendor_name) && (
                              <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600">{tech ? initials(tech) : j.vendor_name}</span>
                            )}
                          </Link>
                        );
                      })}
                      {pmShown.map((f) => (
                        <div
                          key={`${f.pm_id}|${f.due}`}
                          title={`Planned PM (work order not created yet): ${f.title} · ${f.site_code}${f.tech_id && techNames[f.tech_id] ? ` · ${techNames[f.tech_id]}` : ""}`}
                          className="flex items-center gap-1 truncate rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[11px] leading-4 text-slate-500"
                        >
                          <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">
                            {f.title} · {f.site_code}
                          </span>
                        </div>
                      ))}
                      {more > 0 && (
                        <Link href={`${dayHref}${d}`} className="block px-1 text-[11px] font-medium text-brand-700 hover:underline">
                          +{more} more
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {canEdit
          ? "Drag a job to another day to move it (it stays with the same tech), or drop it on Unscheduled to take it off the calendar. "
          : ""}
        Dashed items are planned PMs that become work orders automatically. Click a date to open that day.
      </p>

      {/* Unscheduled: drag onto a day to schedule it; drop a job here to take it off the calendar. */}
      <div
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          setOver("backlog");
        }}
        onDragLeave={() => setOver((o) => (o === "backlog" ? null : o))}
        onDrop={(e) => {
          e.preventDefault();
          drop(null);
        }}
        className={clsx("mt-4 rounded-xl border border-slate-200 bg-white shadow-sm", over === "backlog" && "ring-2 ring-brand-500")}
      >
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3">
          <div className="mr-auto">
            <p className="text-sm font-semibold">Unscheduled</p>
            <p className="text-xs text-slate-500">
              {backlog.length} open job{backlog.length === 1 ? "" : "s"} without a date · {canEdit ? "drag one onto a day to schedule it" : "an admin will schedule them"}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg px-2 ring-1 ring-slate-200">
            <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-40 border-0 py-1.5 text-sm focus:ring-0" />
          </div>
          <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className="rounded-lg border-0 py-1.5 pl-2 text-sm ring-1 ring-slate-200">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm text-slate-600">
            <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} className="rounded border-slate-300" />
            Unassigned
          </label>
        </div>
        <div className="grid max-h-[50vh] grid-cols-1 gap-1.5 overflow-y-auto p-2 sm:grid-cols-2 lg:grid-cols-4">
          {backlog.length === 0 ? (
            <p className="col-span-full px-2 py-6 text-center text-xs text-slate-500">Everything open is on the calendar.</p>
          ) : (
            backlog.map((j) => {
              const tech = j.assigned_tech_id ? techNames[j.assigned_tech_id] : null;
              const late = j.due_at && new Date(j.due_at) < new Date();
              return (
                <div
                  key={j.id}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDrag(j.id);
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  className={clsx(
                    "rounded-md border border-l-4 border-slate-200 bg-white px-2 py-1.5 text-xs shadow-sm",
                    BAR[j.priority],
                    canEdit && "cursor-grab active:cursor-grabbing",
                    drag === j.id && "opacity-40",
                  )}
                  title={`#${j.number} ${j.title}`}
                >
                  <span className="font-mono text-[11px] text-slate-500">#{j.number}</span>
                  <Link href={`/work-orders/${j.id}`} draggable={false} className="block truncate font-medium text-slate-900 hover:text-brand-700">
                    {j.title}
                  </Link>
                  <div className="flex flex-wrap gap-x-2 text-[11px] text-slate-500">
                    <span className="font-medium text-slate-600">{j.site_code}</span>
                    {tech && <span>{tech}</span>}
                    {j.vendor_name && <span>{j.vendor_name}</span>}
                    {!tech && !j.vendor_name && <span className="text-amber-700">Unassigned</span>}
                    {late && <span className="font-medium text-red-700">overdue</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
