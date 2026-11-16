import { laborCostByWo } from "@/lib/labor";
import { AutoSubmit } from "@/components/AutoSubmit";
import { getCompanyScope, inCompany } from "@/lib/company";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { OPEN_STATUSES, PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/constants";
import { fmtDateTime, fmtMoney, isOverdue, personName } from "@/lib/format";
import type { WoPriority, WoStatus, WoType } from "@/lib/types";
import { Badge, Button, ButtonLink, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { OverdueBadge, PriorityBadge, StatusBadge, TypeBadge } from "@/components/badges";

import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Work orders" };

type SP = Record<string, string | undefined>;

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  const t = await getT();
  const { companyId: cid } = await getCompanyScope();
  const { sites } = await getLookups(supabase);

  const status = sp.status ?? "open";
  let q = supabase
    .from("work_orders")
    .select(
      "id,number,title,status,priority,type,due_at,created_at,total_cost,category," +
        "site:sites(id,name,code), asset:assets(id,name), vendor:vendors(id,name)," +
        "tech:profiles!work_orders_assigned_tech_id_fkey(id,full_name,email)",
    )
    .limit(300);
  q = inCompany(q, cid);

  if (status === "open") q = q.in("status", OPEN_STATUSES);
  else if (status === "overdue") q = q.in("status", OPEN_STATUSES).lt("due_at", new Date().toISOString());
  else if (status !== "all") q = q.eq("status", status);
  if (sp.site) q = q.eq("site_id", sp.site);
  if (sp.priority) q = q.eq("priority", sp.priority);
  if (sp.type) q = q.eq("type", sp.type);
  if (sp.category) q = q.eq("category", sp.category);
  if (sp.mine === "1") {
    q = profile.role === "manager" ? q.eq("requested_by", profile.id) : q.eq("assigned_tech_id", profile.id);
  }
  if (sp.q) {
    const term = sp.q.replace(/[%,()]/g, " ").trim();
    const n = Number(term);
    q = Number.isInteger(n) && n > 0 ? q.eq("number", n) : q.ilike("title", `%${term}%`);
  }

  // Open work: most urgent first. Closed: most recent first.
  q =
    status === "open" || status === "overdue"
      ? q.order("due_at", { ascending: true, nullsFirst: false })
      : q.order("created_at", { ascending: false });

  const { data, error } = await q;
  type Row = {
    id: string;
    number: number;
    title: string;
    status: WoStatus;
    priority: WoPriority;
    type: WoType;
    due_at: string | null;
    created_at: string;
    total_cost: number;
    category: string;
    site: { id: string; name: string; code: string | null } | null;
    asset: { id: string; name: string } | null;
    vendor: { id: string; name: string } | null;
    tech: { id: string; full_name: string | null; email: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  // Admins see the full R&M cost, including internal labor.
  const labor = profile.role === "admin" ? await laborCostByWo(supabase, rows.map((r) => r.id)) : new Map<string, { labor_cost: number }>();
  for (const r of rows) r.total_cost = Number(r.total_cost || 0) + Number(labor.get(r.id)?.labor_cost ?? 0);

  // Open parts per work order: the "furthest behind" one decides the badge (to order → on order → ready).
  const partState = new Map<string, "to_order" | "ordered" | "ready">();
  if (profile.role !== "vendor" && rows.length) {
    const { data: pr } = await supabase
      .from("wo_parts")
      .select("work_order_id,status")
      .in("work_order_id", rows.map((r) => r.id))
      .in("status", ["requested", "approved", "ordered", "ready"]);
    const rank = { to_order: 0, ordered: 1, ready: 2 } as const;
    for (const p of (pr ?? []) as { work_order_id: string; status: string }[]) {
      const s = p.status === "ready" ? "ready" : p.status === "ordered" ? "ordered" : "to_order";
      const cur = partState.get(p.work_order_id);
      if (!cur || rank[s] < rank[cur]) partState.set(p.work_order_id, s);
    }
  }
  const PART_BADGE = { to_order: ["Parts: to order", "warning"], ordered: ["Parts: on order", "info"], ready: ["Parts: ready", "good"] } as const;

  // Emergencies float to the top of open lists; otherwise keep due-date order (stable sort).
  if (status === "open" || status === "overdue") {
    rows.sort((a, b) => Number(b.priority === "emergency") - Number(a.priority === "emergency"));
  }

  return (
    <>
      <PageHeader
        title={profile.role === "vendor" ? "My jobs" : t("Work orders")}
        subtitle={t("{n} shown", { n: `${rows.length}${rows.length === 300 ? "+" : ""}` })}
        actions={
          profile.role !== "vendor" && (
            <ButtonLink href="/work-orders/new">
              <Plus className="h-4 w-4" aria-hidden /> {profile.role === "manager" ? t("Submit request") : t("New work order")}
            </ButtonLink>
          )
        }
      />

      <Card className="mb-4 p-3">
        <form className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
          <Input name="q" placeholder={t("Search title or #")} defaultValue={sp.q} className="col-span-2 md:col-span-1 lg:col-span-2" />
          <Select name="status" defaultValue={status}>
            <option value="open">{t("Open")}</option>
            <option value="overdue">{t("Overdue")}</option>
            <option value="all">{t("All statuses")}</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </Select>
          {profile.role !== "vendor" && (
            <Select name="site" defaultValue={sp.site ?? ""}>
              <option value="">{t("All sites")}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code ?? s.name}
                </option>
              ))}
            </Select>
          )}
          <Select name="priority" defaultValue={sp.priority ?? ""}>
            <option value="">{t("Any priority")}</option>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </Select>
          <Select name="type" defaultValue={sp.type ?? ""}>
            <option value="">{t("Any type")}</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-2">
            {(profile.role === "tech" || profile.role === "manager") && (
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
                <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} className="rounded border-slate-300" />
                {profile.role === "manager" ? t("Mine") : t("Assigned to me")}
              </label>
            )}
            <AutoSubmit />
            <Button variant="secondary" type="submit" className="flex-1">
              {t("Filter")}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {error && <p className="p-4 text-sm text-red-700">{error.message}</p>}
        {rows.length === 0 ? (
          <EmptyState title={t("No work orders match these filters.")} />
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>#</Th>
                <Th>{t("Work order")}</Th>
                <Th>{t("Site")}</Th>
                <Th>{t("Priority")}</Th>
                <Th>{t("Status")}</Th>
                <Th>{t("Assigned")}</Th>
                <Th>{t("Due")}</Th>
                {profile.role !== "manager" && <Th className="text-right">{t("Cost")}</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className={isOverdue(r.due_at, r.status) ? "bg-red-50/40 hover:bg-red-50" : "hover:bg-slate-50"}>
                  <Td className="whitespace-nowrap font-mono text-xs text-slate-500">
                    <Link href={`/work-orders/${r.id}`}>#{r.number}</Link>
                  </Td>
                  <Td>
                    <Link href={`/work-orders/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {r.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {r.type !== "reactive" && <TypeBadge type={r.type} />}
                      <span>{t(r.category)}</span>
                      {r.asset && <span>· {r.asset.name}</span>}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{r.site?.code ?? r.site?.name}</Td>
                  <Td>
                    <PriorityBadge priority={r.priority} />
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={r.status} />
                      <OverdueBadge dueAt={r.due_at} status={r.status} />
                      {partState.get(r.id) && (
                        <Badge tone={PART_BADGE[partState.get(r.id)!][1]} dot={false}>
                          {t(PART_BADGE[partState.get(r.id)!][0])}
                        </Badge>
                      )}
                    </div>
                  </Td>
                  <Td className="text-xs">
                    {r.tech && <div>{personName(r.tech)}</div>}
                    {r.vendor && <div className="text-slate-500">{r.vendor.name}</div>}
                    {!r.tech && !r.vendor && <span className="text-slate-400">{t("Unassigned")}</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.due_at, t.locale)}</Td>
                  {profile.role !== "manager" && (
                    <Td className="whitespace-nowrap text-right tabular-nums">{r.total_cost ? fmtMoney(r.total_cost) : "—"}</Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
