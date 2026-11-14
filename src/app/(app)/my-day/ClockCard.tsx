"use client";

import { useRef, useState } from "react";
import { Coffee, LogIn, LogOut, MapPin, Play } from "lucide-react";
import { TimerClock } from "@/components/TimerClock";
import { clockIn, clockOut, lunchEnd, lunchStart } from "./clock-actions";

export type ClockJob = { id: string; number: number; title: string; site: string | null; open: boolean; today?: boolean };
/** staleDate: the YYYY-MM-DD the shift started on, when that was before today (forgot to clock out). */
export type OpenShift = {
  clock_in_at: string;
  firstLabel: string;
  staleDate: string | null;
  staleLabel: string | null;
  clockInTime: string;
  /** Set while on lunch. */
  lunch: { since: string; sinceTime: string } | null;
  /** Lunch already taken this shift, in minutes. */
  lunchMinutes: number;
};

const NO_JOB_REASONS = ["Shop", "Parts run", "Training", "Meeting", "Other"];

/**
 * Clock in: pick the first work order (starts its timer) or a reason.
 * Clock out: pick the last work order and say whether it's finished.
 * Location is captured at each punch if the phone allows it; it never blocks the punch.
 */
export function ClockCard({
  shift,
  jobs,
  lastJobId,
  preselectJobId,
}: {
  shift: OpenShift | null;
  jobs: ClockJob[];
  lastJobId: string | null;
  preselectJobId: string | null;
}) {
  const [open, setOpen] = useState(!!preselectJobId || !!shift?.staleDate);
  const [pick, setPick] = useState<string>(shift ? (lastJobId ?? jobs[0]?.id ?? "none") : (preselectJobId ?? jobs.find((j) => j.open)?.id ?? "none"));
  const [finished, setFinished] = useState<"yes" | "no">("no");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const located = useRef(false);
  const job = jobs.find((j) => j.id === pick);

  // Grab the location once, then submit for real. A refusal or timeout just submits without it.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (located.current) return;
    e.preventDefault();
    setBusy(true);
    const form = e.currentTarget;
    const done = () => {
      located.current = true;
      form.requestSubmit();
    };
    if (!("geolocation" in navigator)) return done();
    navigator.geolocation.getCurrentPosition(
      (p) => {
        (form.elements.namedItem("lat") as HTMLInputElement).value = String(p.coords.latitude);
        (form.elements.namedItem("lng") as HTMLInputElement).value = String(p.coords.longitude);
        (form.elements.namedItem("accuracy") as HTMLInputElement).value = String(Math.round(p.coords.accuracy));
        done();
      },
      done,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  };

  const select = (
    <select
      name="work_order_id"
      value={pick}
      onChange={(e) => setPick(e.target.value)}
      className="block w-full rounded-lg border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
    >
      {jobs.map((j) => (
        <option key={j.id} value={j.id}>
          #{j.number} {j.title}
          {j.site ? ` · ${j.site}` : ""}
          {j.today ? " (today)" : ""}
        </option>
      ))}
      <option value="none">No work order (shop, parts run, training…)</option>
    </select>
  );

  const reasonSelect = pick === "none" && (
    <select name="reason" defaultValue="" required className="mt-2 block w-full rounded-lg border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-300">
      <option value="" disabled>
        Why no work order?
      </option>
      {NO_JOB_REASONS.map((r) => (
        <option key={r}>{r}</option>
      ))}
    </select>
  );

  const hidden = (
    <>
      <input type="hidden" name="lat" />
      <input type="hidden" name="lng" />
      <input type="hidden" name="accuracy" />
    </>
  );

  if (!shift) {
    return (
      <div id="clock" className="mb-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        {!open ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">You&apos;re clocked out</p>
              <p className="text-xs text-slate-500">Clock in on your first job to start your day.</p>
            </div>
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
              <LogIn className="h-4 w-4" aria-hidden /> Clock in
            </button>
          </div>
        ) : (
          <form ref={formRef} action={clockIn} onSubmit={onSubmit} className="space-y-3">
            <p className="text-sm font-semibold text-slate-900">Clock in: what&apos;s your first job?</p>
            {select}
            {reasonSelect}
            {hidden}
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <MapPin className="h-3.5 w-3.5" aria-hidden /> Your location is saved with this punch only.
              {pick !== "none" && " The job's timer starts now."}
            </p>
            <div className="flex gap-2">
              <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
                <LogIn className="h-4 w-4" aria-hidden /> {busy ? "Clocking in…" : "Clock in"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  if (shift.lunch && !shift.staleDate) {
    return (
      <div id="clock" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-950">
            <Coffee className="h-4 w-4" aria-hidden /> On lunch since {shift.lunch.sinceTime}
          </p>
          <p className="text-xs text-amber-900">Your job timer is paused. It picks up again when you end lunch.</p>
        </div>
        <TimerClock worked={0} resumedAt={shift.lunch.since} className="font-mono text-xl font-semibold tabular-nums text-amber-950" />
        <form action={lunchEnd}>
          <button className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
            <Play className="h-4 w-4" aria-hidden /> End lunch
          </button>
        </form>
      </div>
    );
  }

  return (
    <div id="clock" className={`mb-4 rounded-xl p-4 ring-1 ${shift.staleDate ? "bg-red-50 ring-red-200" : "bg-emerald-50 ring-emerald-200"}`}>
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Clocked in since {shift.clockInTime}</p>
            <p className="text-xs text-slate-600">
              Started on {shift.firstLabel}
              {shift.lunchMinutes > 0 && ` · lunch ${shift.lunchMinutes} min`}
            </p>
          </div>
          <TimerClock worked={0} resumedAt={shift.clock_in_at} className="font-mono text-xl font-semibold tabular-nums text-emerald-900" />
          <div className="flex flex-wrap gap-2">
            <form action={lunchStart}>
              <button className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-amber-900 shadow-sm ring-1 ring-inset ring-amber-300 hover:bg-amber-50">
                <Coffee className="h-4 w-4" aria-hidden /> Start lunch
              </button>
            </form>
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">
              <LogOut className="h-4 w-4" aria-hidden /> Clock out
            </button>
          </div>
        </div>
      ) : (
        <form ref={formRef} action={clockOut} onSubmit={onSubmit} className="space-y-3">
          {shift.staleDate ? (
            <div>
              <p className="text-sm font-semibold text-red-900">You didn&apos;t clock out on {shift.staleLabel}.</p>
              <p className="text-xs text-red-800">Enter the time you actually finished that day.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input type="date" name="out_date" required defaultValue={shift.staleDate} className="rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300" />
                <input type="time" name="out_time" required className="rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300" />
              </div>
            </div>
          ) : (
            <p className="text-sm font-semibold text-slate-900">Clock out: what was your last job?</p>
          )}
          {select}
          {reasonSelect}
          {job?.open && (
            <fieldset className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
              <legend className="px-1 text-sm font-medium text-slate-800">Is this job finished?</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="finished" value="yes" checked={finished === "yes"} onChange={() => setFinished("yes")} /> Yes, it&apos;s done
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="finished" value="no" checked={finished === "no"} onChange={() => setFinished("no")} /> Not yet, coming back
                </label>
              </div>
              {finished === "yes" && (
                <textarea
                  name="resolution_notes"
                  rows={2}
                  placeholder="What did you do? (sent to the store's GM to confirm)"
                  className="mt-2 block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300"
                />
              )}
            </fieldset>
          )}
          {hidden}
          <p className="flex items-center gap-1 text-xs text-slate-500">
            <MapPin className="h-3.5 w-3.5" aria-hidden /> Any running job timer stops when you clock out.
          </p>
          <div className="flex gap-2">
            <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60">
              <LogOut className="h-4 w-4" aria-hidden /> {busy ? "Clocking out…" : "Clock out"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
