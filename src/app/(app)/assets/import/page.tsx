import { requireRole } from "@/lib/auth";
import { getCompanyScope, inCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { AssetImportClient } from "./AssetImportClient";

export const metadata = { title: "Import assets" };

export default async function ImportAssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin");
  const scope = await getCompanyScope();
  const { data } = await inCompany(supabase.from("sites").select("id,code,name").eq("active", true), scope.companyId)
    .order("code", { nullsFirst: false })
    .order("name");
  const sites = (data ?? []) as { id: string; code: string | null; name: string }[];
  return (
    <>
      <PageHeader
        title="Import assets from Excel"
        subtitle={`Add or update equipment for every location at once${scope.company ? ` · ${scope.company.name}` : ""}.`}
        back={{ href: "/assets", label: "Assets" }}
      />
      <AssetImportClient sites={sites} defaultSite={sp.site ?? ""} />
    </>
  );
}
