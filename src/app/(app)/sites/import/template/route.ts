import { requireRole } from "@/lib/auth";
import { buildTemplate } from "@/lib/site-import";
import { getCompanyScope } from "@/lib/company";

export const runtime = "nodejs";

export async function GET() {
  await requireRole("admin");
  const scope = await getCompanyScope();
  // Selected company first, so the example row uses it.
  const names = scope.companies.filter((c) => c.active).map((c) => c.name);
  if (scope.company) names.sort((a, b) => (a === scope.company!.name ? -1 : b === scope.company!.name ? 1 : 0));
  const buf = await buildTemplate(names);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="MaintenanceOS-sites-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
