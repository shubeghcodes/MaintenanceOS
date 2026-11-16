import Link from "next/link";
import clsx from "clsx";
import { requireRole } from "@/lib/auth";
import { fmtDate, personName, todayISO } from "@/lib/format";
import { TIME_OFF_LABEL, WEEKDAYS, type TimeOffEntry } from "@/lib/time-off";
import { Alert, Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { addTimeOff, deleteTimeOff, saveWorkDays } from "./actions";

export const metadata = { title: "Days off" };

const KIND_TONE = { vacation: "info", sick: "serious", personal: "neutral", holiday: "good", other: "muted" } as const;

export default async function TimeOffPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin");
  const today = todayISO();
  const [{ data: techData }, { data: wdData }, { data: offData }] = await Promise.all([
    supabase.from("profiles").select("id,full_name,email").eq("active", true).eq("role", "tech").order("full_name"),
    supabase.from("tech_work_days").select("user_id,days_off"),
    supabase.from("tech_time_off").select("id,user_id,start_date,end_date,kind,note").gte("end_date", sp.past ? "1900-01-01" : today).order("start_date"),
  ]);
  const techs = (techData ?? []) as { id: string; full_name: string | null; email: string | null }[];
  const daysOff = new Map(((wdData ?? []) as { user_id: string; days_off: number[] }[]).map((r) => [r.user_id, r.days_off]));
  const entries = ((offData ?? []) as TimeOffEntry[]).filter((e) => !sp.tech || e.user_id === sp.tech);
  const nameOf = (id: string) => personName(techs.find((t) => t.id === id) ?? { full_name: "Former tech", email: null });
  const days = (e: TimeOffEntry) => Math.round((Date.parse(e.end_date) - Date.parse(e.start_date)) / 864e5) + 1;

  return (
    <>
      <PageHeader
        title="Days off"
        subtitle="The schedule shows these days as Off, and automatic PM scheduling works around them."
        back={{ href: "/schedule", label: "Schedule" }}
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.added && <Alert tone="good">Time off added.</Alert>}
      {sp.removed && <Alert tone="good">Time off removed.</Alert>}
      {sp.days && <Alert tone="good">Regular days off saved.</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title={sp.past ? "All time off" : "Upcoming time off"}
              subtitle={sp.tech ? `For ${nameOf(sp.tech)}` : undefined}
              action={
                <span className="flex gap-3 text-xs font-medium">
                  {sp.tech && (
                    <Link href={`/schedule/time-off${sp.past ? "?past=1" : ""}`} className="text-brand-700">
                      All techs
                    </Link>
                  )}
                  <Link href={`/schedule/time-off?${new URLSearchParams({ ...(sp.tech ? { tech: sp.tech } : {}), ...(sp.past ? {} : { past: "1" }) })}`} className="text-brand-700">
                    {sp.past ? "Upcoming only" : "Include past"}
                  </Link>
                </span>
              }
            />
            {entries.length === 0 ? (
              <EmptyState title="No time off scheduled.">Add vacations, sick days and holidays on the right.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {entries.map((e) => {
                  const now = e.start_date <= today && e.end_date >= today;
                  const past = e.end_date < today;
                  return (
                    <li key={e.id} className={clsx("flex flex-wrap items-center gap-3 px-5 py-3", past && "opacity-60")}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">
                          {nameOf(e.user_id)}
                          {now && <span className="ml-2 text-xs font-medium text-amber-700">Off today</span>}
                        </p>
                        <p className="text-xs text-slate-500">
                          {e.start_date === e.end_date ? fmtDate(e.start_date) : `${fmtDate(e.start_date)} – ${fmtDate(e.end_date)}`} · {days(e)} day
                          {days(e) === 1 ? "" : "s"}
                          {e.note && ` · ${e.note}`}
                        </p>
                      </div>
                      <Badge tone={KIND_TONE[e.kind]} dot={false}>
                        {TIME_OFF_LABEL[e.kind]}
                      </Badge>
                      <form action={deleteTimeOff}>
                        <input type="hidden" name="id" value={e.id} />
                        <SubmitButton size="sm" variant="ghost" confirm={`Remove ${nameOf(e.user_id)}'s ${TIME_OFF_LABEL[e.kind].toLowerCase()}?`}>
                          Remove
                        </SubmitButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Regular days off" subtitle="Days each tech never works. Tick the days off." />
            {techs.length === 0 ? (
              <EmptyState title="No technicians yet." />
            ) : (
              <form action={saveWorkDays}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                      <tr>
                        <th className="px-5 py-2 text-left">Technician</th>
                        {WEEKDAYS.map((d) => (
                          <th key={d} className="w-12 px-1 py-2 text-center">
                            {d}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {techs.map((t) => {
                        const off = daysOff.get(t.id) ?? [];
                        return (
                          <tr key={t.id}>
                            <td className="px-5 py-2.5 font-medium text-slate-800">
                              <input type="hidden" name="tech" value={t.id} />
                              {personName(t)}
                            </td>
                            {WEEKDAYS.map((d, i) => (
                              <td key={d} className="px-1 py-2.5 text-center">
                                <input
                                  type="checkbox"
                                  name={`off_${t.id}`}
                                  value={i}
                                  defaultChecked={off.includes(i)}
                                  aria-label={`${personName(t)} off on ${d}`}
                                  className="h-4 w-4 rounded border-slate-300 text-amber-600"
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end border-t border-slate-100 bg-slate-50/60 px-5 py-3">
                  <SubmitButton size="sm">Save regular days off</SubmitButton>
                </div>
              </form>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Add time off" />
          <form action={addTimeOff} className="space-y-4 p-5">
            <Field label="Technician" hint="Hold Ctrl / ⌘ to pick several (e.g. a holiday for everyone).">
              <Select name="user_id" multiple required defaultValue={sp.tech ? [sp.tech] : []} className="h-32">
                {techs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {personName(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First day off">
                <Input type="date" name="start_date" required defaultValue={today} />
              </Field>
              <Field label="Last day off" hint="Same day for one day">
                <Input type="date" name="end_date" />
              </Field>
            </div>
            <Field label="Type">
              <Select name="kind" defaultValue="vacation">
                {Object.entries(TIME_OFF_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note (optional)">
              <Input name="note" placeholder="Family trip" />
            </Field>
            <SubmitButton>Add time off</SubmitButton>
            <p className="text-xs text-slate-500">
              Jobs already on the calendar for those days stay put; the schedule flags them so you can move them.
            </p>
          </form>
        </Card>
      </div>
    </>
  );
}
