import { requireRole } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { Alert, PageHeader } from "@/components/ui";
import { RequirementForm } from "../RequirementForm";

export const metadata = { title: "Add compliance requirement" };

export default async function NewRequirementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin");
  const { sites, vendors } = await getLookups(supabase);
  return (
    <>
      <PageHeader title="Add compliance requirement" back={{ href: "/compliance", label: "Compliance" }} />
      {sp.error && <Alert>{sp.error}</Alert>}
      <RequirementForm sites={sites} vendors={vendors} defaultSiteId={sp.site} />
    </>
  );
}
