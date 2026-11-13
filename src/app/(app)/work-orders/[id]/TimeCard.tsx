import Link from "next/link";
import { Pause, Play, Square } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDate, fmtDateTime, fmtMoney, personName, toDateInput, todayISO } from "@/lib/format";
import { ENTRY_COLS, fmtClockTime, fmtHours, secondsNow, toTimeInput, type EntryCost, type TimeEntry } from "@/lib/labor";
import type { Profile } from "@/lib/types";
import { Badge, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { TimerClock } from "@/components/TimerClock";
import { addManualTime, changeTimer, editTime, startTimer, voidTime } from "../time-actions";

type Person = { id: string; full_name: string | null; email: string | null };
type Entry = TimeEntry & { user: { full_name: string | null; email: string | null } | null };

export async function TimeCard({
  supabase,
  woId,
  woStatus,
  visit,
  profile,
  techs,
}: {
  supabase: SupabaseClient;
  woId: string;
  woStatus: string;
  visit: number;
  profile: Profile;
  techs: Person[];
}) {
  const isAdmin = profile.role === "admin";
  const superAdmin = isAdmin && !!profile.is_super; // only super admins see hourly rates
  const canTime = isAdmin || profile.role === "tech";
  const [{ data: eData, error }, { data: cData }, { data: aData }] = await Promise.all([
    supabase.from("time_entries").select(`${ENTRY_COLS}, user:profiles!time_entries_user_id_fkey(full_name,email)`).eq("work_order_id", woId).order("started_at"),
    isAdmin ? supabase.from("time_entry_costs").select("entry_id,hours,hourly_rate,cost_override,labor_cost").eq("work_order_id", woId) : Promise.resolve({ data: [] }),
    isAdmin
      ? supabase.from("time_entry_audit").select("id,action,reason,before,after,changed_at,by:profiles!time_entry_audit_changed_by_fkey(full_name,email)").eq("work_order_id", woId).order("changed_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  if (error) return null; // time tracking not set up yet (migration 0011)

  const entries = (eData ?? []) as unknown as Entry[];
  const costs = new Map(((cData ?? []) as EntryCost[]).map((c) => [c.entry_id, c]));
  const audit = (aData ?? []) as unknown as {
    id: string;
    action: string;
    reason: string;
    before: Partial<TimeEntry> | null;
    after: Partial<TimeEntry> | null;
    changed_at: string;
    by: { full_name: string | null; email: string | null } | null;
  }[];
  const live = entries.filter((e) => e.status !== "void");
  const mine = entries.find((e) => e.user_id === profile.id && (e.status === "running" || e.status === "paused"));
  const closed = woStatus === "completed" || woStatus === "cancelled" || woStatus === "awaiting_signoff";
  const now = Date.now();
  const totalHours = live.reduce((t, e) => t + secondsNow(e, now) / 3600, 0);
  const totalCost = live.reduce((t, e) => t + Number(costs.get(e.id)?.labor_cost ?? 0), 0);
  const missingRate = isAdmin && live.some((e) => e.worked_seconds > 0 && !costs.get(e.id)?.hourly_rate && costs.get(e.id)?.cost_override == null);
  const visits = [...new Set(entries.map((e) => e.visit))].sort((a, b) => a - b);
  const back = `/work-orders/${woId}#time`;

  return (
    <Card id="time" className="scroll-mt-6">
      <CardHeader
        title="Time & labor"
        subtitle={`Visit ${visit}${visits.length ? ` · ${fmtHours(totalHours)} hrs logged` : ""}${isAdmin && totalCost ? ` · ${fmtMoney(totalCost, 2)}` : ""}`}
      />
      <div className="space-y-4 p-5">
        {/* My timer */}
        {canTime &&
          (mine ? (
            <div className={`flex flex-wrap items-center gap-3 rounded-lg p-3 ring-1 ring-inset ${mine.status === "running" ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200"}`}>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-600">{mine.status === "running" ? "Your timer is running" : "Your timer is paused"} · visit {mine.visit}</p>
                <TimerClock worked={mine.worked_seconds} resumedAt={mine.status === "running" ? mine.last_resumed_at : null} className="font-mono text-2xl font-semibold tabular-nums text-slate-900" />
                <p className="text-xs text-slate-500">Started {fmtClockTime(mine.started_at)}{mine.pause_count ? ` · paused ${mine.pause_count}×` : ""}</p>
              </div>
              <form className="flex gap-2">
                <input type="hidden" name="entry_id" value={mine.id} />
                <input type="hidden" name="work_order_id" value={woId} />
                <input type="hidden" name="back" value={back} />
                {mine.status === "running" ? (
                  <SubmitButton size="sm" variant="secondary" formAction={changeTimer.bind(null, "pause")} pendingText="…">
                    <Pause className="h-3.5 w-3.5" aria-hidden /> Pause
                  </SubmitButton>
                ) : (
                  <SubmitButton size="sm" variant="secondary" formAction={changeTimer.bind(null, "resume")} pendingText="…">
                    <Play className="h-3.5 w-3.5" aria-hidden /> Resume
                  </SubmitButton>
                )}
                <SubmitButton size="sm" formAction={changeTimer.bind(null, "stop")} pendingText="…" confirm="Stop your timer for this visit?">
                  <Square className="h-3.5 w-3.5" aria-hidden /> Stop
                </SubmitButton>
              </form>
            </div>
          ) : closed ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
              {woStatus === "awaiting_signoff"
                ? "Work is done and waiting for the GM's sign-off. If it isn't fixed, the GM sends it back and you can log a return visit."
                : woStatus === "completed"
                  ? "Work order is completed. Reopen it to log a return visit; earlier time is kept."
                  : "Work order is cancelled."}
            </p>
          ) : (
            <form action={startTimer} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="work_order_id" value={woId} />
              <input type="hidden" name="back" value={back} />
              <SubmitButton pendingText="Starting…">
                <Play className="h-4 w-4" aria-hidden /> {visit > 1 && entries.length ? `Start timer · return visit ${visit}` : "Start timer"}
              </SubmitButton>
              <span className="text-xs text-slate-500">Starting here pauses any other timer you have running.</span>
            </form>
          ))}

        {/* Entries by visit */}
        {visits.length === 0 ? (
          <p className="text-sm text-slate-500">No time logged yet.</p>
        ) : (
          visits.map((v) => {
            const rows = entries.filter((e) => e.visit === v);
            const vHours = rows.filter((e) => e.status !== "void").reduce((t, e) => t + secondsNow(e, now) / 3600, 0);
            const vCost = rows.filter((e) => e.status !== "void").reduce((t, e) => t + Number(costs.get(e.id)?.labor_cost ?? 0), 0);
            return (
              <div key={v} className="rounded-lg ring-1 ring-inset ring-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                  <span>{v === 1 ? "Visit 1 · original" : `Visit ${v} · return visit`}</span>
                  <span className="tabular-nums">
                    {fmtHours(vHours)} hrs{isAdmin && ` · ${fmtMoney(vCost, 2)}`}
                  </span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {rows.map((e) => {
                    const c = costs.get(e.id);
                    const void_ = e.status === "void";
                    return (
                      <li key={e.id} className={`px-3 py-2 text-sm ${void_ ? "opacity-50" : ""}`}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-[8rem] font-medium text-slate-900">{e.user ? personName(e.user) : "Unassigned"}</span>
                          <span className="text-xs text-slate-500">
                            {fmtDate(e.started_at)} · {fmtClockTime(e.started_at)}–{e.ended_at ? fmtClockTime(e.ended_at) : "now"}
                          </span>
                          {e.status === "running" && <Badge tone="good">Running</Badge>}
                          {e.status === "paused" && <Badge tone="warning">Paused</Badge>}
                          {e.source === "manual" && !void_ && <Badge tone="muted" dot={false}>Manual</Badge>}
                          {void_ && <Badge tone="muted" dot={false}>Voided</Badge>}
                          <span className="ml-auto text-right tabular-nums">
                            {e.status === "running" ? (
                              <TimerClock worked={e.worked_seconds} resumedAt={e.last_resumed_at} className="font-mono" />
                            ) : (
                              <>{fmtHours(e.worked_seconds / 3600)} hrs</>
                            )}
                            {isAdmin && c && !void_ && (
                              <span className="block text-xs text-slate-500">
                                {c.cost_override != null ? "imported · " : c.hourly_rate == null ? <span className="text-orange-700">no rate · </span> : superAdmin ? `@ ${fmtMoney(c.hourly_rate, 2)}/hr · ` : ""}
                                {fmtMoney(c.labor_cost, 2)}
                              </span>
                            )}
                          </span>
                        </div>
                        {e.note && <p className="mt-0.5 text-xs text-slate-500">{e.note}</p>}
                        {isAdmin && !void_ && (
                          <div className="mt-1 flex flex-wrap gap-3">
                            {(e.status === "running" || e.status === "paused") && e.user_id !== profile.id && (
                              <form action={changeTimer.bind(null, "stop")}>
                                <input type="hidden" name="entry_id" value={e.id} />
                                <input type="hidden" name="work_order_id" value={woId} />
                                <input type="hidden" name="back" value={back} />
                                <SubmitButton size="sm" variant="ghost" confirm="Stop this technician's timer? It will be logged.">
                                  Stop timer
                                </SubmitButton>
                              </form>
                            )}
                            {e.status === "stopped" && (
                              <details className="w-full">
                                <summary className="cursor-pointer text-xs font-medium text-brand-700">Adjust or void</summary>
                                <form action={editTime} className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-6">
                                  <input type="hidden" name="entry_id" value={e.id} />
                                  <input type="hidden" name="work_order_id" value={woId} />
                                  <Field label="Start date" className="sm:col-span-2">
                                    <Input type="date" name="date" defaultValue={toDateInput(e.started_at)} required />
                                  </Field>
                                  <Field label="Start" className="sm:col-span-1">
                                    <Input type="time" name="start" defaultValue={toTimeInput(e.started_at)} required />
                                  </Field>
                                  <Field label="End date" className="sm:col-span-2">
                                    <Input type="date" name="end_date" defaultValue={toDateInput(e.ended_at ?? e.started_at)} required />
                                  </Field>
                                  <Field label="End" className="sm:col-span-1">
                                    <Input type="time" name="end" defaultValue={toTimeInput(e.ended_at)} required />
                                  </Field>
                                  <Field label="Hours worked" hint="Blank = end − start" className="sm:col-span-2">
                                    <Input name="hours" inputMode="decimal" placeholder={fmtHours(e.worked_seconds / 3600)} />
                                  </Field>
                                  <Field label="Reason (required)" className="sm:col-span-4">
                                    <Input name="reason" required placeholder="e.g. Tech forgot to stop the timer" />
                                  </Field>
                                  <div className="sm:col-span-6">
                                    <SubmitButton size="sm" variant="secondary">Save adjustment</SubmitButton>
                                  </div>
                                </form>
                                <form action={voidTime} className="mt-2 flex gap-2">
                                  <input type="hidden" name="entry_id" value={e.id} />
                                  <input type="hidden" name="work_order_id" value={woId} />
                                  <Input name="reason" required placeholder="Reason to void (required)" />
                                  <SubmitButton size="sm" variant="danger" confirm="Void this time entry? It stays in the history but no longer counts.">
                                    Void
                                  </SubmitButton>
                                </form>
                              </details>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}

        {visits.length > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-600">Total labor</span>
            <span className="font-semibold tabular-nums">
              {fmtHours(totalHours)} hrs{isAdmin && ` · ${fmtMoney(totalCost, 2)}`}
            </span>
          </div>
        )}
        {missingRate && (
          <p className="text-xs text-orange-700">
            Some time has no hourly rate, so it&apos;s costed at $0.{" "}
            {superAdmin ? (
              <>
                Set the rate on <Link className="font-medium underline" href="/admin/users">Users</Link> and it recalculates automatically.
              </>
            ) : (
              "A super admin can set it on Users; the cost recalculates automatically."
            )}
          </p>
        )}

        {isAdmin && (
          <details className="rounded-lg ring-1 ring-slate-200">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">+ Add time manually</summary>
            <form action={addManualTime} className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-6">
              <input type="hidden" name="work_order_id" value={woId} />
              <Field label="Technician" className="sm:col-span-3">
                <Select name="user_id" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {techs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {personName(t)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date" className="sm:col-span-3">
                <Input type="date" name="date" required defaultValue={todayISO()} />
              </Field>
              <Field label="Start" className="sm:col-span-2">
                <Input type="time" name="start" required />
              </Field>
              <Field label="End" className="sm:col-span-2">
                <Input type="time" name="end" required />
              </Field>
              <Field label="Hours worked" hint="Blank = end − start" className="sm:col-span-2">
                <Input name="hours" inputMode="decimal" />
              </Field>
              <Field label="Reason (required)" className="sm:col-span-6">
                <Input name="reason" required placeholder="e.g. Timer not started on site" />
              </Field>
              <div className="sm:col-span-6">
                <SubmitButton size="sm" variant="secondary">Add time</SubmitButton>
                <span className="ml-2 text-xs text-slate-500">Logged to visit {visit}. Recorded in the adjustment history.</span>
              </div>
            </form>
          </details>
        )}

        {isAdmin && audit.length > 0 && (
          <details className="rounded-lg ring-1 ring-slate-200">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">Adjustment history ({audit.length})</summary>
            <ul className="divide-y divide-slate-100 border-t border-slate-100 text-xs">
              {audit.map((a) => {
                const span = (x: Partial<TimeEntry> | null) =>
                  x?.started_at ? `${fmtDateTime(x.started_at)}–${x.ended_at ? fmtClockTime(x.ended_at) : "…"} (${fmtHours((x.worked_seconds ?? 0) / 3600)} h)` : "";
                return (
                  <li key={a.id} className="px-3 py-2">
                    <p>
                      <b>{{ manual_add: "Added time", edit: "Adjusted time", void: "Voided time", admin_stop: "Stopped a timer" }[a.action] ?? a.action}</b> by {personName(a.by)} ·{" "}
                      {fmtDateTime(a.changed_at)}
                    </p>
                    <p className="text-slate-600">Reason: {a.reason}</p>
                    {(a.before || a.after) && (
                      <p className="text-slate-500">
                        {a.before && <>Before: {span(a.before)} </>}
                        {a.after && <>→ After: {span(a.after)}</>}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}
