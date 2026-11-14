import { requireRole } from "@/lib/auth";
import { getLookups, getPickerLocations } from "@/lib/data";
import { Alert, PageHeader } from "@/components/ui";
import { PmForm } from "../PmForm";

export const metadata = { title: "New PM schedule" };

export default async function NewPmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin");
  const [lookups, locations] = await Promise.all([getLookups(supabase, { assets: true }), getPickerLocations(supabase)]);
  return (
    <>
      <PageHeader title="New PM schedule" back={{ href: "/pm", label: "Preventive maintenance" }} />
      {sp.error && <Alert>{sp.error}</Alert>}
      <PmForm lookups={lookups} locations={locations} defaults={{ site: sp.site, asset: sp.asset }} />
    </>
  );
}
