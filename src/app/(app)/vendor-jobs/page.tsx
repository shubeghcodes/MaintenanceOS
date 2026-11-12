import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { ACTIVE_DISPATCH, DISPATCH_LABEL, DISPATCH_TONE, INVOICE_LABEL, INVOICE_TONE } from "@/lib/constants";
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from "@/lib/format";
import type { DispatchStatus, InvoiceStatus, WoPriority } from "@/lib/types";
import { Badge, Button, Card, EmptyState, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { PriorityBadge } from "@/components/badges";
import { AutoRefresh } from "@/components/AutoRefresh";

export const metadata = { title: "Vendor work" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  status: DispatchStatus;
  contact_email: string;
  email_status: string;
  sent_at: string | null;
  last_viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  requested_by: string | null;
  created_at: string;
  vendor: { id: string; name: string } | null;
  wo: { id: string; number: number; title: string; priority: WoPriority; site: { code: string | null; name: string } | null } | null;
};

export default async function VendorJobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin", "tech");
  const show = sp.show ?? "active";

  let q = supabase
    .from("vendor_dispatches")
    .select(
      "id,status,contact_email,email_status,sent_at,last_viewed_at,accepted_at,declined_at,started_at,completed_at,requested_by,created_at," +
        "vendor:vendors(id,name), wo:work_orders(id,number,title,priority,site:sites(code,name))",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (sp.vendor) q = q.eq("vendor_id", sp.vendor);
  const [{ data }, { data: inv }, { data: appr }, { data: vendors }] = await Promise.all([
    q,
    supabase.from("vendor_invoices").select("dispatch_id,status,amount,created_at").order("created_at", { ascending: false }),
    supabase.from("approval_requests").select("dispatch_id").eq("status", "pending"),
    supabase.from("vendors").select("id,name").order("name"),
  ]);
  const all = (data ?? []) as unknown as Row[];
  const latestInv = new Map<string, { status: InvoiceStatus; amount: number }>();
  for (const i of (inv ?? []) as { dispatch_id: string; status: InvoiceStatus; amount: number }[]) if (!latestInv.has(i.dispatch_id)) latestInv.set(i.dispatch_id, i);
  const pendingAppr = new Set(((appr ?? []) as { dispatch_id: string }[]).map((a) => a.dispatch_id));

  const needsAction = (r: Row) =>
    pendingAppr.has(r.id) ||
    r.status === "work_completed" ||
    r.status === "declined" && !all.some((o) => o.wo?.id === r.wo?.id && o.created_at > r.created_at) ||
    ["submitted", "under_review"].includes(latestInv.get(r.id)?.status ?? "") ||
    ["failed", "not_configured"].includes(r.email_status);
  const late = (r: Row) => !!r.requested_by && r.requested_by < todayISO() && ACTIVE_DISPATCH.includes(r.status);

  const rows = all.filter((r) =>
    show === "all" ? true : show === "action" ? needsAction(r) : show === "invoices" ? !!latestInv.get(r.id) && latestInv.get(r.id)!.status !== "paid" : ACTIVE_DISPATCH.includes(r.status),
  );
  const unpaid = [...latestInv.values()].filter((i) => ["submitted", "under_review", "approved"].includes(i.status));

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Vendor work" subtitle="Work orders sent to outside vendors, with their response, progress and invoice status." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active with vendors" value={all.filter((r) => ACTIVE_DISPATCH.includes(r.status)).length} href="/vendor-jobs" />
        <Stat label="Needs your action" value={all.filter(needsAction).length} tone={all.some(needsAction) ? "serious" : "good"} sub="Approvals, reviews, invoices, declines" href="/vendor-jobs?show=action" />
        <Stat label="Awaiting response" value={all.filter((r) => r.status === "sent").length} sub="Sent, not yet accepted" />
        <Stat label="Unpaid invoices" value={fmtMoney(unpaid.reduce((s, i) => s + Number(i.amount), 0))} sub={`${unpaid.length} invoice${unpaid.length === 1 ? "" : "s"}`} href="/vendor-jobs?show=invoices" />
      </div>

      <Card className="mb-4 p-3">
        <form className="flex flex-wrap gap-2">
          <Select name="show" defaultValue={show} className="w-auto">
            <option value="active">Active</option>
            <option value="action">Needs action</option>
            <option value="invoices">Open invoices</option>
            <option value="all">All</option>
          </Select>
          <Select name="vendor" defaultValue={sp.vendor ?? ""} className="w-auto">
            <option value="">All vendors</option>
            {((vendors ?? []) as { id: string; name: string }[]).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          <Button variant="secondary" type="submit">
            Filter
          </Button>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Nothing here.">Use “Assign to External Vendor” on any work order to send it to a vendor.</EmptyState>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Work order</Th>
                <Th>Vendor</Th>
                <Th>Emailed</Th>
                <Th>Response</Th>
                <Th>Progress</Th>
                <Th>Work</Th>
                <Th>Invoice</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const i = latestInv.get(r.id);
                return (
                  <tr key={r.id} className={needsAction(r) ? "bg-orange-50/40 hover:bg-orange-50" : "hover:bg-slate-50"}>
                    <Td className="min-w-[200px]">
                      <Link href={`/work-orders/${r.wo?.id}#vendor`} className="font-medium text-slate-900 hover:text-brand-700">
                        #{r.wo?.number} {r.wo?.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        {r.wo && <PriorityBadge priority={r.wo.priority} />}
                        <span className="whitespace-nowrap">{r.wo?.site?.code ?? r.wo?.site?.name}</span>
                        {r.requested_by && <span className={`whitespace-nowrap ${late(r) ? "font-medium text-red-700" : ""}`}>by {fmtDate(r.requested_by)}</span>}
                      </div>
                    </Td>
                    <Td className="text-xs">
                      <div className="font-medium text-slate-800">{r.vendor?.name}</div>
                      <div className="max-w-[180px] truncate text-slate-500">{r.contact_email}</div>
                    </Td>
                    <Td className="min-w-[110px] text-xs">
                      {r.sent_at ? fmtDateTime(r.sent_at) : <span className="font-medium text-red-700">{r.email_status === "not_configured" ? "Email not set up" : "Not sent"}</span>}
                      {r.last_viewed_at && <div className="text-slate-400">viewed {fmtDateTime(r.last_viewed_at)}</div>}
                    </Td>
                    <Td className="min-w-[110px] text-xs">
                      {r.declined_at ? <span className="font-medium text-red-700">Declined {fmtDateTime(r.declined_at)}</span> : r.accepted_at ? `Accepted ${fmtDateTime(r.accepted_at)}` : <span className="text-slate-400">Waiting</span>}
                    </Td>
                    <Td>
                      <Badge tone={DISPATCH_TONE[r.status]}>{pendingAppr.has(r.id) ? "Approval requested" : DISPATCH_LABEL[r.status]}</Badge>
                    </Td>
                    <Td className="min-w-[120px] text-xs">
                      <div>Started {r.started_at ? fmtDateTime(r.started_at) : "—"}</div>
                      <div className="text-slate-500">Done {r.completed_at ? fmtDateTime(r.completed_at) : "—"}</div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={INVOICE_TONE[i?.status ?? "none"]}>{INVOICE_LABEL[i?.status ?? "none"]}</Badge>
                      {i && <div className="mt-0.5 text-xs tabular-nums text-slate-600">{fmtMoney(i.amount, 2)}</div>}
                    </Td>
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
