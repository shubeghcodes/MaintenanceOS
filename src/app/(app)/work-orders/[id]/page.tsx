import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, isSuper } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { listAttachments } from "@/lib/attachments";
import { CATEGORIES, PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/constants";
import { fmtDate, fmtDateTime, fmtMoney, fmtTime, personName, toDateInput } from "@/lib/format";
import type { Profile, WorkOrder, WorkOrderEvent, WoStatus } from "@/lib/types";
import { Alert, ButtonLink, Card, CardHeader, DefList, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { OverdueBadge, PriorityBadge, StatusBadge, TypeBadge } from "@/components/badges";
import { SubmitButton } from "@/components/SubmitButton";
import { Attachments } from "@/components/Attachments";
import { addComment, approveWorkOrder, closeForGm, declineWorkOrder, deleteWorkOrder, sendBackNotFixed, setStatus, signOffWorkOrder, updateAssignment, updateCosts, uploadWoFiles } from "../actions";
import { addDaysISO } from "@/lib/format";
import { SIGNOFF_AUTO_CLOSE_DAYS } from "@/lib/constants";
import { Send } from "lucide-react";
import { VendorPanel } from "./VendorPanel";
import { ReceiptsCard } from "./ReceiptsCard";
import { TimeCard } from "./TimeCard";
import { fmtHours } from "@/lib/labor";

const TIMER_NOTICE: Record<string, string> = {
  started: "Timer started.",
  resumed: "Timer resumed.",
  paused: "Timer paused.",
  stopped: "Timer stopped. Hours were added to this work order.",
  added: "Time added and recorded in the adjustment history.",
  edited: "Time adjusted and recorded in the adjustment history.",
  voided: "Time entry voided and recorded in the adjustment history.",
};
function timerNotice(v: string) {
  const m = v.match(/^(\w+?)_paused_(\d+)$/);
  if (m) return `${TIMER_NOTICE[m[1]] ?? "Timer started."} Your timer on work order #${m[2]} was paused, since only one timer can run at a time.`;
  return TIMER_NOTICE[v];
}

const RECEIPT_NOTICE: Record<string, string> = {
  added: "Receipt saved and added to this work order's cost.",
  approved: "Receipt approved.",
  rejected: "Receipt rejected. It no longer counts toward the cost.",
  reimbursed: "Marked reimbursed.",
  deleted: "Receipt deleted.",
};
import { AutoRefresh } from "@/components/AutoRefresh";

const VENDOR_NOTICE: Record<string, string> = {
  sent: "Work order emailed to the vendor.",
  resent: "New link emailed to the vendor. The previous link no longer works.",
  revoked: "Vendor access revoked.",
  updated: "Vendor details updated.",
  messaged: "Message sent to the vendor.",
  approved: "Additional work approved. The vendor has been notified.",
  rejected: "Additional work rejected. The vendor has been notified.",
  closed: "Work approved and work order closed.",
  sent_back: "Sent back to the vendor for follow-up.",
  invoice_under_review: "Invoice marked under review.",
  quote_approved: "Quote approved and the not-to-exceed updated. The vendor has been notified.",
  quote_rejected: "Quote not approved. The vendor has been notified and can send a revision.",
  invoice_approved: "Invoice approved. The vendor has been notified.",
  invoice_rejected: "Revision requested. The vendor has been notified.",
  invoice_paid: "Invoice marked paid.",
};

type Detail = WorkOrder & {
  site: { id: string; name: string; code: string | null; address: string | null; city: string | null; phone: string | null } | null;
  asset: { id: string; name: string; tag: string | null; manufacturer: string | null; model: string | null } | null;
  vendor: { id: string; name: string; phone: string | null; email: string | null } | null;
  tech: Pick<Profile, "id" | "full_name" | "email" | "phone"> | null;
  requester: Pick<Profile, "id" | "full_name" | "email" | "phone"> | null;
};

/** Which status buttons each role sees from each status. */
function nextStatuses(role: Profile["role"], current: WoStatus, isRequester: boolean): WoStatus[] {
  if (current === "completed" || current === "cancelled") return role === "admin" ? ["in_progress"] : [];
  // Waiting for the GM: the sign-off card handles it.
  if (current === "awaiting_signoff") return [];
  // Waiting for approval: admins use the approval card; the person who asked can withdraw it.
  if (current === "requested") return role !== "admin" && isRequester ? ["cancelled"] : [];
  switch (role) {
    case "admin":
      return (["in_progress", "on_hold", "completed", "cancelled"] as WoStatus[]).filter((s) => s !== current);
    case "tech":
      return (["in_progress", "on_hold", "completed"] as WoStatus[]).filter((s) => s !== current);
    case "vendor":
      return (["in_progress", "on_hold", "completed"] as WoStatus[]).filter((s) => s !== current);
    case "manager":
      return current === "new" && isRequester ? ["cancelled"] : [];
  }
}

const STATUS_VERB: Partial<Record<WoStatus, string>> = {
  in_progress: "Start work",
  on_hold: "Put on hold",
  completed: "Mark complete",
  cancelled: "Cancel",
};

export default async function WorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await getSession();

  const { data } = await supabase
    .from("work_orders")
    .select(
      "*, site:sites(id,name,code,address,city,phone), asset:assets(id,name,tag,manufacturer,model)," +
        "vendor:vendors(id,name,phone,email)," +
        "tech:profiles!work_orders_assigned_tech_id_fkey(id,full_name,email,phone)," +
        "requester:profiles!work_orders_requested_by_fkey(id,full_name,email,phone)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const wo = data as unknown as Detail;

  const [{ data: evData }, files, lookups] = await Promise.all([
    supabase
      .from("work_order_events")
      .select("*, user:profiles(full_name,email)")
      .eq("work_order_id", id)
      .order("created_at", { ascending: true }),
    listAttachments(supabase, "work_order", id),
    profile.role === "admin" || profile.role === "tech" ? getLookups(supabase, { allCompanies: true }) : Promise.resolve(null),
  ]);
  const events = ((evData ?? []) as (WorkOrderEvent & { user: { full_name: string | null; email: string | null } | null })[]).filter(
    (e) => profile.role !== "vendor" || e.visibility === "shared",
  );

  const { data: laborRow } =
    profile.role === "admin" ? await supabase.from("wo_labor_costs").select("hours,labor_cost,missing_rate").eq("work_order_id", id).maybeSingle() : { data: null };
  const labor = laborRow as { hours: number; labor_cost: number; missing_rate: boolean } | null;
  const laborCost = Number(labor?.labor_cost ?? 0);
  const partsTotal = Number(wo.purchases_cost || 0) + Number(wo.parts_cost || 0);
  const rmTotal = Number(wo.total_cost || 0) + laborCost;

  const role = profile.role;
  const awaiting = wo.status === "requested";
  const signoff = wo.status === "awaiting_signoff";
  const closesOn = wo.signoff_requested_at ? addDaysISO(toDateInput(wo.signoff_requested_at), SIGNOFF_AUTO_CLOSE_DAYS) : null;
  const signer = wo.signed_off_by ? (await supabase.from("profiles").select("full_name,email").eq("id", wo.signed_off_by).maybeSingle()).data : null;
  const canAssign = (role === "admin" || role === "tech") && !awaiting;
  const canCost = role !== "manager";
  const statuses = nextStatuses(role, wo.status, wo.requested_by === profile.id);
  const closed = wo.status === "completed" || wo.status === "cancelled";

  return (
    <>
      <PageHeader
        back={{ href: "/work-orders", label: "Work orders" }}
        title={
          <span>
            <span className="mr-2 font-mono text-lg text-slate-400">#{wo.number}</span>
            {wo.title}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={wo.status} />
            <PriorityBadge priority={wo.priority} />
            <TypeBadge type={wo.type} />
            <OverdueBadge dueAt={wo.due_at} status={wo.status} />
            <span>
              {wo.site?.name} · opened {fmtDateTime(wo.created_at)}
            </span>
          </span>
        }
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.created === "approval" && (
        <Alert tone="good">Submitted. An admin will review it and assign a technician or vendor. You&apos;ll get an email when it&apos;s approved.</Alert>
      )}
      {sp.created && sp.created !== "approval" && <Alert tone="good">Submitted. You’ll see updates on this page.</Alert>}
      {sp.approved === "tech" && <Alert tone="good">Approved and assigned. The technician and the person who asked have been emailed.</Alert>}
      {sp.approved === "declined" && <Alert tone="good">Request declined. The person who asked has been emailed the reason.</Alert>}
      {sp.signoff === "done" && <Alert tone="good">Signed off. The work order is closed.</Alert>}
      {sp.signoff === "closed" && <Alert tone="good">Closed without the GM&apos;s sign-off. The reason is in the activity.</Alert>}
      {sp.signoff === "sent_back" && <Alert tone="good">Sent back. It&apos;s open again as a return visit, and the tech or vendor has been emailed your note.</Alert>}
      {sp.vendor && VENDOR_NOTICE[sp.vendor] && <Alert tone="good">{VENDOR_NOTICE[sp.vendor]}</Alert>}
      {sp.receipt && RECEIPT_NOTICE[sp.receipt] && <Alert tone="good">{RECEIPT_NOTICE[sp.receipt]}</Alert>}
      {sp.timer && timerNotice(sp.timer) && <Alert tone="good">{timerNotice(sp.timer)}</Alert>}
      <AutoRefresh seconds={30} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            {wo.description && <p className="whitespace-pre-wrap border-b border-slate-100 px-5 py-4 text-sm text-slate-700">{wo.description}</p>}
            <DefList
              items={[
                ["Site", wo.site && <Link className="text-brand-700 hover:underline" href={`/sites/${wo.site.id}`}>{wo.site.name}</Link>],
                ["Address", [wo.site?.address, wo.site?.city].filter(Boolean).join(", ") || "—"],
                [
                  "Asset",
                  wo.asset ? (
                    <Link className="text-brand-700 hover:underline" href={`/assets/${wo.asset.id}`}>
                      {wo.asset.name} {wo.asset.tag && <span className="text-slate-500">({wo.asset.tag})</span>}
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
                ["Category", wo.category],
                ["Location", wo.location_detail ?? "—"],
                ["Requested by", personName(wo.requester)],
                ["Technician", personName(wo.tech)],
                ["Vendor", wo.vendor ? `${wo.vendor.name}${wo.vendor.phone ? ` · ${wo.vendor.phone}` : ""}` : "—"],
                ["Scheduled", wo.scheduled_date ? `${fmtDate(wo.scheduled_date)}${wo.scheduled_start ? ` · ${fmtTime(wo.scheduled_start)}` : ""}${wo.estimated_hours ? ` · ~${wo.estimated_hours}h` : ""}` : "Not scheduled"],
                ["Due", fmtDateTime(wo.due_at)],
                [signoff ? "Work done" : "Completed", fmtDateTime(wo.completed_at)],
                ...(wo.signed_off_at
                  ? [
                      [
                        "Signed off",
                        `${fmtDateTime(wo.signed_off_at)} · ${
                          wo.signoff_method === "auto" ? "closed automatically (no sign-off)" : wo.signoff_method === "admin" ? `closed by ${personName(signer)} (admin)` : personName(signer)
                        }`,
                      ] as [string, React.ReactNode],
                    ]
                  : []),
                ...(wo.pm_schedule_id ? [["PM schedule", <Link key="pm" className="text-brand-700 hover:underline" href={`/pm/${wo.pm_schedule_id}`}>View schedule</Link>] as [string, React.ReactNode]] : []),
                ...(wo.compliance_requirement_id ? [["Compliance item", <Link key="c" className="text-brand-700 hover:underline" href={`/compliance/${wo.compliance_requirement_id}`}>View requirement</Link>] as [string, React.ReactNode]] : []),
              ]}
            />
            {wo.resolution_notes && (
              <div className="border-t border-slate-100 px-5 py-4">
                <p className="text-xs font-medium text-slate-500">Resolution</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{wo.resolution_notes}</p>
              </div>
            )}
          </Card>

          {role !== "vendor" && role !== "manager" && !awaiting && (
            <TimeCard supabase={supabase} woId={id} woStatus={wo.status} visit={wo.visit ?? 1} profile={profile} techs={lookups?.techs ?? []} />
          )}

          {role !== "vendor" && <ReceiptsCard supabase={supabase} woId={id} profile={profile} open={!!sp.add_receipt} />}

          <Attachments items={files.filter((f) => f.category !== "receipt")} action={uploadWoFiles} hidden={{ id }} allowInternal={role === "admin" || role === "tech"} categories={role === "admin" || role === "tech"} />

          <Card>
            <CardHeader title="Activity" />
            <ol className="space-y-4 px-5 py-4">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <div className={`mt-1.5 h-2 w-2 flex-none rounded-full ${e.kind === "comment" ? "bg-brand-500" : "bg-slate-300"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-500">
                      <span className="font-medium text-slate-800">
                        {e.user ? personName(e.user) : e.actor_label ? e.actor_label : "System"}
                      </span>
                      {e.actor_type === "vendor" && <span className="ml-1 rounded bg-violet-50 px-1 text-[10px] font-medium text-violet-700">VENDOR</span>}{" "}
                      {e.kind === "status" && (
                        <>
                          changed status {e.from_status && <>from <b>{STATUS_LABEL[e.from_status]}</b> </>}to{" "}
                          <b>{e.to_status && STATUS_LABEL[e.to_status]}</b>
                        </>
                      )}
                      {e.kind === "assignment" && <>updated assignment: {e.body}</>}
                      {e.kind === "schedule" && <>{e.body?.replace(/^S/, "s").replace(/^R/, "r")}</>}
                      {["system", "dispatch", "approval", "invoice", "vendor", "quote", "vendor_cost"].includes(e.kind) && <>{e.body}</>}
                      {e.kind === "comment" && (e.meta?.to_vendor ? "messaged the vendor" : "commented")}
                      {e.kind === "vendor_update" && "posted an update"}
                      {e.kind === "email_reply" && (e.meta?.unverified ? "sent an email (unrecognized sender)" : "replied by email")}
                      {e.meta?.via === "email" && e.kind === "comment" && <span className="ml-1 text-[10px] text-slate-400">· via email</span>}
                      {e.visibility === "shared" && ["comment", "vendor_update", "email_reply"].includes(e.kind) && role !== "vendor" && (
                        <span className="ml-1 text-[10px] text-slate-400">· visible to vendor</span>
                      )}
                      <span className="ml-2 text-xs text-slate-400">{fmtDateTime(e.created_at)}</span>
                    </p>
                    {(e.kind === "comment" || e.kind === "vendor_update" || e.kind === "email_reply") && (
                      <div className={`mt-1 whitespace-pre-wrap rounded-lg px-3 py-2 text-slate-800 ${e.actor_type === "vendor" ? "bg-violet-50" : "bg-slate-50"}`}>
                        {e.body}
                        {typeof e.meta?.files === "number" && e.meta.files > 0 && (
                          <p className="mt-1 text-xs text-slate-500">📎 {e.meta.files} attachment{e.meta.files > 1 ? "s" : ""} added to Photos &amp; files</p>
                        )}
                        {typeof e.meta?.materials === "string" && e.meta.materials && <p className="mt-1 text-xs text-slate-600">Materials: {e.meta.materials}</p>}
                        {typeof e.meta?.needs === "string" && e.meta.needs !== "none" && (
                          <p className="mt-1 text-xs font-medium text-orange-700">
                            Needs {e.meta.needs === "parts" ? "parts" : e.meta.needs === "visit" ? "another visit" : "parts and another visit"}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <form action={addComment} className="flex gap-2 border-t border-slate-100 px-5 py-4">
              <input type="hidden" name="id" value={id} />
              <Textarea name="body" rows={2} placeholder="Add an update or question…" required />
              <div className="self-end">
                <SubmitButton size="sm" pendingText="…">Post</SubmitButton>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          {signoff && (role === "manager" || role === "admin") && (
            <Card className="ring-2 ring-amber-300">
              <CardHeader title="Is it fixed?" subtitle={`Work done ${fmtDateTime(wo.completed_at)}${closesOn ? ` · closes automatically ${fmtDate(closesOn)}` : ""}`} />
              <form action={signOffWorkOrder} className="space-y-3 p-5">
                <input type="hidden" name="id" value={id} />
                <p className="text-sm text-slate-600">Check the work at the store. Signing off closes the work order.</p>
                <Input name="note" placeholder="Comment (optional)" />
                <SubmitButton>Yes, it&apos;s fixed</SubmitButton>
              </form>
              <form action={sendBackNotFixed} className="space-y-2 border-t border-slate-100 p-5">
                <input type="hidden" name="id" value={id} />
                <Field label="Not fixed?" hint="It goes back to the same tech or vendor as a return visit, with your note.">
                  <Input name="note" placeholder="e.g. Still not cooling below 41°F" required />
                </Field>
                <SubmitButton variant="secondary" size="sm">
                  Send back
                </SubmitButton>
              </form>
              {role === "admin" && (
                <form action={closeForGm} className="space-y-2 border-t border-slate-100 p-5">
                  <input type="hidden" name="id" value={id} />
                  <Field label="Close without the GM" hint="For when the GM can't sign off. The reason is kept in the history.">
                    <Input name="reason" placeholder="e.g. GM on vacation; confirmed by phone" required />
                  </Field>
                  <SubmitButton variant="ghost" size="sm">
                    Close for the GM
                  </SubmitButton>
                </form>
              )}
            </Card>
          )}
          {signoff && role !== "manager" && role !== "admin" && (
            <Card>
              <CardHeader title="Waiting for GM sign-off" />
              <p className="px-5 py-4 text-sm text-slate-600">
                The store&apos;s GM checks the work and signs off{closesOn ? `. If no one does, it closes automatically on ${fmtDate(closesOn)}` : ""}. If it isn&apos;t fixed, it comes back to you with a note.
              </p>
            </Card>
          )}
          {awaiting && role === "admin" && lookups && (
            <Card className="ring-2 ring-orange-300">
              <CardHeader title="Approve this work order" subtitle={`Requested by ${personName(wo.requester)}`} />
              <form action={approveWorkOrder} className="space-y-3 p-5">
                <input type="hidden" name="id" value={id} />
                <Field label="Assign to technician">
                  <Select name="assigned_tech_id" defaultValue="" required>
                    <option value="" disabled>
                      Choose a technician…
                    </option>
                    {lookups.techs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {personName(t)}
                        {t.role === "admin" ? " (admin)" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Priority">
                    <Select name="priority" defaultValue={wo.priority}>
                      {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Category">
                    <Select name="category" defaultValue={wo.category}>
                      {CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3">
                  <Field label="Schedule date">
                    <Input type="date" name="scheduled_date" />
                  </Field>
                  <Field label="Start">
                    <Input type="time" name="scheduled_start" step={900} />
                  </Field>
                  <Field label="Est. hrs">
                    <Input name="estimated_hours" inputMode="decimal" />
                  </Field>
                </div>
                <Field label="Note to the technician (optional)">
                  <Input name="note" placeholder="e.g. Bring a spare compressor relay" />
                </Field>
                <SubmitButton>Approve &amp; assign</SubmitButton>
              </form>
              <div className="border-t border-slate-100 p-5">
                <p className="mb-2 text-sm text-slate-600">Needs an outside vendor? Sending it to one approves it.</p>
                <ButtonLink href={`/work-orders/${id}/dispatch`} variant="secondary">
                  <Send className="h-4 w-4" aria-hidden /> Approve &amp; send to vendor
                </ButtonLink>
              </div>
              <form action={declineWorkOrder} className="space-y-2 border-t border-slate-100 p-5">
                <input type="hidden" name="id" value={id} />
                <Field label="Decline" hint="The person who asked gets this reason by email.">
                  <Input name="reason" placeholder="e.g. Duplicate of #1042, already scheduled" required />
                </Field>
                <SubmitButton variant="danger" size="sm" confirm="Decline this request?">
                  Decline request
                </SubmitButton>
              </form>
            </Card>
          )}
          {awaiting && role !== "admin" && (
            <Card>
              <CardHeader title="Waiting for approval" />
              <p className="px-5 py-4 text-sm text-slate-600">
                An admin will review this request and assign a technician or vendor. {role === "manager" ? "You'll get an email when it's approved." : ""}
              </p>
            </Card>
          )}
          {role !== "vendor" && !awaiting && <VendorPanel supabase={supabase} wo={wo} profile={profile} />}
          {statuses.length > 0 && (
            <Card>
              <CardHeader title="Update status" />
              <form className="space-y-3 p-5">
                <input type="hidden" name="id" value={id} />
                {statuses.includes("completed") && (
                  <Field label="Resolution notes" hint="What was done? Required details for the record.">
                    <Textarea name="resolution_notes" rows={3} defaultValue={wo.resolution_notes ?? ""} />
                  </Field>
                )}
                {statuses.includes("completed") && wo.type === "compliance" && (
                  <Field label="Certificate / tag #" hint="Saved to the compliance record. Upload the certificate under Photos & files as “Certificate”.">
                    <Input name="certificate_number" defaultValue={wo.certificate_number ?? ""} />
                  </Field>
                )}
                <Field label="Note (optional)">
                  <Input name="note" placeholder="e.g. Waiting on part, ETA Friday" />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {statuses.map((s) => (
                    <SubmitButton
                      key={s}
                      formAction={setStatus.bind(null, s)}
                      size="sm"
                      variant={s === "completed" ? "primary" : s === "cancelled" ? "danger" : "secondary"}
                      confirm={s === "cancelled" ? "Cancel this work order?" : undefined}
                    >
                      {closed ? "Reopen" : STATUS_VERB[s] ?? STATUS_LABEL[s]}
                    </SubmitButton>
                  ))}
                </div>
              </form>
            </Card>
          )}

          {canAssign && lookups && (
            <Card>
              <CardHeader title="Assignment & schedule" action={<Link href={`/schedule?date=${wo.scheduled_date ?? ""}`} className="text-xs font-medium text-brand-700">Calendar</Link>} />
              <form action={updateAssignment} className="space-y-3 p-5">
                <input type="hidden" name="id" value={id} />
                <Field label="Technician" hint={role === "admin" ? undefined : "Only admins assign technicians and vendors"}>
                  <Select name="assigned_tech_id" defaultValue={wo.assigned_tech_id ?? ""} disabled={role !== "admin"}>
                    <option value="">— Unassigned —</option>
                    {lookups.techs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {personName(t)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Vendor">
                  <Select name="vendor_id" defaultValue={wo.vendor_id ?? ""} disabled={role !== "admin"}>
                    <option value="">— None —</option>
                    {lookups.vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3">
                  <Field label="Schedule date">
                    <Input type="date" name="scheduled_date" defaultValue={wo.scheduled_date ?? ""} />
                  </Field>
                  <Field label="Start">
                    <Input type="time" name="scheduled_start" step={900} defaultValue={wo.scheduled_start?.slice(0, 5) ?? ""} />
                  </Field>
                  <Field label="Est. hrs">
                    <Input name="estimated_hours" inputMode="decimal" defaultValue={wo.estimated_hours ?? ""} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Priority">
                    <Select name="priority" defaultValue={wo.priority}>
                      {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Type">
                    <Select name="type" defaultValue={wo.type}>
                      {Object.entries(TYPE_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Due date">
                    <Input type="date" name="due_date" defaultValue={toDateInput(wo.due_at)} />
                  </Field>
                  <Field label="NTE ($)">
                    <Input name="nte_amount" inputMode="decimal" defaultValue={wo.nte_amount ?? ""} />
                  </Field>
                </div>
                <Field label="Category">
                  <Select name="category" defaultValue={wo.category}>
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton size="sm" variant="secondary">Save assignment</SubmitButton>
              </form>
            </Card>
          )}

          {canCost && (
            <Card>
              <CardHeader title="Costs" subtitle={wo.nte_amount ? `NTE ${fmtMoney(wo.nte_amount)}` : undefined} />
              <form action={updateCosts} className="space-y-3 p-5">
                <input type="hidden" name="id" value={id} />
                {role !== "vendor" && (
                  <Field label="Other parts $" hint="Parts not entered as receipts (e.g. from stock)">
                    <Input name="parts_cost" inputMode="decimal" defaultValue={wo.parts_cost || ""} />
                  </Field>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Vendor invoice $">
                    <Input name="vendor_invoice_amount" inputMode="decimal" defaultValue={wo.vendor_invoice_amount || ""} />
                  </Field>
                  <Field label="Invoice #">
                    <Input name="invoice_number" defaultValue={wo.invoice_number ?? ""} />
                  </Field>
                </div>
                <Field label="Resolution notes">
                  <Textarea name="resolution_notes" rows={2} defaultValue={wo.resolution_notes ?? ""} />
                </Field>
                <table className="w-full overflow-hidden rounded-lg bg-slate-50 text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="px-3 pb-1 pt-2 font-medium">Expense category</th>
                      <th className="px-3 pb-1 pt-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-1 text-slate-600">
                        <a href="#time" className="hover:text-brand-700">
                          Internal technician labor ({fmtHours(wo.labor_hours)} hrs)
                        </a>
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums text-slate-800">{role === "admin" ? fmtMoney(laborCost, 2) : <span className="text-slate-400">Admin only</span>}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1 text-slate-600">
                        <a href="#receipts" className="hover:text-brand-700">
                          Parts &amp; materials
                        </a>
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums text-slate-800">{fmtMoney(partsTotal, 2)}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1 text-slate-600">Outside vendor costs</td>
                      <td className="px-3 py-1 text-right tabular-nums text-slate-800">{fmtMoney(wo.vendor_invoice_amount, 2)}</td>
                    </tr>
                    <tr className="border-t border-slate-200 font-semibold text-slate-900">
                      <td className="px-3 pb-2 pt-1.5">{role === "admin" ? "Total R&M cost" : "Total (excl. internal labor)"}</td>
                      <td className="px-3 pb-2 pt-1.5 text-right tabular-nums">{fmtMoney(role === "admin" ? rmTotal : wo.total_cost, 2)}</td>
                    </tr>
                  </tbody>
                </table>
                {labor?.missing_rate && <p className="text-xs text-orange-700">Some labor has no hourly rate set. Set it on Users.</p>}
                {wo.nte_amount != null && (role === "admin" ? rmTotal : wo.total_cost) > wo.nte_amount && (
                  <Alert tone="serious">Total exceeds the not-to-exceed amount — get approval.</Alert>
                )}
                <div className="flex items-center justify-end">
                  <SubmitButton size="sm" variant="secondary">Save costs</SubmitButton>
                </div>
              </form>
            </Card>
          )}

          {isSuper(profile) && (
            <form action={deleteWorkOrder} className="text-right">
              <input type="hidden" name="id" value={id} />
              <SubmitButton size="sm" variant="ghost" confirm="Permanently delete this work order and its history?">
                Delete work order
              </SubmitButton>
            </form>
          )}
          <p className="text-right text-xs text-slate-400">Last updated {fmtDate(wo.updated_at)}</p>
        </div>
      </div>
    </>
  );
}
