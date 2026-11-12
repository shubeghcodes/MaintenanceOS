import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { fmtDate, fmtFreq, isOverdue, personName, relativeDue } from "@/lib/format";
import type { PmSchedule, WoStatus } from "@/lib/types";
import { Alert, Card, CardHeader, DefList, EmptyState, PageHeader, Stat } from "@/components/ui";
import { StatusBadge } from "@/components/badges";
import { SubmitButton } from "@/components/SubmitButton";
import { PmForm } from "../PmForm";
import { deletePm } from "../actions";

export default async function PmDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await getSession();

  const { data } = await supabase
    .from("pm_schedules")
    .select("*, site:sites(id,name), asset:assets(id,name), vendor:vendors(name), tech:profiles(full_name,email)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const pm = data as unknown as PmSchedule & {
    site: { id: string; name: string } | null;
    asset: { id: string; name: string } | null;
    vendor: { name: string } | null;
    tech: { full_name: string | null; email: string | null } | null;
  };
  const isAdmin = profile.role === "admin";

  const [{ data: woData }, lookups] = await Promise.all([
    supabase
      .from("work_orders")
      .select("id,number,status,due_at,completed_at")
      .eq("pm_schedule_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    isAdmin ? getLookups(supabase, { assets: true }) : Promise.resolve(null),
  ]);
  const wos = (woData ?? []) as { id: string; number: number; status: WoStatus; due_at: string | null; completed_at: string | null }[];
  const done = wos.filter((w) => w.status === "completed");
  const onTime = done.filter((w) => !w.due_at || (w.completed_at && w.completed_at <= w.due_at));

  return (
    <>
      <PageHeader title={pm.title} subtitle={`${pm.site?.name} · ${fmtFreq(pm.frequency_interval, pm.frequency_unit)}`} back={{ href: "/pm", label: "Preventive maintenance" }} />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.saved && <Alert tone="good">Schedule saved.</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Next due" value={relativeDue(pm.next_due_on)} sub={fmtDate(pm.next_due_on)} />
        <Stat label="Work orders" value={wos.length} sub={`${done.length} completed`} />
        <Stat label="On-time rate" value={done.length ? `${Math.round((onTime.length / done.length) * 100)}%` : "—"} sub="Completed by due date" />
        <Stat label="Last completed" value={pm.last_completed_on ? fmtDate(pm.last_completed_on) : "—"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {isAdmin && lookups ? (
            <PmForm pm={pm} lookups={lookups} />
          ) : (
            <Card>
              <CardHeader title="Schedule" />
              <DefList
                items={[
                  ["Asset", pm.asset ? <Link href={`/assets/${pm.asset.id}`} className="text-brand-700">{pm.asset.name}</Link> : "Site-wide"],
                  ["Category", pm.category],
                  ["Assigned", pm.tech ? personName(pm.tech) : pm.vendor?.name ?? "—"],
                  ["Lead time", `${pm.lead_days} days`],
                ]}
              />
              {pm.instructions && <p className="whitespace-pre-wrap border-t border-slate-100 px-5 py-4 text-sm">{pm.instructions}</p>}
              {pm.checklist.length > 0 && (
                <ul className="list-inside list-disc border-t border-slate-100 px-5 py-4 text-sm">
                  {pm.checklist.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Generated work orders" />
            {wos.length === 0 ? (
              <EmptyState title="None yet.">The first one is created {pm.lead_days} days before the due date.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {wos.map((w) => (
                  <li key={w.id}>
                    <Link href={`/work-orders/${w.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 hover:bg-slate-50">
                      <span className="font-mono text-xs text-slate-500">#{w.number}</span>
                      <span className="flex-1 text-xs text-slate-600">due {fmtDate(w.due_at)}</span>
                      {isOverdue(w.due_at, w.status) && <span className="text-xs font-medium text-red-700">late</span>}
                      <StatusBadge status={w.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {isAdmin && (
            <form action={deletePm} className="text-right">
              <input type="hidden" name="id" value={id} />
              <SubmitButton size="sm" variant="ghost" confirm="Delete this PM schedule? Existing work orders are kept.">
                Delete schedule
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
