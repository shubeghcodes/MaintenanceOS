import { requireRole } from "@/lib/auth";
import { Alert, PageHeader } from "@/components/ui";
import { VendorForm } from "../VendorForm";

export const metadata = { title: "Add vendor" };

export default async function NewVendorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireRole("admin");
  return (
    <>
      <PageHeader title="Add vendor" back={{ href: "/vendors", label: "Vendors" }} />
      {sp.error && <Alert>{sp.error}</Alert>}
      <VendorForm />
    </>
  );
}
