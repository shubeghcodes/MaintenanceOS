import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import type { Asset } from "@/lib/types";
import { Alert, PageHeader } from "@/components/ui";
import { AssetForm } from "../../AssetForm";

export const metadata = { title: "Edit asset" };

export default async function EditAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireRole("admin", "tech");
  const [{ data }, { sites }] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).maybeSingle(),
    getLookups(supabase, { allCompanies: true }),
  ]);
  if (!data) notFound();
  const asset = data as Asset;
  return (
    <>
      <PageHeader title={`Edit ${asset.name}`} back={{ href: `/assets/${id}`, label: asset.name }} />
      {sp.error && <Alert>{sp.error}</Alert>}
      <AssetForm asset={asset} sites={sites} />
    </>
  );
}
