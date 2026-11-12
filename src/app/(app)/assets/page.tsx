import Link from "next/link";
import { Plus } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { ASSET_STATUS_LABEL, CATEGORIES } from "@/lib/constants";
import { daysUntil, fmtDate } from "@/lib/format";
import type { Asset } from "@/lib/types";
import { Badge, Button, ButtonLink, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { AssetStatusBadge } from "@/components/badges";

export const metadata = { title: "Assets" };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  const { sites } = await getLookups(supabase);

  let q = supabase.from("assets").select("*, site:sites(id,name,code)").order("name").limit(1000);
  if (sp.site) q = q.eq("site_id", sp.site);
  if (sp.category) q = q.eq("category", sp.category);
  if (sp.status) q = q.eq("status", sp.status);
  else q = q.neq("status", "retired");
  if (sp.q) {
    const t = sp.q.replace(/[%,()]/g, " ").trim();
    q = q.or(`name.ilike.%${t}%,tag.ilike.%${t}%,serial_number.ilike.%${t}%,model.ilike.%${t}%`);
  }
  const { data } = await q;
  const rows = (data ?? []) as (Asset & { site: { id: string; name: string; code: string | null } | null })[];
  const canEdit = profile.role === "admin" || profile.role === "tech";

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle={`${rows.length} asset${rows.length === 1 ? "" : "s"}`}
        actions={
          canEdit && (
            <ButtonLink href={`/assets/new${sp.site ? `?site=${sp.site}` : ""}`}>
              <Plus className="h-4 w-4" aria-hidden /> Add asset
            </ButtonLink>
          )
        }
      />
      <Card className="mb-4 p-3">
        <form className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Input name="q" placeholder="Name, tag, serial, model" defaultValue={sp.q} className="col-span-2 md:col-span-1" />
          <Select name="site" defaultValue={sp.site ?? ""}>
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ?? s.name}
              </option>
            ))}
          </Select>
          <Select name="category" defaultValue={sp.category ?? ""}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">Active (not retired)</option>
            {Object.entries(ASSET_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
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
          <EmptyState title="No assets found.">{canEdit && "Add equipment so requests and PMs can be tied to it."}</EmptyState>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Asset</Th>
                <Th>Site</Th>
                <Th>Category</Th>
                <Th>Make / model</Th>
                <Th>Warranty</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => {
                const w = daysUntil(a.warranty_expires_on);
                return (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <Td>
                      <Link href={`/assets/${a.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {a.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {[a.tag, a.location_detail].filter(Boolean).join(" · ")}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">{a.site?.code ?? a.site?.name}</Td>
                    <Td>{a.category}</Td>
                    <Td className="text-xs">{[a.manufacturer, a.model].filter(Boolean).join(" ") || "—"}</Td>
                    <Td className="whitespace-nowrap text-xs">
                      {w == null ? (
                        "—"
                      ) : w < 0 ? (
                        <span className="text-slate-400">Expired {fmtDate(a.warranty_expires_on)}</span>
                      ) : (
                        <Badge tone={w <= 60 ? "warning" : "good"}>Until {fmtDate(a.warranty_expires_on)}</Badge>
                      )}
                    </Td>
                    <Td>
                      <AssetStatusBadge status={a.status} />
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
