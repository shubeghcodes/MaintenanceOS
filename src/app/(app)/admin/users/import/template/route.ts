import { requireRole } from "@/lib/auth";
import { getCompanyScope } from "@/lib/company";
import { buildUserTemplate } from "@/lib/user-import";

export const runtime = "nodejs";

export async function GET() {
  const { supabase } = await requireRole("admin");
  const scope = await getCompanyScope();
  const company = new Map(scope.companies.map((c) => [c.id, c.name]));
  const { data } = await supabase.from("sites").select("code,name,city,company_id").eq("active", true).order("code", { nullsFirst: false }).order("name");
  const stores = ((data ?? []) as { code: string | null; name: string; city: string | null; company_id: string | null }[])
    // Selected company's stores first.
    .sort((a, b) => Number(b.company_id === scope.companyId) - Number(a.company_id === scope.companyId))
    .map((s) => ({ code: s.code, name: s.name, city: s.city, company: s.company_id ? company.get(s.company_id) ?? null : null }));
  const buf = await buildUserTemplate(stores);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="MaintenanceOS-users-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
