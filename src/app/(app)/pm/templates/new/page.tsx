import { requireRole } from "@/lib/auth";
import { Alert, PageHeader } from "@/components/ui";
import { TemplateForm } from "../TemplateForm";

export const metadata = { title: "New PM template" };

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireRole("admin");
  return (
    <>
      <PageHeader title="New PM template" back={{ href: "/pm/templates", label: "PM templates" }} />
      {sp.error && <Alert>{sp.error}</Alert>}
      <p className="mb-4 text-sm text-slate-600">Create the template, then add its activities and choose which photos each one needs.</p>
      <TemplateForm />
    </>
  );
}
