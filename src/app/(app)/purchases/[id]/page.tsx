import Link from "next/link";
import { notFound } from "next/navigation";
import { Receipt } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { PAYMENT_LABEL, PURCHASE_KIND_LABEL, PURCHASE_STATUS_LABEL, PURCHASE_STATUS_TONE, SHOP_LABEL } from "@/lib/constants";
import { fmtDate, fmtDateTime, fmtMoney, personName } from "@/lib/format";
import type { Purchase } from "@/lib/types";
import { Alert, Badge, ButtonLink, Card, CardHeader, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { deletePurchase, markReimbursed, reviewPurchase } from "../../work-orders/purchase-actions";

export const metadata = { title: "Purchase" };
export const dynamic = "force-dynamic";

const DONE: Record<string, string> = { added: "Purchase saved.", approved: "Approved.", rejected: "Rejected.", reimbursed: "Marked as reimbursed." };

type Row = Purchase & {
  buyer: { full_name: string | null; email: string | null } | null;
  reviewer: { full_name: string | null; email: string | null } | null;
  wo: { id: string; number: number; title: string } | null;
  place: { id: string; name: string; code: string | null } | null;
  company: { name: string } | null;
};

export default async function PurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { supabase, profile } = await requireRole("admin", "tech", "manager");
  const { data } = await supabase
    .from("wo_purchases")
    .select(
      "*, buyer:profiles!wo_purchases_purchased_by_fkey(full_name,email), reviewer:profiles!wo_purchases_reviewed_by_fkey(full_name,email), wo:work_orders(id,number,title), place:sites!wo_purchases_site_id_fkey(id,name,code), company:companies(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const r = data as unknown as Row;

  let file: { url: string; image: boolean } | null = null;
  if (r.receipt_attachment_id) {
    const { data: a } = await supabase.from("attachments").select("storage_path,content_type").eq("id", r.receipt_attachment_id).maybeSingle();
    if (a) {
      const { data: s } = await supabase.storage.from("attachments").createSignedUrl(a.storage_path, 3600);
      if (s?.signedUrl) file = { url: s.signedUrl, image: !!a.content_type?.startsWith("image/") };
    }
  }

  const isAdmin = profile.role === "admin";
  const canDelete = isAdmin || (r.purchased_by === profile.id && r.status === "submitted");
  const back = `/purchases/${r.id}`;
  const where = r.place ? (r.place.code ? `${r.place.code} · ${r.place.name}` : r.place.name) : SHOP_LABEL;

  return (
    <>
      <PageHeader
        title={`${r.store} · ${fmtMoney(r.total, 2)}`}
        subtitle={`${PURCHASE_KIND_LABEL[r.kind]} · ${where} · ${fmtDate(r.purchase_date)}`}
        actions={
          <ButtonLink href="/purchases" variant="secondary">
            All purchases
          </ButtonLink>
        }
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.receipt && DONE[sp.receipt] && <Alert tone="good">{DONE[sp.receipt]}</Alert>}

      <div className="grid max-w-4xl gap-6 md:grid-cols-[1fr_280px]">
        <Card>
          <CardHeader title="Details" />
          <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 p-5 text-sm">
            <dt className="text-slate-500">Status</dt>
            <dd className="flex flex-wrap gap-1.5">
              <Badge tone={PURCHASE_STATUS_TONE[r.status]}>{PURCHASE_STATUS_LABEL[r.status]}</Badge>
              {r.reimbursable && r.status !== "rejected" && (
                <Badge tone={r.reimbursed_at ? "good" : "serious"} dot={false}>
                  {r.reimbursed_at ? `Reimbursed ${fmtDate(r.reimbursed_at)}` : "Reimburse"}
                </Badge>
              )}
            </dd>
            <dt className="text-slate-500">Type</dt>
            <dd>
              {r.wo ? (
                <Link href={`/work-orders/${r.wo.id}#receipts`} className="text-brand-700 hover:underline">
                  Work order #{r.wo.number} · {r.wo.title}
                </Link>
              ) : (
                <>Store supplies (not R&amp;M)</>
              )}
            </dd>
            <dt className="text-slate-500">Location</dt>
            <dd>
              {r.place ? (
                <Link href={`/sites/${r.place.id}`} className="text-brand-700 hover:underline">
                  {where}
                </Link>
              ) : (
                `${SHOP_LABEL}${r.company ? ` · ${r.company.name}` : ""}`
              )}
            </dd>
            <dt className="text-slate-500">Category</dt>
            <dd>{r.category}</dd>
            {r.description && (
              <>
                <dt className="text-slate-500">What was bought</dt>
                <dd>{r.description}</dd>
              </>
            )}
            {(r.subtotal != null || r.tax != null) && (
              <>
                <dt className="text-slate-500">Subtotal · tax</dt>
                <dd className="tabular-nums">
                  {fmtMoney(r.subtotal, 2)} · {fmtMoney(r.tax, 2)}
                </dd>
              </>
            )}
            <dt className="text-slate-500">Total</dt>
            <dd className="font-semibold tabular-nums">{fmtMoney(r.total, 2)}</dd>
            <dt className="text-slate-500">Paid with</dt>
            <dd>
              {PAYMENT_LABEL[r.payment_method]}
              {r.card_last4 && ` ••${r.card_last4}`}
            </dd>
            <dt className="text-slate-500">Bought by</dt>
            <dd>
              {personName(r.buyer)} · logged {fmtDateTime(r.created_at)}
            </dd>
            {r.reviewed_at && (
              <>
                <dt className="text-slate-500">Reviewed</dt>
                <dd>
                  {personName(r.reviewer)} · {fmtDateTime(r.reviewed_at)}
                  {r.review_note && <div className="text-slate-600">“{r.review_note}”</div>}
                </dd>
              </>
            )}
            {r.reimbursement_ref && (
              <>
                <dt className="text-slate-500">Reimbursement ref</dt>
                <dd>{r.reimbursement_ref}</dd>
              </>
            )}
          </dl>

          {(isAdmin || canDelete) && (
            <form className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-4">
              <input type="hidden" name="purchase_id" value={r.id} />
              <input type="hidden" name="back" value={back} />
              {isAdmin && r.status === "submitted" && (
                <>
                  <Input name="note" placeholder="Note (required to reject)" className="w-60 py-1.5 text-sm" />
                  <SubmitButton size="sm" formAction={reviewPurchase.bind(null, "approved")}>
                    Approve
                  </SubmitButton>
                  <SubmitButton size="sm" variant="danger" formAction={reviewPurchase.bind(null, "rejected")}>
                    Reject
                  </SubmitButton>
                </>
              )}
              {isAdmin && r.reimbursable && r.status === "approved" && !r.reimbursed_at && (
                <>
                  <Input name="reimbursement_ref" placeholder="Check # / payroll ref" className="w-48 py-1.5 text-sm" />
                  <SubmitButton size="sm" variant="secondary" formAction={markReimbursed}>
                    Mark reimbursed
                  </SubmitButton>
                </>
              )}
              {canDelete && (
                <SubmitButton size="sm" variant="ghost" formAction={deletePurchase} confirm={`Delete the ${r.store} purchase?`}>
                  Delete
                </SubmitButton>
              )}
            </form>
          )}
        </Card>

        <Card>
          <CardHeader title="Receipt" />
          <div className="p-4">
            {file ? (
              <a href={file.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg ring-1 ring-slate-200">
                {file.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.url} alt={`Receipt from ${r.store}`} className="w-full object-contain" />
                ) : (
                  <span className="flex items-center gap-2 p-4 text-sm font-medium text-brand-700">
                    <Receipt className="h-4 w-4" aria-hidden /> Open receipt (PDF)
                  </span>
                )}
              </a>
            ) : (
              <p className="text-sm text-amber-700">No receipt photo attached.</p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
