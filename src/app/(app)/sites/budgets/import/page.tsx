import { requireSuper } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { BudgetImportClient } from "./BudgetImportClient";

export const metadata = { title: "Import budgets" };

export default async function ImportBudgetsPage() {
  await requireSuper();
  return (
    <>
      <PageHeader
        title="Import budgets from Excel"
        subtitle="Set monthly budgets for many locations at once."
        back={{ href: "/sites/budgets", label: "Budgets" }}
      />
      <BudgetImportClient />
    </>
  );
}
