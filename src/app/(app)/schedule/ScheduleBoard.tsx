"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { GripVertical, Mail, Search } from "lucide-react";
import type { WoPriority, WoStatus, WoType } from "@/lib/types";
import { moveWorkOrder, emailSchedules } from "./actions";

export type BoardJob = {
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
  vendor_name: string | null;
  site_id: string;
  site_code: string;
  site_address: string | null;
  due_at: string | null;
};
export type BoardTech = { id: string; name: string };

const NO_TECH = "__none__";
const PRIORITY_BAR: Record<WoPriority, string> = {
  emergency: "border-l-red-600",
  high: "border-l-orange-500",
  medium: "border-l-amber-400",
  low: "border-l-slate-300",
};
const PRIORITY_RANK: Record<WoPriority, number> = { emergency: 0, high: 1, medium: 2, low: 3 };

function fmtTime(t: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}${h >= 12 ? "p" : "a"}`;
}
const byTime = (a: BoardJob, b: BoardJob) =>
  (a.scheduled_start ?? "99").localeCompare(b.scheduled_start ?? "99") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

export function ScheduleBoard({
  days,
  dayLabels,
  techs,
  jobs: initialJobs,
  canEdit,
  isAdmin,
  view,
  today,
  sent,
  backUrl,
  sites,
}: {
  days: string[];
  dayLabels: Record<string, string>;
  techs: BoardTech[];
  jobs: BoardJob[];
  canEdit: boolean;
  isAdmin: boolean;
  view: "week" | "day";
  today: string;
  sent: Record<string, string>; // `${techId}|${date}` → "6:02 AM"
  backUrl: string;
  sites: { id: string; code: string }[];
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  useEffect(() => setJobs(initialJobs), [initialJobs]);

  const cells = useMemo(() => {
    const m = new Map<string, BoardJob[]>();
    for (const j of jobs) {
      if (!j.scheduled_date || !days.includes(j.scheduled_date)) continue;
      const key = `${j.assigned_tech_id ?? NO_TECH}|${j.scheduled_date}`;
      m.set(key, [...(m.get(key) ?? []), j]);
    }
    m.forEach((list) => list.sort(byTime));
    return m;
  }, [jobs, days]);

  const backlog = useMemo(() => {
    const term = q.trim().toLowerCase();
    return jobs
      .filter((j) => !j.scheduled_date && !["completed", "cancelled"].includes(j.status))
      .filter((j) => !siteFilter || j.site_id === siteFilter)
      .filter((j) => !onlyUnassigned || (!j.assigned_tech_id && !j.vendor_name))
      .filter((j) => !term || j.title.toLowerCase().includes(term) || String(j.number).includes(term) || j.site_code.toLowerCase().includes(term))
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.due_at ?? "z").localeCompare(b.due_at ?? "z"));
  }, [jobs, q, siteFilter, onlyUnassigned]);

  const rows: BoardTech[] = [...techs, { id: NO_TECH, name: "No tech (vendor / unassigned)" }];
  const techName = (id: string | null) => techs.find((t) => t.id === id)?.name;

  function drop(target: { techId: string | null; date: string | null }) {
    const id = dragId;
    setDragId(null);
    setOver(null);
    if (!id) return;
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    const techId = target.date === null ? job.assigned_tech_id : target.techId; // back to list keeps the tech
    if (job.scheduled_date === target.date && job.assigned_tech_id === techId) return;

    const before = jobs;
    setError(null);
    setJobs((list) =>
      list.map((j) =>
        j.id === id ? { ...j, scheduled_date: target.date, assigned_tech_id: techId, scheduled_start: target.date ? j.scheduled_start : null } : j,
      ),
    );
    startTransition(async () => {
      const res = await moveWorkOrder({ id, date: target.date, ...(target.date !== null && { techId }) });
      if (!res.ok) {
        setJobs(before);
        setError(res.error);
      }
      router.refresh();
    });
  }

  const dropProps = (key: string, target: { techId: string | null; date: string | null }) =>
    canEdit
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            if (over !== key) setOver(key);
          },
          onDragLeave: () => setOver((o) => (o === key ? null : o)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            drop(target);
          },
        }
      : {};

  const card = (j: BoardJob, opts: { showTech?: boolean; showAddress?: boolean } = {}) => {
    const done = j.status === "completed" || j.status === "cancelled";
    const late = !done && j.due_at && new Date(j.due_at) < new Date();
    return (
      <div
        key={j.id}
        data-job={j.number}
        draggable={canEdit && !done}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", j.id);
          e.dataTransfer.effectAllowed = "move";
          setDragId(j.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOver(null);
        }}
        className={clsx(
          "group relative rounded-md border border-l-4 border-slate-200 bg-white px-2 py-1.5 text-xs shadow-sm",
          PRIORITY_BAR[j.priority],
          canEdit && !done && "cursor-grab active:cursor-grabbing",
          dragId === j.id && "opacity-40",
          done && "opacity-60",
        )}
        title={`#${j.number} ${j.title}`}
      >
        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          {canEdit && !done && <GripVertical className="-ml-1 h-3 w-3 text-slate-300" aria-hidden />}
          <span className="font-mono">#{j.number}</span>
          {j.scheduled_start && <span className="ml-auto font-semibold text-slate-700">{fmtTime(j.scheduled_start)}</span>}
        </div>
        <Link href={`/work-orders/${j.id}`} draggable={false} className={clsx("mt-0.5 line-clamp-2 font-medium text-slate-900 hover:text-brand-700", done && "line-through")}>
          {j.title}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
          <span className="font-medium text-slate-600">{j.site_code}</span>
          {j.estimated_hours ? <span>{j.estimated_hours}h</span> : null}
          {j.type !== "reactive" && <span>{j.type === "preventive" ? "PM" : j.type === "compliance" ? "Compliance" : "Project"}</span>}
          {opts.showTech && j.assigned_tech_id && <span>{techName(j.assigned_tech_id)}</span>}
          {j.vendor_name && <span>{j.vendor_name}</span>}
          {late && <span className="font-medium text-red-700">overdue</span>}
          {j.status === "completed" && <span className="text-emerald-700">done</span>}
          {j.status === "in_progress" && <span className="text-amber-700">in progress</span>}
        </div>
        {opts.showAddress && j.site_address && <div className="mt-0.5 truncate text-[11px] text-slate-400">{j.site_address}</div>}
      </div>
    );
  };

  const cols = view === "week" ? days.length : 1;

  return (
    <div className="flex flex-col gap-4 2xl:flex-row">
      <div className="min-w-0 flex-1">
        {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">{error}</div>}
        <div className={clsx("overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm", pending && "opacity-90")}>
          <div className="grid" style={{ gridTemplateColumns: `150px repeat(${cols}, minmax(${view === "week" ? 108 : 360}px, 1fr))` }}>
            {/* Header */}
            <div className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Tech</div>
            {days.map((d) => (
              <div key={d} className={clsx("flex items-center justify-between gap-1 whitespace-nowrap border-b border-l border-slate-200 px-2 py-2 text-xs font-medium", d === today ? "bg-brand-50 text-brand-700" : "bg-slate-50 text-slate-600")}>
                <span>{dayLabels[d]}</span>
                {isAdmin && (
                  <form action={emailSchedules}>
                    <input type="hidden" name="date" value={d} />
                    <input type="hidden" name="back" value={backUrl} />
                    <button
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-white hover:text-brand-700"
                      title="Email this day's schedule to every tech with jobs"
                      onClick={(e) => {
                        if (!confirm(`Email ${dayLabels[d]} schedules to all techs with jobs that day?`)) e.preventDefault();
                      }}
                    >
                      <Mail className="h-3.5 w-3.5" aria-hidden />
                      {view === "day" && "Email all"}
                      <span className="sr-only">Email all techs</span>
                    </button>
                  </form>
                )}
              </div>
            ))}

            {/* Rows */}
            {rows.map((t) => {
              const techJobs = days.flatMap((d) => cells.get(`${t.id}|${d}`) ?? []);
              const weekHours = techJobs.reduce((s, j) => s + Number(j.estimated_hours || 0), 0);
              return (
                <div key={t.id} className="contents">
                  <div className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-2">
                    <p className={clsx("text-sm font-medium", t.id === NO_TECH ? "text-slate-500" : "text-slate-900")}>{t.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {techJobs.length} job{techJobs.length === 1 ? "" : "s"}
                      {weekHours ? ` · ${weekHours}h` : ""}
                    </p>
                    {view === "day" && t.id !== NO_TECH && (
                      <div className="mt-1 flex items-center gap-2">
                        {sent[`${t.id}|${days[0]}`] && <span className="text-[11px] text-emerald-700">Emailed {sent[`${t.id}|${days[0]}`]}</span>}
                        {isAdmin && techJobs.length > 0 && (
                          <form action={emailSchedules}>
                            <input type="hidden" name="date" value={days[0]} />
                            <input type="hidden" name="tech_id" value={t.id} />
                            <input type="hidden" name="back" value={backUrl} />
                            <button className="flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline">
                              <Mail className="h-3 w-3" aria-hidden /> {sent[`${t.id}|${days[0]}`] ? "Resend" : "Email schedule"}
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                  {days.map((d) => {
                    const key = `${t.id}|${d}`;
                    const list = cells.get(key) ?? [];
                    const hours = list.reduce((s, j) => s + Number(j.estimated_hours || 0), 0);
                    return (
                      <div
                        key={key}
                        data-cell={key}
                        {...dropProps(key, { techId: t.id === NO_TECH ? null : t.id, date: d })}
                        className={clsx(
                          "min-h-[84px] border-b border-l border-slate-100 p-1.5 transition-colors",
                          d === today && "bg-brand-50/30",
                          over === key && "bg-brand-100/60 ring-2 ring-inset ring-brand-500",
                          t.id === NO_TECH && "bg-slate-50/60",
                        )}
                      >
                        {view === "week" && sent[key] && <p className="mb-1 text-[10px] text-emerald-700">✓ emailed {sent[key]}</p>}
                        <div className={clsx("gap-1.5", view === "day" ? "grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3" : "flex flex-col")}>
                          {list.map((j) => card(j, { showAddress: view === "day" }))}
                        </div>
                        {hours > 0 && (
                          <p className={clsx("mt-1 text-right text-[10px]", hours > 8 ? "font-semibold text-orange-700" : "text-slate-400")}>
                            {hours}h{hours > 8 ? " · over 8h" : ""}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        {canEdit && <p className="mt-2 text-xs text-slate-500">Drag jobs between techs and days. Drop on the unscheduled list to take a job off the calendar. Set exact start times on the work order.</p>}
      </div>

      {/* Unscheduled backlog */}
      <aside className="2xl:w-72 2xl:flex-none">
        <div
          data-cell="backlog"
          {...dropProps("backlog", { techId: null, date: null })}
          className={clsx(
            "rounded-xl border border-slate-200 bg-white shadow-sm 2xl:sticky 2xl:top-6",
            over === "backlog" && "ring-2 ring-brand-500",
          )}
        >
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold">Unscheduled</p>
            <p className="text-xs text-slate-500">{backlog.length} open job{backlog.length === 1 ? "" : "s"} without a date</p>
            <div className="mt-2 flex items-center gap-2 rounded-lg px-2 ring-1 ring-slate-200">
              <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-full border-0 py-1.5 text-sm focus:ring-0" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className="flex-1 rounded-lg border-0 py-1 pl-2 text-xs ring-1 ring-slate-200">
                <option value="">All sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} className="rounded border-slate-300" />
                Unassigned
              </label>
            </div>
          </div>
          <div className="grid max-h-[70vh] grid-cols-1 gap-1.5 overflow-y-auto p-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-1">
            {backlog.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-slate-500">Everything open is on the calendar.</p>
            ) : (
              backlog.map((j) => card(j, { showTech: true }))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
