import { requireRole } from "@/lib/auth";
import { buildTemplate } from "@/lib/site-import";

export const runtime = "nodejs";

export async function GET() {
  await requireRole("admin");
  const buf = await buildTemplate();
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="MaintainOS-sites-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
