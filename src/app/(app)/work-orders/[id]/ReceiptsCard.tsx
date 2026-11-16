import { Receipt } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAYMENT_LABEL, PURCHASE_CATEGORIES, PURCHASE_STATUS_LABEL, PURCHASE_STATUS_TONE } from "@/lib/constants";
import { fmtDate, fmtMoney, personName, todayISO } from "@/lib/format";
import type { Profile, Purchase } from "@/lib/types";
import { Badge, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { PhotoInput } from "@/components/PhotoInput";
import { addPurchase, deletePurchase, markReimbursed, reviewPurchase } from "../purchase-actions";
import { getT } from "@/lib/i18n/server";

const COMMON_STORES = ["Home Depot", "Lowe's", "Grainger", "Ferguson", "Johnstone Supply", "Ace Hardware", "Restaurant Depot", "Parts Town", "Amazon", "Costco"];

export async function ReceiptsCard({ supabase, woId, profile, open }: { supabase: SupabaseClient; woId: string; profile: Profile; open: boolean }) {
  const t = await getT();
  const L = t.locale;
  const { data } = await supabase
    .from("wo_purchases")
    .select("*, buyer:profiles!wo_purchases_purchased_by_fkey(full_name,email)")
    .eq("work_order_id", woId)
    .order("purchase_date", { ascending: false })
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as (Purchase & { buyer: { full_name: string | null; email: string | null } | null })[];

  // Signed links to receipt images.
  const ids = rows.map((r) => r.receipt_attachment_id).filter(Boolean) as string[];
  const url = new Map<string, { url: string; image: boolean }>();
  if (ids.length) {
    const { data: files } = await supabase.from("attachments").select("id,storage_path,content_type").in("id", ids);
    const list = (files ?? []) as { id: string; storage_path: string; content_type: string | null }[];
    const { data: signed } = await supabase.storage.from("attachments").createSignedUrls(list.map((f) => f.storage_path), 3600);
    list.forEach((f) => {
      const s = signed?.find((x) => x.path === f.storage_path)?.signedUrl;
      if (s) url.set(f.id, { url: s, image: !!f.content_type?.startsWith("image/") });
    });
  }
  const { data: prevStores } = await supabase.from("wo_purchases").select("store").order("created_at", { ascending: false }).limit(200);
  const stores = [...new Set([...((prevStores ?? []) as { store: string }[]).map((s) => s.store), ...COMMON_STORES])].slice(0, 40);

  const counted = rows.filter((r) => r.status !== "rejected");
  const total = counted.reduce((s, r) => s + Number(r.total), 0);
  const toReview = rows.filter((r) => r.status === "submitted").length;
  const owed = rows.filter((r) => r.reimbursable && r.status !== "rejected" && !r.reimbursed_at).reduce((s, r) => s + Number(r.total), 0);
  const isAdmin = profile.role === "admin";
  const key = crypto.randomUUID();

  return (
    <Card id="receipts">
      <CardHeader
        title={t("Receipts & purchases")}
        subtitle={
          rows.length
            ? `${t(counted.length === 1 ? "{n} receipt" : "{n} receipts", { n: counted.length })} · ${fmtMoney(total, 2)}${toReview ? ` · ${t("{n} to review", { n: toReview })}` : ""}${owed ? ` · ${t("{amount} to reimburse", { amount: fmtMoney(owed, 2) })}` : ""}`
            : t("Parts, materials and rentals bought for this job")
        }
      />
      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => {
            const f = r.receipt_attachment_id ? url.get(r.receipt_attachment_id) : undefined;
            const canDelete = isAdmin || (r.purchased_by === profile.id && r.status === "submitted");
            return (
              <li key={r.id} className={`flex gap-3 px-5 py-3 ${r.status === "rejected" ? "opacity-60" : ""}`}>
                <a
                  href={f?.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200"
                  title={f ? t("Open receipt") : t("No receipt attached")}
                >
                  {f?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.url} alt={`Receipt from ${r.store}`} className="h-full w-full object-cover" />
                  ) : (
                    <Receipt className={`h-5 w-5 ${f ? "text-slate-500" : "text-slate-300"}`} aria-hidden />
                  )}
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{r.store}</span>
                    <span className="text-sm tabular-nums text-slate-900">{fmtMoney(r.total, 2)}</span>
                    <Badge tone={PURCHASE_STATUS_TONE[r.status]}>{t(PURCHASE_STATUS_LABEL[r.status])}</Badge>
                    {r.reimbursable && r.status !== "rejected" && (
                      <Badge tone={r.reimbursed_at ? "good" : "serious"} dot={false}>
                        {r.reimbursed_at ? t("Reimbursed {date}", { date: fmtDate(r.reimbursed_at, L) }) : t("Reimburse")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {fmtDate(r.purchase_date, L)} · {t(r.category)} · {t(PAYMENT_LABEL[r.payment_method])}
                    {r.card_last4 && ` ••${r.card_last4}`} · {personName(r.buyer)}
                    {!f && ` · ${t("no receipt")}`}
                  </p>
                  {r.description && <p className="text-sm text-slate-700">{r.description}</p>}
                  {(r.subtotal != null || r.tax != null) && (
                    <p className="text-xs text-slate-500">
                      {t("Subtotal")} {fmtMoney(r.subtotal, 2)} · {t("Tax")} {fmtMoney(r.tax, 2)}
                    </p>
                  )}
                  {r.review_note && <p className="text-xs text-slate-600">{t("Note:")} {r.review_note}</p>}
                  {r.reimbursement_ref && <p className="text-xs text-slate-500">{t("Reimbursement ref")} {r.reimbursement_ref}</p>}

                  {(isAdmin || canDelete) && (
                    <form className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="purchase_id" value={r.id} />
                      {isAdmin && r.status === "submitted" && (
                        <>
                          <Input name="note" placeholder="Note (required to reject)" className="w-56 py-1 text-xs" />
                          <SubmitButton size="sm" formAction={reviewPurchase.bind(null, "approved")}>Approve</SubmitButton>
                          <SubmitButton size="sm" variant="danger" formAction={reviewPurchase.bind(null, "rejected")}>
                            Reject
                          </SubmitButton>
                        </>
                      )}
                      {isAdmin && r.reimbursable && r.status === "approved" && !r.reimbursed_at && (
                        <>
                          <Input name="reimbursement_ref" placeholder="Check # / payroll ref" className="w-44 py-1 text-xs" />
                          <SubmitButton size="sm" variant="secondary" formAction={markReimbursed}>
                            Mark reimbursed
                          </SubmitButton>
                        </>
                      )}
                      {canDelete && (
                        <SubmitButton size="sm" variant="ghost" formAction={deletePurchase} confirm={t("Delete the {store} receipt?", { store: r.store })}>
                          {t("Delete")}
                        </SubmitButton>
                      )}
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <details open={open || rows.length === 0} className="border-t border-slate-100">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-brand-700">+ {t("Add a receipt")}</summary>
        <form action={addPurchase} className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
          <input type="hidden" name="work_order_id" value={woId} />
          <input type="hidden" name="client_key" value={key} />
          <Field label={t("Receipt photo")} className="sm:col-span-2">
            <PhotoInput name="receipt" multiple={false} capture="environment" accept="image/*,application/pdf" />
          </Field>
          <Field label={t("Store / supplier")}>
            <Input name="store" required list={`stores-${woId}`} placeholder="Home Depot" />
            <datalist id={`stores-${woId}`}>
              {stores.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label={t("Total paid ($)")}>
            <Input name="total" required inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label={t("Date")}>
            <Input type="date" name="purchase_date" defaultValue={todayISO()} />
          </Field>
          <Field label={t("Category")}>
            <Select name="category" defaultValue="Parts">
              {PURCHASE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("What was bought")} className="sm:col-span-2">
            <Input name="description" placeholder={t("e.g. 45/5 MFD capacitor, contactor, wire nuts")} />
          </Field>
          <Field label={t("Paid with")}>
            <Select name="payment_method" defaultValue="company_card">
              {Object.entries(PAYMENT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Card last 4 (company card)")}>
            <Input name="card_last4" inputMode="numeric" maxLength={4} placeholder="1234" />
          </Field>
          <details className="sm:col-span-2">
            <summary className="cursor-pointer text-xs text-slate-500">{t("Add subtotal & tax (optional)")}</summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field label={t("Subtotal ($)")}>
                <Input name="subtotal" inputMode="decimal" />
              </Field>
              <Field label={t("Tax ($)")}>
                <Input name="tax" inputMode="decimal" />
              </Field>
            </div>
          </details>
          <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2">
            <input type="checkbox" name="no_receipt" className="rounded border-slate-300" /> {t("No receipt available (explain in “What was bought”)")}
          </label>
          <div className="sm:col-span-2">
            <SubmitButton pendingText={t("Saving…")}>{t("Save receipt")}</SubmitButton>
          </div>
        </form>
      </details>
    </Card>
  );
}
