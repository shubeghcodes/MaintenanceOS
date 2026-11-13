import { getCompanyScope } from "@/lib/company";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadPurchases } from "@/lib/purchases";
import { PAYMENT_LABEL } from "@/lib/constants";
import { todayISO } from "@/lib/format";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of receipts for accounting (same filters as the Purchases page). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!me || !["admin", "tech"].includes(me.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await loadPurchases(supabase, { ...Object.fromEntries(new URL(request.url).searchParams), company: (await getCompanyScope()).companyId });
  const header = ["Date", "Store", "Category", "Description", "Subtotal", "Tax", "Total", "Paid with", "Card last 4", "Purchased by", "Work order", "WO title", "Site", "Store #", "Status", "Review note", "Reimbursable", "Reimbursed on", "Reimbursement ref", "Receipt attached"];
  const lines = rows.map((r) =>
    [r.purchase_date, r.store, r.category, r.description, r.subtotal, r.tax, r.total, PAYMENT_LABEL[r.payment_method], r.card_last4, r.buyer?.full_name ?? r.buyer?.email, r.wo ? `#${r.wo.number}` : "", r.wo?.title, r.wo?.site?.name, r.wo?.site?.code, r.status, r.review_note, r.reimbursable ? "yes" : "no", r.reimbursed_at, r.reimbursement_ref, r.receipt_attachment_id ? "yes" : "no"]
      .map(cell)
      .join(","),
  );
  return new NextResponse([header.join(","), ...lines].join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="purchases-${todayISO()}.csv"` },
  });
}
