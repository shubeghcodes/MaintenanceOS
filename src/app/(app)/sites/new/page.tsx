import { getCompanyScope } from "@/lib/company";
import { requireRole } from "@/lib/auth";
import { Alert, PageHeader } from "@/components/ui";
import { SiteForm } from "../SiteForm";

export const metadata = { title: "Add site" };

export default async function NewSitePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireRole("admin");
  const scope = await getCompanyScope();
  return (
    <>
      <PageHeader title="Add site" back={{ href: "/sites", label: "Sites" }} />
      {sp.error && <Alert>{sp.error}</Alert>}
      <SiteForm companies={scope.companies} defaultCompanyId={scope.companyId} />
    </>
  );
}
