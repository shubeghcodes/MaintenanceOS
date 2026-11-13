import { getCompanyScope } from "@/lib/company";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCertificates } from "@/lib/certificates";
import { todayISO } from "@/lib/format";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of completed compliance work (respects the same filters as the page). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const rows = await loadCertificates(supabase, { ...sp, company: (await getCompanyScope()).companyId });
  const header = ["Site", "Store #", "Requirement", "Category", "Authority", "Completed", "Valid until", "Status", "Result", "Vendor", "Certificate #", "Work order", "Files", "Notes"];
  const lines = rows.map((r) =>
    [r.req?.site?.name, r.req?.site?.code, r.req?.name, r.req?.category, r.req?.authority, r.completed_on, r.valid_until, r.status, r.result, r.vendor?.name ?? "In-house", r.certificate_number, r.wo ? `#${r.wo.number}` : "", r.files.map((f) => f.name).join("; "), r.notes]
      .map(cell)
      .join(","),
  );
  return new NextResponse([header.join(","), ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="compliance-certificates-${todayISO()}.csv"`,
    },
  });
}
