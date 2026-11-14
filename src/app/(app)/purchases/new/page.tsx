import { requireRole } from "@/lib/auth";
import { getCompanyScope } from "@/lib/company";
import { getLookups } from "@/lib/data";
import { Alert, Card, PageHeader } from "@/components/ui";
import { SupplyForm } from "./SupplyForm";

export const metadata = { title: "Log a purchase" };
export const dynamic = "force-dynamic";

const COMMON_VENDORS = ["Restaurant Depot", "Costco", "Sam's Club", "WebstaurantStore", "Smart & Final", "US Foods", "Sysco", "Amazon", "Walmart", "Target"];

export default async function NewSupplyPurchasePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireRole("admin", "tech", "manager");
  const [{ sites }, scope, { data: prev }] = await Promise.all([
    getLookups(supabase),
    getCompanyScope(),
    supabase.from("wo_purchases").select("store").eq("kind", "supply").order("created_at", { ascending: false }).limit(200),
  ]);

  // Shop / warehouse purchases (no location): admins and techs, for a company they work in.
  let shopCompanies: { id: string; name: string }[] = [];
  if (profile.role === "admin") {
    shopCompanies = scope.companyId ? scope.companies.filter((c) => c.id === scope.companyId) : scope.companies.filter((c) => c.active);
  } else if (profile.role === "tech") {
    const { data } = await supabase.from("site_members").select("site:sites(company:companies(id,name))").eq("user_id", profile.id);
    const m = new Map<string, string>();
    ((data ?? []) as unknown as { site: { company: { id: string; name: string } | null } | null }[]).forEach((r) => r.site?.company && m.set(r.site.company.id, r.site.company.name));
    shopCompanies = [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }
  const canShop = shopCompanies.length > 0;
  const vendors = [...new Set([...((prev ?? []) as { store: string }[]).map((s) => s.store), ...COMMON_VENDORS])].slice(0, 40);
  const preset = sp.site && (sites.some((s) => s.id === sp.site) || (sp.site === "shop" && canShop)) ? sp.site : sites.length === 1 && !canShop ? sites[0].id : "";
  const self = `/purchases/new${sp.site ? `?site=${sp.site}` : ""}`;
  const key = crypto.randomUUID();

  return (
    <>
      <PageHeader title="Log a purchase" subtitle="Restaurant supplies bought for a location — smallwares, cleaning, paper goods, uniforms. Not a work order, and not counted as R&M." />
      {sp.error && <Alert>{sp.error}</Alert>}
      <Card className="max-w-2xl">
        {sites.length === 0 && !canShop ? (
          <p className="p-5 text-sm text-slate-600">You aren’t assigned to any location yet. Ask an admin to add you to your store.</p>
        ) : (
          <SupplyForm sites={sites} shopCompanies={shopCompanies} vendors={vendors} preset={preset} back={self} clientKey={key} />
        )}
      </Card>
    </>
  );
}
