import { getCompanyScope, inCompany } from "@/lib/company";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { Vendor, WoStatus } from "@/lib/types";
import { Alert, Badge, Card, CardHeader, DefList, EmptyState, PageHeader, Stat } from "@/components/ui";
import { DueBadge, StatusBadge } from "@/components/badges";
import { VendorForm } from "../VendorForm";

export default async function VendorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireRole("admin", "tech");
  const { companyId: cid } = await getCompanyScope();
  const [{ data }, { data: woData }] = await Promise.all([
    supabase.from("vendors").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("work_orders")
      .select("id,number,title,status,created_at,completed_at,total_cost,due_at,site:sites(code,name)")
      .eq("vendor_id", id)
      .eq(cid ? "company_id" : "vendor_id", cid ?? id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (!data) notFound();
  const v = data as Vendor;
  const wos = (woData ?? []) as unknown as { id: string; number: number; title: string; status: WoStatus; created_at: string; completed_at: string | null; total_cost: number; due_at: string | null; site: { code: string | null; name: string } | null }[];
  const done = wos.filter((w) => w.status === "completed");
  const onTime = done.filter((w) => !w.due_at || (w.completed_at && w.completed_at <= w.due_at));
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const ytd = done.filter((w) => (w.completed_at ?? "") >= yearStart).reduce((s, w) => s + Number(w.total_cost || 0), 0);
  const avgTicket = done.length ? done.reduce((s, w) => s + Number(w.total_cost || 0), 0) / done.length : null;

  return (
    <>
      <PageHeader
        title={v.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {v.trades.map((t) => (
              <Badge key={t} dot={false}>
                {t}
              </Badge>
            ))}
            {!v.active && <Badge tone="muted">Inactive</Badge>}
          </span>
        }
        back={{ href: "/vendors", label: "Vendors" }}
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.saved && <Alert tone="good">Vendor saved.</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Spend YTD" value={fmtMoney(ytd)} sub={`${done.length} jobs completed`} />
        <Stat label="Avg ticket" value={fmtMoney(avgTicket)} />
        <Stat label="On-time" value={done.length ? `${Math.round((onTime.length / done.length) * 100)}%` : "—"} sub="Completed by due date" />
        <Stat label="COI" value={<DueBadge date={v.coi_expires_on} label="Expired" />} sub={v.coi_expires_on ? `Expires ${fmtDate(v.coi_expires_on)}` : "No COI on file"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {profile.role === "admin" ? (
            <VendorForm vendor={v} />
          ) : (
            <Card>
              <CardHeader title="Contact" />
              <DefList
                items={[
                  ["Contact", v.contact_name ?? "—"],
                  ["Phone", v.phone ?? "—"],
                  ["After hours", v.after_hours_phone ?? "—"],
                  ["Email", v.email ?? "—"],
                  ["License", v.license_number ?? "—"],
                  ["Rate", v.hourly_rate ? `${fmtMoney(v.hourly_rate)}/hr` : "—"],
                ]}
              />
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="Jobs" subtitle={`${wos.length} total`} />
          {wos.length === 0 ? (
            <EmptyState title="No jobs yet." />
          ) : (
            <ul className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
              {wos.map((w) => (
                <li key={w.id}>
                  <Link href={`/work-orders/${w.id}`} className="block px-5 py-2.5 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{w.title}</span>
                      <StatusBadge status={w.status} />
                    </div>
                    <p className="text-xs text-slate-500">
                      #{w.number} · {w.site?.code ?? w.site?.name} · {fmtDate(w.created_at)}
                      {w.total_cost ? ` · ${fmtMoney(w.total_cost)}` : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
