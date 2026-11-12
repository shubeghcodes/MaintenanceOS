import Link from "next/link";
import { Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { OPEN_STATUSES } from "@/lib/constants";
import { fmtMoney } from "@/lib/format";
import type { Vendor } from "@/lib/types";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { DueBadge } from "@/components/badges";

export const metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const { supabase, profile } = await requireRole("admin", "tech");
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const [{ data: vData }, { data: woData }] = await Promise.all([
    supabase.from("vendors").select("*").order("active", { ascending: false }).order("name"),
    supabase.from("work_orders").select("vendor_id,status,total_cost,completed_at").not("vendor_id", "is", null).limit(10000),
  ]);
  const vendors = (vData ?? []) as Vendor[];
  const wos = (woData ?? []) as { vendor_id: string; status: string; total_cost: number; completed_at: string | null }[];
  const stats = new Map<string, { open: number; ytd: number }>();
  for (const w of wos) {
    const s = stats.get(w.vendor_id) ?? { open: 0, ytd: 0 };
    if (OPEN_STATUSES.includes(w.status as never)) s.open++;
    if (w.completed_at && w.completed_at >= yearStart) s.ytd += Number(w.total_cost || 0);
    stats.set(w.vendor_id, s);
  }

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle="Service providers, insurance status and spend."
        actions={
          profile.role === "admin" && (
            <ButtonLink href="/vendors/new">
              <Plus className="h-4 w-4" aria-hidden /> Add vendor
            </ButtonLink>
          )
        }
      />
      <Card>
        {vendors.length === 0 ? (
          <EmptyState title="No vendors yet." />
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Vendor</Th>
                <Th>Trades</Th>
                <Th>Contact</Th>
                <Th>COI</Th>
                <Th className="text-right">Open jobs</Th>
                <Th className="text-right">Spend YTD</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vendors.map((v) => (
                <tr key={v.id} className={v.active ? "hover:bg-slate-50" : "opacity-60 hover:bg-slate-50"}>
                  <Td>
                    <Link href={`/vendors/${v.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {v.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {v.rating ? `${v.rating}/5` : ""}
                      {v.hourly_rate ? ` · ${fmtMoney(v.hourly_rate)}/hr` : ""}
                      {!v.active && " · inactive"}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {v.trades.map((t) => (
                        <Badge key={t} dot={false}>
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                  <Td className="text-xs">
                    <div>{v.contact_name}</div>
                    <div className="text-slate-500">{v.phone}</div>
                  </Td>
                  <Td>
                    <DueBadge date={v.coi_expires_on} label="Expired" />
                  </Td>
                  <Td className="text-right tabular-nums">{stats.get(v.id)?.open ?? 0}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(stats.get(v.id)?.ytd ?? 0)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
