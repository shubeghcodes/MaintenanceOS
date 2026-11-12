import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, MapPin, Navigation, Phone, Receipt } from "lucide-react";
import { getSession } from "@/lib/auth";
import { OPEN_STATUSES } from "@/lib/constants";
import { addDaysISO, dayLabel, fmtTime, isISODate, personName, relativeDue, dueWhen, todayISO } from "@/lib/format";
import type { WoPriority, WoStatus, WoType } from "@/lib/types";
import { Alert, Card, CardHeader, EmptyState, PageHeader, Select, Button } from "@/components/ui";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { SubmitButton } from "@/components/SubmitButton";
import { setStatus } from "../work-orders/actions";
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
    supabase.from("work_orders").select(SELECT).eq("assigned_tech_id", techId).is("scheduled_date", null).in("status", OPEN_STATUSES).order("due_at").limit(20),
    profile.role === "admin"
      ? supabase.from("profiles").select("id,full_name,email").in("role", ["tech", "admin"]).eq("active", true).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
  ]);
  const jobs = (dayData ?? []) as unknown as Job[];
  const unscheduled = (otherData ?? []) as unknown as Job[];
  const techs = (techData ?? []) as { id: string; full_name: string | null; email: string | null }[];
  const hours = jobs.reduce((s, j) => s + Number(j.estimated_hours || 0), 0);
  const done = jobs.filter((j) => j.status === "completed").length;
  const nav = (d: string) => `/my-day?date=${d}${!isMe ? `&tech=${techId}` : ""}`;
  const techLabel = isMe ? "My day" : `${personName(techs.find((t) => t.id === techId))}’s day`;

  return (
    <>
      <PageHeader
        title={techLabel}
        subtitle={`${dayLabel(date, "long")} · ${jobs.length} job${jobs.length === 1 ? "" : "s"}${hours ? ` · ~${hours}h` : ""}${jobs.length ? ` · ${done} done` : ""}`}
        actions={
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
        }
      />
      {sp.error && <Alert>{sp.error}</Alert>}

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
            const closed = j.status === "completed";
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
                        {isMe && (j.status === "assigned" || j.status === "new" || j.status === "on_hold") && (
                          <form>
                            <input type="hidden" name="id" value={j.id} />
                            <SubmitButton size="sm" variant="secondary" formAction={setStatus.bind(null, "in_progress")} pendingText="Starting…">
                              Start work
                            </SubmitButton>
                          </form>
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
