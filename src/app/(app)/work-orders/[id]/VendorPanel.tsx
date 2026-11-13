import Link from "next/link";
import { Send } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COST_CATEGORY_LABEL, QUOTE_LABEL, QUOTE_TONE, APPROVAL_LABEL, APPROVAL_TONE, DISPATCH_LABEL, DISPATCH_TONE, INVOICE_LABEL, INVOICE_TONE, PRIORITY_LABEL, ACTIVE_DISPATCH } from "@/lib/constants";
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from "@/lib/format";
import type { ApprovalRequest, Profile, VendorCostLine, VendorDispatch, VendorInvoice, VendorQuote, WorkOrder } from "@/lib/types";
import { Badge, ButtonLink, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { decideApproval, decideQuote, messageVendor, resendLink, reviewInvoice, reviewWork, revokeLink, updateDispatch } from "../vendor-actions";

type Dispatch = VendorDispatch & { vendor: { id: string; name: string; phone: string | null } | null };

export async function VendorPanel({ supabase, wo, profile }: { supabase: SupabaseClient; wo: WorkOrder; profile: Profile }) {
  const canManage = profile.role === "admin" || profile.role === "tech";
  const [{ data: dData }, { data: aData }, { data: iData }, { data: qData }, { data: cData }] = await Promise.all([
    supabase.from("vendor_dispatches").select("*, vendor:vendors(id,name,phone)").eq("work_order_id", wo.id).order("created_at", { ascending: false }),
    supabase.from("approval_requests").select("*").eq("work_order_id", wo.id).order("created_at", { ascending: false }),
    supabase.from("vendor_invoices").select("*").eq("work_order_id", wo.id).order("created_at", { ascending: false }),
    supabase.from("vendor_quotes").select("*").eq("work_order_id", wo.id).order("created_at", { ascending: false }),
    supabase.from("vendor_cost_lines").select("*").eq("work_order_id", wo.id).order("created_at"),
  ]);
  const dispatches = (dData ?? []) as unknown as Dispatch[];
  const approvals = (aData ?? []) as ApprovalRequest[];
  const invoices = (iData ?? []) as VendorInvoice[];
  const quotes = (qData ?? []) as VendorQuote[];
  const costs = (cData ?? []) as VendorCostLine[];

  // Signed URLs for invoice, quote and receipt files.
  const fileIds = [...invoices, ...quotes, ...costs].map((i) => i.attachment_id).filter(Boolean) as string[];
  const fileUrl = new Map<string, string>();
  if (fileIds.length) {
    const { data: files } = await supabase.from("attachments").select("id,storage_path").in("id", fileIds);
    const rows = (files ?? []) as { id: string; storage_path: string }[];
    const { data: signed } = await supabase.storage.from("attachments").createSignedUrls(rows.map((r) => r.storage_path), 3600);
    rows.forEach((r) => {
      const s = signed?.find((x) => x.path === r.storage_path);
      if (s?.signedUrl) fileUrl.set(r.id, s.signedUrl);
    });
  }

  const live = dispatches.find((d) => ACTIVE_DISPATCH.includes(d.status));
  const current = live ?? dispatches[0];
  const pastOnes = dispatches.filter((d) => d !== current);
  const open = !["completed", "cancelled"].includes(wo.status);

  if (!current) {
    return canManage && open ? (
      <Card>
        <CardHeader title="External vendor" />
        <div className="space-y-3 p-5">
          <p className="text-sm text-slate-600">Email this work order to an outside vendor. They get a secure link to accept, update, complete and invoice. No login needed.</p>
          <ButtonLink href={`/work-orders/${wo.id}/dispatch`}>
            <Send className="h-4 w-4" aria-hidden /> Assign to External Vendor
          </ButtonLink>
        </div>
      </Card>
    ) : null;
  }

  const d = current;
  const isLive = !!live;
  const pendingApprovals = approvals.filter((a) => a.dispatch_id === d.id && a.status === "pending");
  const latestInvoice = invoices.find((i) => i.dispatch_id === d.id) ?? invoices[0];
  const linkExpired = new Date(d.token_expires_at) < new Date();
  const myQuotes = quotes.filter((q) => q.dispatch_id === d.id);
  const myCosts = costs.filter((c) => c.dispatch_id === d.id);
  const costTotal = myCosts.reduce((t, c) => t + Number(c.amount), 0);
  const approvedQuote = myQuotes.find((q) => q.status === "approved");

  const milestones: [string, string | null, boolean?][] = [
    [
      "Emailed",
      d.sent_at
        ? fmtDateTime(d.sent_at)
        : d.email_status === "failed"
          ? "Email failed"
          : d.email_status === "not_configured"
            ? "Email not configured"
            : "Not sent",
      d.email_status === "failed" || d.email_status === "not_configured",
    ],
    ["Viewed", d.last_viewed_at ? `${fmtDateTime(d.last_viewed_at)}${d.view_count > 1 ? ` (${d.view_count}×)` : ""}` : "Not yet"],
    d.declined_at ? ["Declined", fmtDateTime(d.declined_at), true] : ["Accepted", d.accepted_at ? fmtDateTime(d.accepted_at) : "Waiting"],
    ...(d.quote_required || myQuotes.length
      ? ([["Quote", myQuotes[0] ? `${QUOTE_LABEL[myQuotes[0].status]} · ${fmtMoney(myQuotes[0].amount, 2)}` : "Required, not sent"]] as [string, string][])
      : []),
    ["Work started", d.started_at ? fmtDateTime(d.started_at) : "—"],
    ["Work completed", d.completed_at ? fmtDateTime(d.completed_at) : "—"],
    ["Invoice", latestInvoice ? `${INVOICE_LABEL[latestInvoice.status]} · ${fmtMoney(latestInvoice.amount, 2)}` : INVOICE_LABEL.none],
  ];

  return (
    <Card id="vendor">
      <CardHeader
        title="External vendor"
        subtitle={d.vendor?.name}
        action={<Badge tone={DISPATCH_TONE[d.status]}>{DISPATCH_LABEL[d.status]}</Badge>}
      />
      <div className="space-y-4 p-5">
        <div className="text-sm">
          <p className="font-medium text-slate-900">
            {d.contact_name ?? d.vendor?.name} · <a className="text-brand-700" href={`mailto:${d.contact_email}`}>{d.contact_email}</a>
          </p>
          <p className="text-xs text-slate-500">
            {d.contact_phone && (
              <>
                <a href={`tel:${d.contact_phone}`}>{d.contact_phone}</a> ·{" "}
              </>
            )}
            Requested by {d.requested_by ? fmtDate(d.requested_by) : "—"} · {PRIORITY_LABEL[wo.priority]}
            {wo.nte_amount != null && ` · NTE ${fmtMoney(wo.nte_amount)}`}
          </p>
        </div>

        <ol className="grid grid-cols-2 gap-2">
          {milestones.map(([k, v, bad]) => (
            <li key={k} className={`rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${bad ? "bg-red-50 ring-red-200" : v && !["Not yet", "Waiting", "—", "Not submitted"].includes(v) ? "bg-slate-50 ring-slate-200" : "ring-slate-100"}`}>
              <p className="text-slate-500">{k}</p>
              <p className={`font-medium ${bad ? "text-red-800" : "text-slate-900"}`}>{v}</p>
            </li>
          ))}
        </ol>
        {d.decline_reason && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">Decline reason: {d.decline_reason}</p>}
        {d.email_error && <p className="text-xs text-red-700">Email error: {d.email_error}</p>}

        {/* Quotes */}
        {myQuotes.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Quotes</p>
            {myQuotes.map((q, i) => (
              <div key={q.id} className={`rounded-lg p-3 ring-1 ring-inset ${q.status === "submitted" ? "bg-orange-50 ring-orange-200" : "ring-slate-200"} ${i > 0 && q.status !== "submitted" ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {q.quote_number ? `Quote ${q.quote_number}` : "Quote"} · {fmtMoney(q.amount, 2)}
                    {q.version > 1 && <span className="ml-1 text-xs font-normal text-slate-500">(revision {q.version})</span>}
                  </p>
                  <Badge tone={QUOTE_TONE[q.status]}>{QUOTE_LABEL[q.status]}</Badge>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{q.scope}</p>
                {q.lines.length > 0 && (
                  <table className="mt-2 w-full text-xs">
                    <tbody className="divide-y divide-slate-100">
                      {q.lines.map((l, j) => (
                        <tr key={j}>
                          <td className="py-1 pr-2 text-slate-500">{COST_CATEGORY_LABEL[l.category]}</td>
                          <td className="py-1 pr-2">{l.description}</td>
                          <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums text-slate-500">
                            {l.quantity} × {fmtMoney(l.unit_cost, 2)}
                          </td>
                          <td className="py-1 text-right tabular-nums">{fmtMoney(l.amount, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {q.submitted_by_label} · {fmtDateTime(q.created_at)}
                  {q.valid_until && <span className={q.valid_until < todayISO() && q.status === "submitted" ? " font-medium text-red-700" : ""}> · valid until {fmtDate(q.valid_until)}</span>}
                  {q.attachment_id && fileUrl.get(q.attachment_id) && (
                    <>
                      {" · "}
                      <a href={fileUrl.get(q.attachment_id)} target="_blank" rel="noreferrer" className="font-medium text-brand-700">
                        View quote file
                      </a>
                    </>
                  )}
                  {q.decision_note && ` · Note: ${q.decision_note}`}
                </p>
                {q.status === "submitted" && canManage && (
                  <form className="mt-2 space-y-2">
                    <input type="hidden" name="quote_id" value={q.id} />
                    <Input name="note" placeholder="Note to vendor (required to reject)" />
                    <div className="flex gap-2">
                      <SubmitButton size="sm" formAction={decideQuote.bind(null, "approved")} confirm={`Approve this quote for ${fmtMoney(q.amount, 2)}?`}>
                        Approve quote
                      </SubmitButton>
                      <SubmitButton size="sm" variant="danger" formAction={decideQuote.bind(null, "rejected")}>
                        Reject
                      </SubmitButton>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Approving sets the not-to-exceed to {fmtMoney(q.amount, 2)}
                      {wo.nte_amount != null && ` (currently ${fmtMoney(wo.nte_amount)})`}
                      {d.quote_required && d.status !== "in_progress" && " and lets the vendor start work"}.
                    </p>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
        {d.quote_required && myQuotes.length === 0 && isLive && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">Waiting for the vendor&apos;s quote. They can&apos;t start work until you approve one.</p>
        )}

        {/* Vendor-reported costs */}
        {myCosts.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Vendor costs</p>
              <p className="text-sm font-semibold tabular-nums">{fmtMoney(costTotal, 2)}</p>
            </div>
            <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-inset ring-slate-200">
              {myCosts.map((c) => (
                <li key={c.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-900">{c.description}</p>
                    <p className="text-xs text-slate-500">
                      {COST_CATEGORY_LABEL[c.category]} · {Number(c.quantity)} × {fmtMoney(c.unit_cost, 2)} · {c.added_by_label ?? "vendor"}, {fmtDateTime(c.created_at)}
                      {c.attachment_id && fileUrl.get(c.attachment_id) && (
                        <>
                          {" · "}
                          <a href={fileUrl.get(c.attachment_id)} target="_blank" rel="noreferrer" className="font-medium text-brand-700">
                            Receipt
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="tabular-nums">{fmtMoney(c.amount, 2)}</span>
                </li>
              ))}
            </ul>
            {(() => {
              const cap = wo.nte_amount != null ? Number(wo.nte_amount) : approvedQuote ? Number(approvedQuote.amount) : null;
              if (cap == null) return null;
              const over = costTotal > cap;
              return (
                <p className={`text-xs ${over ? "font-medium text-orange-700" : "text-slate-500"}`}>
                  {over ? `Over the not-to-exceed by ${fmtMoney(costTotal - cap, 2)}` : `${fmtMoney(cap - costTotal, 2)} left under the not-to-exceed`} ({fmtMoney(cap)}).
                  {" "}The work order&apos;s cost updates when you approve the invoice.
                </p>
              );
            })()}
          </div>
        )}

        {/* Additional work approvals */}
        {approvals.filter((a) => a.dispatch_id === d.id).map((a) => (
          <div key={a.id} className={`rounded-lg p-3 ring-1 ring-inset ${a.status === "pending" ? "bg-orange-50 ring-orange-200" : "ring-slate-200"}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Additional work request{a.amount != null && ` · ${fmtMoney(a.amount, 2)}`}</p>
              <Badge tone={APPROVAL_TONE[a.status]}>{APPROVAL_LABEL[a.status]}</Badge>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{a.description}</p>
            <p className="mt-1 text-xs text-slate-500">
              {a.requested_by_label} · {fmtDateTime(a.created_at)}
              {a.decision_note && ` · Note: ${a.decision_note}`}
            </p>
            {a.status === "pending" && canManage && (
              <form className="mt-2 space-y-2">
                <input type="hidden" name="approval_id" value={a.id} />
                <Input name="note" placeholder="Note to vendor (optional)" />
                <div className="flex gap-2">
                  <SubmitButton size="sm" formAction={decideApproval.bind(null, "approved")}>Approve</SubmitButton>
                  <SubmitButton size="sm" variant="danger" formAction={decideApproval.bind(null, "rejected")} confirm="Reject this request?">
                    Reject
                  </SubmitButton>
                </div>
                {wo.nte_amount != null && a.amount != null && <p className="text-[11px] text-slate-500">Approving raises the NTE to {fmtMoney(Number(wo.nte_amount) + Number(a.amount))}.</p>}
              </form>
            )}
          </div>
        ))}

        {/* Completed work review */}
        {d.status === "work_completed" && canManage && (
          <div className="rounded-lg bg-orange-50 p-3 ring-1 ring-inset ring-orange-200">
            <p className="text-sm font-medium">Vendor marked work complete — review</p>
            {d.completion_notes && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{d.completion_notes}</p>}
            <form className="mt-2 space-y-2">
              <input type="hidden" name="dispatch_id" value={d.id} />
              <Input name="note" placeholder="Note (required to send back)" />
              <div className="flex flex-wrap gap-2">
                <SubmitButton size="sm" formAction={reviewWork.bind(null, "close")}>Approve &amp; close work order</SubmitButton>
                <SubmitButton size="sm" variant="secondary" formAction={reviewWork.bind(null, "send_back")}>
                  Send back to vendor
                </SubmitButton>
              </div>
              <p className="text-[11px] text-slate-500">Closing doesn&rsquo;t require an invoice. The vendor can still submit one afterward.</p>
            </form>
          </div>
        )}

        {/* Invoices */}
        {invoices.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Invoices</p>
            {invoices.map((inv, i) => (
              <div key={inv.id} className={`rounded-lg p-3 ring-1 ring-inset ring-slate-200 ${i > 0 ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {inv.invoice_number} · {fmtMoney(inv.amount, 2)}
                    {inv.version > 1 && <span className="ml-1 text-xs text-slate-500">(revision {inv.version})</span>}
                  </p>
                  <Badge tone={INVOICE_TONE[inv.status]}>{INVOICE_LABEL[inv.status]}</Badge>
                </div>
                <p className="text-xs text-slate-500">
                  Dated {fmtDate(inv.invoice_date)} · submitted {fmtDateTime(inv.created_at)} by {inv.submitted_by_label ?? "vendor"}
                  {inv.attachment_id && fileUrl.get(inv.attachment_id) && (
                    <>
                      {" · "}
                      <a href={fileUrl.get(inv.attachment_id)} target="_blank" rel="noreferrer" className="font-medium text-brand-700">
                        View invoice file
                      </a>
                    </>
                  )}
                </p>
                {inv.notes && <p className="mt-1 text-sm text-slate-700">{inv.notes}</p>}
                {inv.review_note && <p className="mt-1 text-xs text-slate-600">Review note: {inv.review_note}</p>}
                {inv.status === "paid" && (
                  <p className="mt-1 text-xs text-emerald-700">
                    Paid {fmtDate(inv.paid_at)}
                    {inv.payment_reference && ` · ref ${inv.payment_reference}`}
                  </p>
                )}
                {wo.nte_amount != null && inv.amount > Number(wo.nte_amount) && !["paid", "rejected"].includes(inv.status) && (
                  <p className="mt-1 text-xs font-medium text-orange-700">Over NTE ({fmtMoney(wo.nte_amount)})</p>
                )}
                {profile.role === "admin" && i === 0 && ["submitted", "under_review", "approved"].includes(inv.status) && (
                  <form className="mt-2 space-y-2">
                    <input type="hidden" name="invoice_id" value={inv.id} />
                    {inv.status === "approved" ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Input type="date" name="paid_at" defaultValue={todayISO()} aria-label="Paid date" />
                        <Input name="payment_reference" placeholder="Check # / ACH ref" />
                      </div>
                    ) : (
                      <Input name="note" placeholder="Note (required to request a revision)" />
                    )}
                    <div className="flex flex-wrap gap-2">
                      {inv.status === "submitted" && (
                        <SubmitButton size="sm" variant="secondary" formAction={reviewInvoice.bind(null, "under_review")}>
                          Mark under review
                        </SubmitButton>
                      )}
                      {inv.status !== "approved" && (
                        <>
                          <SubmitButton size="sm" formAction={reviewInvoice.bind(null, "approved")}>Approve</SubmitButton>
                          <SubmitButton size="sm" variant="danger" formAction={reviewInvoice.bind(null, "rejected")}>
                            Request revision
                          </SubmitButton>
                        </>
                      )}
                      {inv.status === "approved" && <SubmitButton size="sm" formAction={reviewInvoice.bind(null, "paid")}>Mark paid</SubmitButton>}
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Link + communication */}
        {canManage && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            {isLive && (
              <>
                <p className="text-xs text-slate-500">
                  Secure link {linkExpired ? <b className="text-red-700">expired</b> : <>valid until {fmtDate(d.token_expires_at)}</>}. Resending creates a new link and turns off the old one.
                </p>
                <form action={messageVendor} className="flex gap-2">
                  <input type="hidden" name="dispatch_id" value={d.id} />
                  <Input name="body" required placeholder="Message the vendor (emails them)" />
                  <SubmitButton size="sm" variant="secondary" pendingText="…">
                    Send
                  </SubmitButton>
                </form>
                <details className="rounded-lg ring-1 ring-slate-200">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">Edit instructions, date or priority</summary>
                  <form action={updateDispatch} className="space-y-3 border-t border-slate-100 p-3">
                    <input type="hidden" name="dispatch_id" value={d.id} />
                    <Field label="Special instructions">
                      <Textarea name="instructions" defaultValue={d.instructions ?? ""} />
                    </Field>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Requested by">
                        <Input type="date" name="requested_by" defaultValue={d.requested_by ?? ""} />
                      </Field>
                      <Field label="Priority">
                        <Select name="priority" defaultValue={wo.priority}>
                          {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="NTE $">
                        <Input name="nte_amount" inputMode="decimal" defaultValue={wo.nte_amount ?? ""} />
                      </Field>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="quote_required" defaultChecked={!!d.quote_required} className="rounded border-slate-300" /> Require an approved quote before work starts
                    </label>
                    <Input name="note" placeholder="What changed? (included in the email)" />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="notify" defaultChecked className="rounded border-slate-300" /> Email the vendor about the change
                    </label>
                    <SubmitButton size="sm">Save changes</SubmitButton>
                  </form>
                </details>
                <div className="flex flex-wrap gap-2">
                  <form action={resendLink}>
                    <input type="hidden" name="dispatch_id" value={d.id} />
                    <SubmitButton size="sm" variant="secondary" pendingText="Sending…">
                      Resend link
                    </SubmitButton>
                  </form>
                  <form action={revokeLink}>
                    <input type="hidden" name="dispatch_id" value={d.id} />
                    <SubmitButton size="sm" variant="danger" confirm="Revoke this vendor's access to the work order?">
                      Revoke access
                    </SubmitButton>
                  </form>
                </div>
              </>
            )}
            {!isLive && open && (
              <ButtonLink href={`/work-orders/${wo.id}/dispatch`} size="sm">
                <Send className="h-3.5 w-3.5" aria-hidden /> Assign to {d.status === "declined" ? "another" : "an"} external vendor
              </ButtonLink>
            )}
          </div>
        )}

        {pastOnes.length > 0 && (
          <p className="text-xs text-slate-500">
            Earlier: {pastOnes.map((p) => `${p.vendor?.name} (${DISPATCH_LABEL[p.status].toLowerCase()}, ${fmtDate(p.created_at)})`).join(" · ")}
          </p>
        )}
        {pendingApprovals.length === 0 && !isLive && d.status === "closed" && (
          <p className="text-xs text-slate-500">
            Closed {fmtDateTime(d.closed_at)}. <Link className="text-brand-700" href="/vendor-jobs">All vendor work →</Link>
          </p>
        )}
      </div>
    </Card>
  );
}
