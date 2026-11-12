import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CheckCircle2, Clock, FileText, MapPin, Navigation, Phone, Wrench } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPortal, maskEmail, resolveToken } from "@/lib/vendor-portal";
import { INVOICE_LABEL, INVOICE_TONE, PRIORITY_LABEL, PRIORITY_TONE, APPROVAL_LABEL, APPROVAL_TONE } from "@/lib/constants";
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from "@/lib/format";
import type { DispatchStatus } from "@/lib/types";
import { Alert, Badge, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { PhotoInput } from "@/components/PhotoInput";
import { acceptJob, completeWork, declineJob, postUpdate, requestApproval, requestNewLink, startWork, submitInvoice } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Work order", robots: { index: false, follow: false }, referrer: "no-referrer" };

const COMPANY = process.env.NEXT_PUBLIC_COMPANY_NAME || "MaintainOS";

const VENDOR_STATUS: Record<DispatchStatus, [string, "info" | "warning" | "serious" | "good" | "muted" | "critical"]> = {
  sent: ["Awaiting your response", "info"],
  accepted: ["Accepted — not started", "info"],
  in_progress: ["In progress", "warning"],
  pending_approval: ["Waiting on approval", "serious"],
  work_completed: ["Completed — under review", "good"],
  closed: ["Closed", "good"],
  declined: ["Declined", "muted"],
  revoked: ["Access removed", "muted"],
};

const OK: Record<string, string> = {
  accepted: "Thanks — you've accepted this work order. Tap “Start Work” when you arrive on site.",
  declined: "You've declined this work order. We'll reassign it. Thank you for letting us know.",
  started: "Work started — time recorded. Post updates and photos as you go.",
  update: "Update posted. The team has been notified.",
  approval: "Approval request sent. You'll get an email when it's decided.",
  completed: "Work marked complete and sent for review. You can submit your invoice below now or later.",
  completed_invoice: "Work marked complete and your invoice was submitted. You'll get an email when it's reviewed.",
  invoice: "Invoice submitted. You'll get an email when it's reviewed.",
};

export default async function VendorPortal({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  // Only show a masked address we generated — never arbitrary text from the URL.
  if (sp.sent && !/^[\w.+-]{1,2}•+@[\w.-]+$/.test(sp.sent)) sp.sent = undefined;
  const db = createAdminClient();
  const r = await resolveToken(db, token);

  if (r.state === "invalid")
    return (
      <Shell>
        {sp.sent ? (
          <Message title="Check your email" body={`We sent a new link to ${sp.sent}. It may take a minute to arrive. This old link no longer works.`} />
        ) : (
          <Message title="This link isn't valid" body="Please use the “View Work Order” button in your most recent email. If you can't find it, contact the person who assigned the work." />
        )}
      </Shell>
    );
  if (r.state === "revoked") return <Shell><Message title="This work order is no longer assigned to you" body="Access to this link was removed. If you think this is a mistake, contact the person who assigned the work." /></Shell>;
  if (r.state === "closed_wo") return <Shell><Message title="This work order was cancelled" body="No further action is needed." /></Shell>;
  if (r.state === "declined") return <Shell><Message title="You declined this work order" body={`Reason given: ${r.dispatch.decline_reason ?? "—"}. Thanks for letting us know.`} /></Shell>;
  if (r.state === "expired")
    return (
      <Shell>
        <Message title="This link has expired" body={sp.sent ? `A new link has been emailed to ${sp.sent}. It may take a minute to arrive.` : `For security, work order links expire. We can email a new link to the address on file (${maskEmail(r.dispatch.contact_email)}).`}>
          {!sp.sent && (
            <form action={requestNewLink.bind(null, token)} className="mt-4">
              <SubmitButton pendingText="Sending…">Email me a new link</SubmitButton>
            </form>
          )}
        </Message>
      </Shell>
    );

  const d = r.dispatch;
  // Record the view (best effort).
  await db.from("vendor_dispatches").update({ last_viewed_at: new Date().toISOString(), view_count: (d.view_count ?? 0) + 1 }).eq("id", d.id);
  const data = await loadPortal(db, d);
  const actorName = (await cookies()).get("mos_vendor_name")?.value ?? d.contact_name ?? "";
  const key = () => crypto.randomUUID();
  const [statusLabel, statusTone] = VENDOR_STATUS[d.status];
  const { wo, site } = data;
  const address = [site?.address, [site?.city, site?.state].filter(Boolean).join(", "), site?.zip].filter(Boolean).join(" ");
  const canWork = ["accepted", "in_progress", "pending_approval"].includes(d.status);
  const pendingApproval = data.approvals.find((a) => a.status === "pending");
  const latestInvoice = data.invoices[0];
  const invoiceOpen = ["work_completed", "closed"].includes(d.status) && (!latestInvoice || latestInvoice.status === "rejected");

  const NameField = () => (
    <Field label="Your name">
      <Input name="actor" defaultValue={actorName} required maxLength={80} autoComplete="name" />
    </Field>
  );

  return (
    <Shell>
      <div id="top" className="space-y-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Work order #{wo.number} · {d.vendor?.name}
          </p>
          <h1 className="mt-1 text-xl font-semibold leading-snug text-slate-900">{wo.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={statusTone}>{statusLabel}</Badge>
            <Badge tone={PRIORITY_TONE[wo.priority]}>{PRIORITY_LABEL[wo.priority]} priority</Badge>
            {d.requested_by && (
              <Badge tone={d.requested_by < todayISO() && !["work_completed", "closed"].includes(d.status) ? "critical" : "neutral"} dot={false}>
                Needed by {fmtDate(d.requested_by)}
              </Badge>
            )}
          </div>
        </div>

        {sp.error && <Alert>{sp.error}</Alert>}
        {sp.ok && OK[sp.ok] && <Alert tone="good">{OK[sp.ok]}</Alert>}

        {/* -------- What to do next -------- */}
        {d.status === "sent" && (
          <Card className="p-4">
            <p className="text-sm font-semibold">Can you take this job?</p>
            <form className="mt-3 space-y-3">
              <NameField />
              <div className="grid grid-cols-2 gap-2">
                <SubmitButton formAction={acceptJob.bind(null, token)} pendingText="Accepting…">
                  Accept work order
                </SubmitButton>
                <SubmitButton variant="secondary" formAction={startWork.bind(null, token)} pendingText="Starting…">
                  I&apos;m on site — Start
                </SubmitButton>
              </div>
            </form>
            <DeclineForm token={token} actorName={actorName} />
          </Card>
        )}

        {d.status === "accepted" && (
          <Card className="p-4">
            <p className="text-sm font-semibold">Accepted {fmtDateTime(d.accepted_at)}</p>
            <p className="text-sm text-slate-600">Tap Start Work when you arrive. We&apos;ll record the time.</p>
            <form className="mt-3 space-y-3">
              <NameField />
              <SubmitButton formAction={startWork.bind(null, token)} pendingText="Starting…">
                <Clock className="h-4 w-4" aria-hidden /> Start Work
              </SubmitButton>
            </form>
            <DeclineForm token={token} actorName={actorName} />
          </Card>
        )}

        {(canWork || d.status === "work_completed") && (
          <Card>
            <CardHeader
              title={d.status === "work_completed" ? "Submitted for review" : `Working since ${d.started_at ? fmtDateTime(d.started_at) : "—"}`}
              subtitle={d.status === "work_completed" ? `Completed ${fmtDateTime(d.completed_at)}` : undefined}
            />
            {pendingApproval && (
              <div className="mx-4 mt-4 rounded-lg bg-orange-50 p-3 text-sm ring-1 ring-orange-200">
                <b>Waiting on approval</b>
                {pendingApproval.amount != null && ` (${fmtMoney(pendingApproval.amount, 2)})`}: {pendingApproval.description}
              </div>
            )}
            <div className="divide-y divide-slate-100">
              <Panel title="Add an update or photos" open={d.status === "in_progress" && !sp.ok}>
                <form action={postUpdate.bind(null, token)} className="space-y-3">
                  <input type="hidden" name="client_key" value={key()} />
                  <NameField />
                  <Field label="Progress notes">
                    <Textarea name="notes" rows={3} placeholder="What you found / what you did" />
                  </Field>
                  <Field label="Materials used">
                    <Input name="materials" placeholder="e.g. 45/5 MFD capacitor, contactor" />
                  </Field>
                  <Field label="Need anything else?">
                    <Select name="needs" defaultValue="none">
                      <option value="none">No — on track</option>
                      <option value="parts">Need to order parts</option>
                      <option value="visit">Need another visit</option>
                      <option value="both">Parts and another visit</option>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <Field label="Photos">
                      <PhotoInput name="photos" />
                    </Field>
                    <Select name="photo_kind" defaultValue="before" className="w-auto" aria-label="Photo type">
                      <option value="before">Before</option>
                      <option value="after">After</option>
                      <option value="photo">Other</option>
                    </Select>
                  </div>
                  <SubmitButton pendingText="Uploading…">Post update</SubmitButton>
                </form>
              </Panel>

              {canWork && (
                <Panel title="Request approval for additional work">
                  <form action={requestApproval.bind(null, token)} className="space-y-3">
                    <input type="hidden" name="client_key" value={key()} />
                    <NameField />
                    {wo.nte_amount != null && <p className="text-xs text-slate-500">Current not-to-exceed: {fmtMoney(wo.nte_amount, 2)}</p>}
                    <Field label="What's needed and why">
                      <Textarea name="description" required rows={3} placeholder="e.g. Compressor is shorted; replacement needed." />
                    </Field>
                    <Field label="Estimated additional cost ($)">
                      <Input name="amount" inputMode="decimal" placeholder="0.00" />
                    </Field>
                    <SubmitButton variant="secondary" pendingText="Sending…">
                      Request approval
                    </SubmitButton>
                  </form>
                </Panel>
              )}

              {canWork && (
                <Panel title="Mark work complete" highlight>
                  <form action={completeWork.bind(null, token)} className="space-y-3">
                    <NameField />
                    <Field label="Work performed">
                      <Textarea name="work_performed" required rows={4} placeholder="What was repaired or replaced, test results, anything the store should know" />
                    </Field>
                    {wo.type === "compliance" && (
                      <div className="space-y-3 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Compliance certificate (required)</p>
                        <Field label="Certificate / tag / report #">
                          <Input name="certificate_number" defaultValue={wo.certificate_number ?? ""} />
                        </Field>
                        <Field label="Certificate or inspection report (PDF or photo)">
                          <PhotoInput name="certificate_files" required accept="application/pdf,image/*" />
                        </Field>
                      </div>
                    )}
                    <Field label="Completion photos">
                      <PhotoInput name="photos" />
                    </Field>
                    {!latestInvoice && (
                      <div className="space-y-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Invoice</p>
                          <p className="text-xs text-slate-500">Attach it now to finish in one step, or leave this blank and submit it later from this link.</p>
                        </div>
                        <input type="hidden" name="inv_client_key" value={key()} />
                        <Field label="Invoice file (PDF, JPG or PNG)">
                          <PhotoInput name="inv_invoice_file" multiple={false} accept="application/pdf,image/jpeg,image/png" />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Invoice #">
                            <Input name="inv_invoice_number" />
                          </Field>
                          <Field label="Invoice date">
                            <Input type="date" name="inv_invoice_date" defaultValue={todayISO()} />
                          </Field>
                        </div>
                        <Field label="Invoice total ($)">
                          <Input name="inv_amount" inputMode="decimal" placeholder="0.00" />
                        </Field>
                        {wo.nte_amount != null && <p className="text-xs text-slate-500">Approved not-to-exceed: {fmtMoney(wo.nte_amount, 2)}</p>}
                        <Field label="Invoice notes (optional)">
                          <Input name="inv_notes" />
                        </Field>
                      </div>
                    )}
                    <SubmitButton pendingText="Submitting…" confirm="Mark this work order complete and send it for review?">
                      <CheckCircle2 className="h-4 w-4" aria-hidden /> Mark Work Complete
                    </SubmitButton>
                  </form>
                </Panel>
              )}
            </div>
          </Card>
        )}

        {d.status === "closed" && <Alert tone="good">This work order is closed. Thank you! {!latestInvoice && "You can still submit your invoice below."}</Alert>}

        {/* -------- Invoice -------- */}
        <Card>
          <CardHeader title="Invoice" action={<Badge tone={INVOICE_TONE[latestInvoice?.status ?? "none"]}>{INVOICE_LABEL[latestInvoice?.status ?? "none"]}</Badge>} />
          <div className="space-y-3 p-4">
            {data.invoices.map((inv, i) => (
              <div key={inv.id} className={`rounded-lg p-3 text-sm ring-1 ring-slate-200 ${i ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {inv.invoice_number} · {fmtMoney(inv.amount, 2)}
                  </span>
                  <Badge tone={INVOICE_TONE[inv.status]}>{INVOICE_LABEL[inv.status]}</Badge>
                </div>
                <p className="text-xs text-slate-500">
                  Dated {fmtDate(inv.invoice_date)} · submitted {fmtDateTime(inv.created_at)}
                  {inv.file_url && (
                    <>
                      {" · "}
                      <a href={inv.file_url} target="_blank" rel="noreferrer" className="text-brand-700">
                        View file
                      </a>
                    </>
                  )}
                </p>
                {inv.review_note && <p className="mt-1 text-sm text-red-800">Note from reviewer: {inv.review_note}</p>}
                {inv.status === "paid" && <p className="mt-1 text-xs text-emerald-700">Paid {fmtDate(inv.paid_at)}{inv.payment_reference && ` · ref ${inv.payment_reference}`}</p>}
              </div>
            ))}
            {invoiceOpen ? (
              <form action={submitInvoice.bind(null, token)} className="space-y-3">
                <input type="hidden" name="client_key" value={key()} />
                <NameField />
                <Field label="Invoice file (PDF, JPG or PNG)">
                  <PhotoInput name="invoice_file" required multiple={false} accept="application/pdf,image/jpeg,image/png" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Invoice #">
                    <Input name="invoice_number" required />
                  </Field>
                  <Field label="Invoice date">
                    <Input type="date" name="invoice_date" required defaultValue={todayISO()} />
                  </Field>
                </div>
                <Field label="Total amount ($)">
                  <Input name="amount" inputMode="decimal" required placeholder="0.00" />
                </Field>
                <Field label="Notes (optional)">
                  <Textarea name="notes" rows={2} />
                </Field>
                <SubmitButton pendingText="Uploading…" confirm="Submit this invoice?">
                  <FileText className="h-4 w-4" aria-hidden /> {latestInvoice ? "Submit revised invoice" : "Submit invoice"}
                </SubmitButton>
              </form>
            ) : (
              !latestInvoice && (
                <p className="text-sm text-slate-500">
                  {canWork ? "Add your invoice in the “Mark work complete” form above, or submit it here after completing." : "You can submit your invoice here once the work is marked complete."}
                </p>
              )
            )}
          </div>
        </Card>

        {/* -------- Job details -------- */}
        <Card>
          <CardHeader title="Job details" />
          <div className="space-y-4 p-4 text-sm">
            <div>
              <p className="font-semibold text-slate-900">
                {site?.name}
                {site?.code && <span className="font-normal text-slate-500"> · Store {site.code}</span>}
              </p>
              {address && (
                <p className="mt-0.5 flex items-start gap-1 text-slate-600">
                  <MapPin className="mt-0.5 h-4 w-4 flex-none" aria-hidden /> {address}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {address && (
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" className={pill}>
                    <Navigation className="h-3.5 w-3.5" aria-hidden /> Directions
                  </a>
                )}
                {site?.phone && (
                  <a href={`tel:${site.phone}`} className={pill}>
                    <Phone className="h-3.5 w-3.5" aria-hidden /> Call store {site.phone}
                  </a>
                )}
              </div>
              {data.requester?.full_name && (
                <p className="mt-2 text-slate-600">
                  Requested by {data.requester.full_name}
                  {data.requester.phone && (
                    <>
                      {" · "}
                      <a href={`tel:${data.requester.phone}`} className="text-brand-700">
                        {data.requester.phone}
                      </a>
                    </>
                  )}
                </p>
              )}
            </div>
            {d.instructions && (
              <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Special instructions</p>
                <p className="mt-1 whitespace-pre-wrap text-slate-900">{d.instructions}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Issue</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-900">{wo.description || wo.title}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <Def k="Category" v={wo.category} />
              <Def k="Where" v={wo.location_detail} />
              {data.asset && <Def k="Equipment" v={[data.asset.name, data.asset.manufacturer, data.asset.model].filter(Boolean).join(" · ")} />}
              {data.asset?.serial_number && <Def k="Serial #" v={data.asset.serial_number} />}
              <Def k="Needed by" v={d.requested_by ? fmtDate(d.requested_by) : null} />
              <Def k="Not to exceed" v={wo.nte_amount != null ? fmtMoney(wo.nte_amount, 2) : null} />
            </dl>
          </div>
        </Card>

        {data.files.length > 0 && (
          <Card>
            <CardHeader title="Photos & attachments" subtitle={`${data.files.length} file${data.files.length === 1 ? "" : "s"}`} />
            <ul className="grid grid-cols-3 gap-2 p-4">
              {data.files.map((f) => (
                <li key={f.id}>
                  <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="block">
                    {f.content_type?.startsWith("image/") && f.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.url} alt={f.file_name} className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-200" />
                    ) : (
                      <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-50 ring-1 ring-slate-200">
                        <FileText className="h-6 w-6 text-slate-400" aria-hidden />
                      </div>
                    )}
                    <p className="mt-1 truncate text-[11px] text-slate-500">
                      {f.category !== "photo" && <span className="font-medium capitalize text-slate-700">{f.category} · </span>}
                      {f.file_name}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {(data.approvals.length > 0 || data.events.length > 0) && (
          <Card>
            <CardHeader title="Activity" />
            <ul className="space-y-3 p-4 text-sm">
              {data.approvals
                .filter((a) => a.status !== "pending")
                .map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2">
                    <span>
                      Additional work{a.amount != null && ` (${fmtMoney(a.amount, 2)})`}: {a.description}
                      {a.decision_note && <span className="block text-xs text-slate-500">Note: {a.decision_note}</span>}
                    </span>
                    <Badge tone={APPROVAL_TONE[a.status]}>{APPROVAL_LABEL[a.status]}</Badge>
                  </li>
                ))}
              {data.events.map((e) => (
                <li key={e.id} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-xs text-slate-500">
                    {e.actor_type === "vendor" ? e.actor_label : e.staff ? `${e.staff} (${COMPANY})` : COMPANY} · {fmtDateTime(e.created_at)}
                  </p>
                  <p className="whitespace-pre-wrap text-slate-800">
                    {e.kind === "status" ? `Status: ${statusWord(e.to_status)}` : e.body}
                  </p>
                  {typeof e.meta?.materials === "string" && e.meta.materials && <p className="text-xs text-slate-500">Materials: {e.meta.materials}</p>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <p className="pb-8 text-center text-xs text-slate-400">
          This page is private to {d.vendor?.name}. Link valid until {fmtDate(d.token_expires_at)}.
          {process.env.EMAIL_REPLY_TO && (
            <>
              {" "}
              Questions? <a className="underline" href={`mailto:${process.env.EMAIL_REPLY_TO}?subject=${encodeURIComponent(`WO #${wo.number}`)}`}>Email us</a>.
            </>
          )}
        </p>
      </div>
    </Shell>
  );
}

const pill = "inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300";

function statusWord(s: string | null) {
  return (
    { new: "Open", assigned: "Assigned", in_progress: "In progress", on_hold: "On hold", pending_approval: "Pending approval", pending_review: "Work completed — pending review", completed: "Closed", cancelled: "Cancelled" } as Record<string, string>
  )[s ?? ""] ?? s ?? "";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-slate-900">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500">
            <Wrench className="h-4 w-4 text-white" aria-hidden />
          </div>
          <span className="font-semibold text-white">{COMPANY}</span>
          <span className="ml-auto text-xs text-slate-400">Vendor work order</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-5">{children}</main>
    </div>
  );
}

function Message({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <Card className="p-6 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
      {children}
    </Card>
  );
}

function Panel({ title, children, open, highlight }: { title: string; children: React.ReactNode; open?: boolean; highlight?: boolean }) {
  return (
    <details open={open} className="group">
      <summary className={`flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold ${highlight ? "text-brand-700" : "text-slate-800"}`}>
        {title}
        <span className="text-slate-400 transition group-open:rotate-90">›</span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function DeclineForm({ token, actorName }: { token: string; actorName: string }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm text-slate-500 underline">Can&apos;t take it? Decline</summary>
      <form action={declineJob.bind(null, token)} className="mt-2 space-y-2">
        <input type="hidden" name="actor" value={actorName} />
        <Textarea name="reason" required rows={2} placeholder="Reason (e.g. no availability until next week)" />
        <SubmitButton variant="danger" size="sm" pendingText="Declining…" confirm="Decline this work order?">
          Decline work order
        </SubmitButton>
      </form>
    </details>
  );
}

function Def({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <div>
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className="text-slate-900">{v}</dd>
    </div>
  );
}

