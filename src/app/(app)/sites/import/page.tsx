import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ImportClient } from "./ImportClient";

export const metadata = { title: "Import sites" };

export default async function ImportSitesPage() {
  await requireRole("admin");
  return (
    <>
      <PageHeader
        title="Import sites from Excel"
        subtitle="Add or update many locations at once and give each manager access to their own store."
        back={{ href: "/sites", label: "Sites" }}
      />
      <ImportClient />
    </>
  );
}
