import Link from "next/link";
import { AutoSubmit } from "@/components/AutoSubmit";
import { requireRole } from "@/lib/auth";
import { getCompanyScope } from "@/lib/company";
import { getLookups } from "@/lib/data";
import { PART_READY_WHERE, PART_STATUS_LABEL, PART_STATUS_TONE, type PartStatus } from "@/lib/constants";
import { fmtDate, fmtMoney, personName, todayISO } from "@/lib/format";
import { Badge, Button, Card, EmptyState, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Parts" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  part_number: string | null;
  quantity: number;
  status: PartStatus;
  est_cost: number | null;
  cost: number | null;
  supplier: string | null;
  eta: string | null;
  ready_location: string | null;
  requested_at: string;
  requester: { id: string; full_name: string | null; email: string | null } | null;
  wo: { id: string; number: number; title: string; status: string; company_id: string | null; assigned_tech_id: string | null; site: { id: string; name: string; code: string | null } | null };
};

const QUEUES: Record<string, { label: string; statuses: PartStatus[] }> = {
  open: { label: "All open", statuses: ["requested", "approved", "ordered", "ready"] },
  to_order: { label: "To order", statuses: ["requested", "approved"] },
  ordered: { label: "On order", statuses: ["ordered"] },
  ready: { label: "Ready to install", statuses: ["ready"] },
  done: { label: "Installed", statuses: ["installed"] },
  cancelled: { label: "Cancelled", statuses: ["cancelled"] },
};

/** Every part across work orders: what needs ordering, what's late, what's sitting ready. */
export default async function PartsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireRole("admin", "tech");
  const t = await getT();
  const L = t.locale;
  const queue = sp.q && QUEUES[sp.q] ? sp.q : "open";
  const isAdmin = profile.role === "admin";
  const mine = !isAdmin && sp.mine !== "0";
  const scope = await getCompanyScope();

  let q = supabase
    .from("wo_parts")
    .select(
      "id,name,part_number,quantity,status,est_cost,cost,supplier,eta,ready_location,requested_at," +
        "requester:profiles!wo_parts_requested_by_fkey(id,full_name,email)," +
        "wo:work_orders!inner(id,number,title,status,company_id,site_id,assigned_tech_id,site:sites(id,name,code))",
    )
    .in("status", QUEUES[queue].statuses)
    .order("requested_at", { ascending: queue === "open" || queue === "to_order" })
    .limit(500);
  if (scope.companyId) q = q.eq("wo.company_id", scope.companyId);
  if (sp.site) q = q.eq("wo.site_id", sp.site);
  if (mine) q = q.eq("wo.assigned_tech_id", profile.id);
  const [{ data, error }, { sites }, { data: limits }] = await Promise.all([q, getLookups(supabase), supabase.from("companies").select("id,parts_approval_limit")]);
  const rows = (data ?? []) as unknown as Row[];
  const limitFor = new Map(((limits ?? []) as { id: string; parts_approval_limit: number }[]).map((c) => [c.id, Number(c.parts_approval_limit)]));
  const needsApproval = (r: Row) => r.status === "requested" && (r.est_cost == null || Number(r.est_cost) > (limitFor.get(r.wo.company_id ?? "") ?? 250));
  const today = todayISO();
  const late = (r: Row) => r.status === "ordered" && !!r.eta && r.eta < today;

  // Counts for the tiles always cover every open part in scope (same filters, any queue).
  let cq = supabase.from("wo_parts").select("status,eta,est_cost,wo:work_orders!inner(company_id,site_id,assigned_tech_id)").in("status", QUEUES.open.statuses);
  if (scope.companyId) cq = cq.eq("wo.company_id", scope.companyId);
  if (sp.site) cq = cq.eq("wo.site_id", sp.site);
  if (mine) cq = cq.eq("wo.assigned_tech_id", profile.id);
  const { data: all } = await cq;
  const open = (all ?? []) as unknown as { status: PartStatus; eta: string | null; est_cost: number | null; wo: { company_id: string | null } }[];
  const count = (s: PartStatus[]) => open.filter((p) => s.includes(p.status)).length;
  const approvals = open.filter((p) => p.status === "requested" && (p.est_cost == null || Number(p.est_cost) > (limitFor.get(p.wo.company_id ?? "") ?? 250))).length;
  const lateCount = open.filter((p) => p.status === "ordered" && p.eta && p.eta < today).length;
  const href = (k: string) => {
    const p = new URLSearchParams(Object.entries({ ...sp, q: k }).filter(([, v]) => v) as [string, string][]);
    return `/parts?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title={t("Parts")} subtitle={t("Parts requested on work orders, from order to install.")} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat href={href("to_order")} label={t("To order")} value={count(["requested", "approved"])} sub={isAdmin && approvals ? t("{n} need your approval", { n: approvals }) : undefined} tone={approvals ? "warning" : undefined} />
        <Stat href={href("ordered")} label={t("On order")} value={count(["ordered"])} sub={lateCount ? t("{n} late", { n: lateCount }) : undefined} tone={lateCount ? "critical" : undefined} />
        <Stat href={href("ready")} label={t("Ready to install")} value={count(["ready"])} />
        <Stat href={href("open")} label={t("All open")} value={open.length} />
      </div>

      <Card className="mb-4 p-3">
        <form className="flex flex-wrap items-center gap-2">
          <Select name="q" defaultValue={queue} className="w-auto">
            {Object.entries(QUEUES).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v.label)}
              </option>
            ))}
          </Select>
          <Select name="site" defaultValue={sp.site ?? ""} className="w-auto">
            <option value="">{t("All sites")}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} · ${s.name}` : s.name}
              </option>
            ))}
          </Select>
          {!isAdmin && (
            <Select name="mine" defaultValue={mine ? "1" : "0"} className="w-auto">
              <option value="1">{t("My jobs")}</option>
              <option value="0">{t("Everyone's")}</option>
            </Select>
          )}
          <AutoSubmit />
          <Button variant="secondary" type="submit">
            {t("Filter")}
          </Button>
        </form>
      </Card>

      <Card>
        {error && <p className="p-4 text-sm text-red-700">{error.message}</p>}
        {rows.length === 0 ? (
          <EmptyState title={t("No parts here.")} />
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>{t("Part")}</Th>
                <Th>{t("Work order")}</Th>
                <Th>{t("Site")}</Th>
                <Th>{t("Status")}</Th>
                <Th>{t("Requested")}</Th>
                <Th className="text-right">{t("Cost")}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className={late(r) ? "bg-red-50/40" : "hover:bg-slate-50"}>
                  <Td>
                    <Link href={`/work-orders/${r.wo.id}#parts`} className="font-medium text-slate-900 hover:text-brand-700">
                      {r.name}
                      {Number(r.quantity) !== 1 && <span className="font-normal text-slate-500"> ×{Number(r.quantity)}</span>}
                    </Link>
                    <div className="text-xs text-slate-500">{[r.part_number && `${t("Part #")} ${r.part_number}`, r.supplier].filter(Boolean).join(" · ")}</div>
                  </Td>
                  <Td className="text-xs">
                    <Link href={`/work-orders/${r.wo.id}`} className="hover:text-brand-700">
                      <span className="font-mono text-slate-500">#{r.wo.number}</span> {r.wo.title}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{r.wo.site?.code ?? r.wo.site?.name}</Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={late(r) ? "critical" : PART_STATUS_TONE[r.status]}>
                        {r.status === "ordered" && r.eta
                          ? late(r)
                            ? t("Late · was due {date}", { date: fmtDate(r.eta, L) })
                            : t("Ordered · arriving {date}", { date: fmtDate(r.eta, L) })
                          : t(PART_STATUS_LABEL[r.status])}
                      </Badge>
                      {needsApproval(r) && (
                        <Badge tone="serious" dot={false}>
                          {r.est_cost == null ? t("No price yet") : t("Needs approval")}
                        </Badge>
                      )}
                      {r.status === "ready" && r.ready_location && <span className="text-xs text-emerald-700">{t(PART_READY_WHERE[r.ready_location] ?? r.ready_location)}</span>}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {fmtDate(r.requested_at, L)}
                    {r.requester && <div className="text-slate-500">{personName(r.requester)}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">
                    {r.cost != null ? fmtMoney(r.cost, 2) : r.est_cost != null ? <span className="text-slate-500">{t("est.")} {fmtMoney(r.est_cost, 2)}</span> : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
