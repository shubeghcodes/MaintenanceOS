import { laborCostByWo } from "@/lib/labor";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { getSession } from "@/lib/auth";
import { listAttachments } from "@/lib/attachments";
import { daysUntil, fmtDate, fmtFreq, fmtMoney, relativeDue, dueWhen, } from "@/lib/format";
import type { Asset, FreqUnit, WoPriority, WoStatus } from "@/lib/types";
import { Alert, ButtonLink, Card, CardHeader, DefList, EmptyState, PageHeader, Stat } from "@/components/ui";
import { AssetStatusBadge, PriorityBadge, StatusBadge } from "@/components/badges";
import { Attachments } from "@/components/Attachments";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteAsset, uploadAssetFiles } from "../actions";

export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await getSession();

  const { data } = await supabase.from("assets").select("*, site:sites(id,name,code)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const asset = data as Asset & { site: { id: string; name: string; code: string | null } | null };

  const [{ data: woData }, { data: pmData }, files] = await Promise.all([
    supabase
      .from("work_orders")
      .select("id,number,title,status,priority,created_at,completed_at,total_cost")
      .eq("asset_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("pm_schedules").select("id,title,frequency_interval,frequency_unit,next_due_on,active").eq("asset_id", id),
    listAttachments(supabase, "asset", id),
  ]);
  const wos = (woData ?? []) as { id: string; number: number; title: string; status: WoStatus; priority: WoPriority; created_at: string; completed_at: string | null; total_cost: number }[];
  if (profile.role === "admin") {
    const labor = await laborCostByWo(supabase, wos.map((w) => w.id));
    for (const w of wos) w.total_cost = Number(w.total_cost || 0) + Number(labor.get(w.id)?.labor_cost ?? 0);
  }
  const pms = (pmData ?? []) as { id: string; title: string; frequency_interval: number; frequency_unit: FreqUnit; next_due_on: string; active: boolean }[];

  const lifetime = wos.reduce((s, w) => s + Number(w.total_cost || 0), 0);
  const last12 = wos
    .filter((w) => w.completed_at && new Date(w.completed_at).getTime() > Date.now() - 365 * 86_400_000)
    .reduce((s, w) => s + Number(w.total_cost || 0), 0);
  const ageYears = asset.install_date ? (Date.now() - new Date(asset.install_date).getTime()) / (365.25 * 86_400_000) : null;
  const lifeLeft = ageYears != null && asset.expected_life_years ? asset.expected_life_years - ageYears : null;
  const repairRatio = asset.purchase_cost ? last12 / Number(asset.purchase_cost) : null;
  const canEdit = profile.role === "admin" || profile.role === "tech";
  const warranty = daysUntil(asset.warranty_expires_on);

  return (
    <>
      <PageHeader
        back={{ href: "/assets", label: "Assets" }}
        title={asset.name}
        subtitle={
          <span className="flex items-center gap-2">
            <AssetStatusBadge status={asset.status} /> {asset.site?.name} {asset.tag && `· ${asset.tag}`}
          </span>
        }
        actions={
          <>
            {profile.role !== "vendor" && (
              <ButtonLink href={`/work-orders/new?site=${asset.site_id}&asset=${asset.id}`}>
                <Plus className="h-4 w-4" aria-hidden /> Report issue
              </ButtonLink>
            )}
            {canEdit && (
              <ButtonLink href={`/assets/${id}/edit`} variant="secondary">
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </ButtonLink>
            )}
          </>
        }
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {repairRatio != null && repairRatio >= 0.5 && (
        <Alert tone="serious">
          Repairs in the last 12 months ({fmtMoney(last12)}) are {Math.round(repairRatio * 100)}% of purchase cost — consider
          replacement.
        </Alert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Work orders" value={wos.length} sub={`${wos.filter((w) => !["completed", "cancelled"].includes(w.status)).length} open`} />
        <Stat label="Repair spend, 12 mo" value={fmtMoney(last12)} sub={`Lifetime ${fmtMoney(lifetime)}`} />
        <Stat label="Age" value={ageYears == null ? "—" : `${ageYears.toFixed(1)} yr`} sub={lifeLeft == null ? "Set install date & life" : lifeLeft > 0 ? `~${lifeLeft.toFixed(1)} yr life left` : "Past expected life"} tone={lifeLeft == null ? undefined : lifeLeft <= 0 ? "serious" : lifeLeft < 2 ? "warning" : "good"} />
        <Stat label="Warranty" value={warranty == null ? "—" : warranty < 0 ? "Expired" : `${warranty}d`} sub={asset.warranty_expires_on ? fmtDate(asset.warranty_expires_on) : "No warranty on file"} tone={warranty == null ? undefined : warranty < 0 ? "muted" : warranty <= 60 ? "warning" : "good"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Work order history" />
            {wos.length === 0 ? (
              <EmptyState title="No work orders for this asset yet." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {wos.map((w) => (
                  <li key={w.id}>
                    <Link href={`/work-orders/${w.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                      <span className="w-12 font-mono text-xs text-slate-400">#{w.number}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{w.title}</p>
                        <p className="text-xs text-slate-500">{fmtDate(w.created_at)}</p>
                      </div>
                      <PriorityBadge priority={w.priority} />
                      <StatusBadge status={w.status} />
                      <span className="w-20 text-right text-xs tabular-nums">{w.total_cost ? fmtMoney(w.total_cost) : "—"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Attachments items={files} action={canEdit ? uploadAssetFiles : undefined} hidden={{ id }} title="Manuals, photos & warranty docs" />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <DefList
              items={[
                ["Category", asset.category],
                ["Location", asset.location_detail ?? "—"],
                ["Manufacturer", asset.manufacturer ?? "—"],
                ["Model", asset.model ?? "—"],
                ["Serial", asset.serial_number ?? "—"],
                ["Installed", fmtDate(asset.install_date)],
                ["Purchase cost", fmtMoney(asset.purchase_cost)],
                ["Expected life", asset.expected_life_years ? `${asset.expected_life_years} years` : "—"],
              ]}
            />
            {asset.notes && <p className="whitespace-pre-wrap border-t border-slate-100 px-5 py-4 text-sm">{asset.notes}</p>}
          </Card>

          <Card>
            <CardHeader
              title="PM schedules"
              action={profile.role === "admin" && <Link href={`/pm/new?site=${asset.site_id}&asset=${id}`} className="text-xs font-medium text-brand-700">Add</Link>}
            />
            {pms.length === 0 ? (
              <EmptyState title="No PM schedule." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {pms.map((p) => (
                  <li key={p.id}>
                    <Link href={`/pm/${p.id}`} className="block px-5 py-3 hover:bg-slate-50">
                      <p className="text-sm font-medium">{p.title}</p>
                      <p className="text-xs text-slate-500">
                        {fmtFreq(p.frequency_interval, p.frequency_unit)} · next {dueWhen(p.next_due_on)}
                        {!p.active && " · paused"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {profile.role === "admin" && (
            <form action={deleteAsset} className="text-right">
              <input type="hidden" name="id" value={id} />
              <SubmitButton size="sm" variant="ghost" confirm="Delete this asset? Its PM schedules are deleted too; work orders are kept.">
                Delete asset
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
