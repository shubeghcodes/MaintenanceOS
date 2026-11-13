import { getCompanyScope } from "@/lib/company";
import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ImportClient } from "./ImportClient";

export const metadata = { title: "Import sites" };

export default async function ImportSitesPage() {
  await requireRole("admin");
  const scope = await getCompanyScope();
  return (
    <>
      <PageHeader
        title="Import sites from Excel"
        subtitle="Add or update many locations at once and give each manager access to their own store."
        back={{ href: "/sites", label: "Sites" }}
      />
      {scope.enabled && (
        <p className="mb-4 text-sm text-slate-600">
          New sites will be added to <b>{scope.company?.name ?? scope.companies.find((c) => c.active)?.name ?? "your first company"}</b>
          {scope.company ? "" : " (pick a company in the dropdown to choose another)"}. Existing sites keep their company.
        </p>
      )}
      <ImportClient />
    </>
  );
}
