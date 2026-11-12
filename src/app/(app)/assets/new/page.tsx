import { requireRole } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { Alert, PageHeader } from "@/components/ui";
import { AssetForm } from "../AssetForm";

export const metadata = { title: "Add asset" };

export default async function NewAssetPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin", "tech");
  const { sites } = await getLookups(supabase);
  return (
    <>
      <PageHeader title="Add asset" back={{ href: "/assets", label: "Assets" }} />
      {sp.error && <Alert>{sp.error}</Alert>}
      <AssetForm sites={sites} defaultSiteId={sp.site} />
    </>
  );
}
