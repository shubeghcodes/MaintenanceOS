import { requireRole } from "@/lib/auth";
import { buildAssetTemplate } from "@/lib/asset-import";
import { getCompanyScope, inCompany } from "@/lib/company";

export const runtime = "nodejs";

export async function GET() {
  const { supabase } = await requireRole("admin");
  const { companyId } = await getCompanyScope();
  const { data } = await inCompany(supabase.from("sites").select("code,name").eq("active", true), companyId)
    .order("code", { nullsFirst: false })
    .order("name");
  const buf = await buildAssetTemplate((data ?? []) as { code: string | null; name: string }[]);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="MaintenanceOS-assets-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
