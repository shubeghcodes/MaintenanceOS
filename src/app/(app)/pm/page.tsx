import Link from "next/link";
import { Plus } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { daysUntil, fmtDate, fmtFreq, personName, relativeDue } from "@/lib/format";
import type { PmSchedule } from "@/lib/types";
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { PriorityBadge } from "@/components/badges";
import { RunSchedulerButton } from "./RunSchedulerButton";

export const metadata = { title: "Preventive maintenance" };

type Row = PmSchedule & {
  site: { name: string; code: string | null } | null;
  asset: { id: string; name: string } | null;
  vendor: { name: string } | null;
  tech: { full_name: string | null; email: string | null } | null;
};

export default async function PmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  const { sites } = await getLookups(supabase);

  let q = supabase
    .from("pm_schedules")
    .select("*, site:sites(name,code), asset:assets(id,name), vendor:vendors(name), tech:profiles(full_name,email)")
    .order("next_due_on");
  if (sp.site) q = q.eq("site_id", sp.site);
  if (sp.show !== "all") q = q.eq("active", true);
  const { data, error } = await q;
  const rows = (data ?? []) as unknown as Row[];
  const isAdmin = profile.role === "admin";

  return (
    <>
      <PageHeader
        title="Preventive maintenance"
        subtitle="Recurring schedules create work orders automatically before they’re due."
        actions={
          isAdmin && (
            <>
              <RunSchedulerButton back="/pm" />
              <ButtonLink href="/pm/new">
                <Plus className="h-4 w-4" aria-hidden /> New schedule
              </ButtonLink>
            </>
          )
        }
      />
      {sp.generated && (
        <Alert tone="good">
          Scheduler ran — {sp.generated} work order{sp.generated === "1" ? "" : "s"} created.
        </Alert>
      )}
      {(sp.error || error) && <Alert>{sp.error ?? error?.message}</Alert>}

      <Card className="mb-4 p-3">
        <form className="flex flex-wrap gap-2">
          <Select name="site" defaultValue={sp.site ?? ""} className="w-auto">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ?? s.name}
              </option>
            ))}
          </Select>
          <Select name="show" defaultValue={sp.show ?? ""} className="w-auto">
            <option value="">Active only</option>
            <option value="all">Include paused</option>
          </Select>
          <Button variant="secondary" type="submit">
            Filter
          </Button>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No PM schedules yet.">{isAdmin && "Create one for each recurring task — filters, coil cleaning, boil-outs."}</EmptyState>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Schedule</Th>
                <Th>Site</Th>
                <Th>Frequency</Th>
                <Th>Next due</Th>
                <Th>Assigned</Th>
                <Th>Priority</Th>
                <Th>Last done</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => {
                const d = daysUntil(p.next_due_on) ?? 0;
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td>
                      <Link href={`/pm/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {p.title}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {p.asset?.name ?? "Site-wide"} · {p.category}
                        {!p.active && " · paused"}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">{p.site?.code ?? p.site?.name}</Td>
                    <Td className="whitespace-nowrap">{fmtFreq(p.frequency_interval, p.frequency_unit)}</Td>
                    <Td className="whitespace-nowrap">
                      <div>{fmtDate(p.next_due_on)}</div>
                      <Badge tone={d < 0 ? "critical" : d <= p.lead_days ? "warning" : "neutral"} dot={d <= p.lead_days}>
                        {relativeDue(p.next_due_on)}
                      </Badge>
                    </Td>
                    <Td className="text-xs">{p.tech ? personName(p.tech) : p.vendor?.name ?? <span className="text-slate-400">Unassigned</span>}</Td>
                    <Td>
                      <PriorityBadge priority={p.priority} />
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{fmtDate(p.last_completed_on)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
