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
import { putOnHoldWithReport } from "../actions";
import { PhotoInput } from "@/components/PhotoInput";
import { addComment, approveWorkOrder, closeForGm, declineWorkOrder, deleteWorkOrder, sendBackNotFixed, setStatus, signOffWorkOrder, updateAssignment, updateCosts, uploadWoFiles } from "../actions";
import { addDaysISO } from "@/lib/format";
import { HOLD_REASONS, SIGNOFF_AUTO_CLOSE_DAYS } from "@/lib/constants";
import { Send } from "lucide-react";
import { VendorPanel } from "./VendorPanel";
import { ReceiptsCard } from "./ReceiptsCard";
import { PartsCard } from "./PartsCard";
import { TimeCard } from "./TimeCard";
import { ChecklistCard, type ChecklistItem } from "./ChecklistCard";
import { TechOptions } from "@/components/TechOptions";
import { fmtHours } from "@/lib/labor";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n";

const TIMER_NOTICE: Record<string, string> = {
  started: "Timer started.",
  resumed: "Timer resumed.",
  paused: "Timer paused.",
  stopped: "Timer stopped. Hours were added to this work order.",
  added: "Time added and recorded in the adjustment history.",
  edited: "Time adjusted and recorded in the adjustment history.",
  voided: "Time entry voided and recorded in the adjustment history.",
};
function timerNotice(v: string, t: T) {
  const m = v.match(/^(\w+?)_paused_(\d+)$/);
  if (m) return `${t(TIMER_NOTICE[m[1]] ?? "Timer started.")} ${t("Your timer on work order #{n} was paused, since only one timer can run at a time.", { n: m[2] })}`;
  return TIMER_NOTICE[v] && t(TIMER_NOTICE[v]);
}

const PART_NOTICE: Record<string, string> = {
  requested: "Part requested. The admins were notified.",
  saved: "Part updated.",
  approved: "Part approved. It can be ordered now.",
  ordered: "Marked ordered. The store's GM was told when to expect it.",
  ready: "Part is ready. The tech and the store's GM were notified.",
  installed: "Part marked installed.",
  cancelled: "Part cancelled.",
  removed: "Part request removed.",
};
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
  company_id: string | null;
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
  const t = await getT();
  const L = t.locale;

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

  const [{ data: evData }, files, lookups, { data: ckData }] = await Promise.all([
    supabase
      .from("work_order_events")
      .select("*, user:profiles(full_name,email)")
      .eq("work_order_id", id)
      .order("created_at", { ascending: true }),
    listAttachments(supabase, "work_order", id),
    profile.role === "admin" || profile.role === "tech" ? getLookups(supabase, { allCompanies: true }) : Promise.resolve(null),
    supabase
      .from("wo_checklist_items")
      .select(
        "id,activity,description,activity_es,description_es,photo_rule,result,note,before_attachment_id,after_attachment_id,completed_at," +
          "followup:work_orders!wo_checklist_items_followup_wo_id_fkey(id,number)," +
          "done_by:profiles!wo_checklist_items_completed_by_fkey(full_name,email)",
      )
      .eq("work_order_id", id)
      .order("position"),
  ]);
  // PM checklist: photos come from this work order's attachments (category "checklist").
  const fileUrl = new Map(files.map((f) => [f.id, f.url]));
  type CkRow = {
    id: string; activity: string; description: string | null; activity_es: string | null; description_es: string | null; photo_rule: ChecklistItem["photo_rule"]; result: ChecklistItem["result"];
    note: string | null; before_attachment_id: string | null; after_attachment_id: string | null; completed_at: string | null;
    followup: { id: string; number: number } | null; done_by: { full_name: string | null; email: string | null } | null;
  };
  const checklist: ChecklistItem[] = ((ckData ?? []) as unknown as CkRow[]).map((r) => {
    const before = r.before_attachment_id ? fileUrl.get(r.before_attachment_id) ?? null : null;
    const after = r.after_attachment_id ? fileUrl.get(r.after_attachment_id) ?? null : null;
    const noteOk = !(r.result === "na" || r.result === "needs_repair") || !!r.note?.trim();
    const photosOk =
      r.result === "na" || r.photo_rule === "none" || (r.photo_rule === "single" ? !!(r.after_attachment_id || r.before_attachment_id) : !!(r.before_attachment_id && r.after_attachment_id));
    return {
      id: r.id, activity: r.activity, description: r.description, activity_es: r.activity_es, description_es: r.description_es, photo_rule: r.photo_rule, result: r.result, note: r.note,
      before_url: before, after_url: after, followup: r.followup, completed_at: r.completed_at,
      completed_by_name: r.done_by ? personName(r.done_by) : null,
      done: !!r.result && noteOk && photosOk,
    };
  });
  const checklistOpen = checklist.filter((c) => !c.done).length;
  // GMs never see vendor money: drop quote/invoice/cost entries and blank amounts in automatic entries.
  const MONEY_KINDS = ["quote", "invoice", "vendor_cost", "approval"];
  const events = ((evData ?? []) as (WorkOrderEvent & { user: { full_name: string | null; email: string | null } | null })[])
    .filter((e) => profile.role !== "vendor" || e.visibility === "shared")
    .filter((e) => profile.role !== "manager" || !MONEY_KINDS.includes(e.kind))
    .map((e) =>
      profile.role === "manager" && e.body && !["comment", "vendor_update", "email_reply"].includes(e.kind)
        ? { ...e, body: e.body.replace(/\s*\(?\$\s?\d[\d,]*(\.\d+)?\)?/g, "") }
        : e,
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
  // Techs must file a progress report to put a job on hold, so "on hold" gets its own form for them.
  const techHold = role === "tech" && statuses.includes("on_hold");
  const statusButtons = techHold ? statuses.filter((s) => s !== "on_hold") : statuses;
  // Who gets an email/phone alert when this person posts a note (mirrors notifyNote in lib/wo-notify).
  const hasTech = !!wo.assigned_tech_id;
  const noteAudience =
    role === "manager"
      ? hasTech
        ? t("The assigned tech is notified.")
        : t("The admins are notified (no tech assigned yet).")
      : role === "tech"
        ? ["requested", "on_hold", "new"].includes(wo.status)
          ? t("The store's GM and the admins are notified.")
          : t("The store's GM is notified.")
        : hasTech
          ? t("The store's GM and the assigned tech are notified.")
          : t("The store's GM is notified.");
  const closed = wo.status === "completed" || wo.status === "cancelled";

  return (
    <>
      <PageHeader
        back={{ href: "/work-orders", label: t("Work orders") }}
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
              {wo.site?.name} · {t("opened {when}", { when: fmtDateTime(wo.created_at, L) })}
            </span>
          </span>
        }
      />
      {sp.error && <Alert>{t(sp.error)}</Alert>}
      {sp.created === "approval" && (
        <Alert tone="good">{t("Submitted. An admin will review it and assign a technician or vendor. You'll get an email when it's approved.")}</Alert>
      )}
      {sp.created && sp.created !== "approval" && <Alert tone="good">{t("Submitted. You’ll see updates on this page.")}</Alert>}
      {sp.approved === "tech" && <Alert tone="good">Approved and assigned. The technician and the person who asked have been emailed.</Alert>}
      {sp.approved === "declined" && <Alert tone="good">Request declined. The person who asked has been emailed the reason.</Alert>}
      {sp.signoff === "done" && <Alert tone="good">Signed off. The work order is closed.</Alert>}
      {sp.signoff === "closed" && <Alert tone="good">Closed without the GM&apos;s sign-off. The reason is in the activity.</Alert>}
      {sp.signoff === "sent_back" && <Alert tone="good">Sent back. It&apos;s open again as a return visit, and the tech or vendor has been emailed your note.</Alert>}
      {sp.vendor && VENDOR_NOTICE[sp.vendor] && <Alert tone="good">{VENDOR_NOTICE[sp.vendor]}</Alert>}
      {sp.receipt && RECEIPT_NOTICE[sp.receipt] && <Alert tone="good">{t(RECEIPT_NOTICE[sp.receipt])}</Alert>}
      {sp.part && PART_NOTICE[sp.part] && <Alert tone="good">{t(PART_NOTICE[sp.part])}</Alert>}
      {sp.held && <Alert tone="good">{t("Job put on hold. Your progress report is posted below and the store's GM was emailed.")}</Alert>}
      {sp.timer && timerNotice(sp.timer, t) && <Alert tone="good">{timerNotice(sp.timer, t)}</Alert>}
      <AutoRefresh seconds={30} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {checklist.length > 0 && (
            <ChecklistCard
              items={checklist}
              editable={(role === "admin" || role === "tech") && !["requested", "awaiting_signoff", "completed", "cancelled"].includes(wo.status)}
            />
          )}
          <Card>
            <CardHeader title={t("Details")} />
            {wo.description && <p className="whitespace-pre-wrap border-b border-slate-100 px-5 py-4 text-sm text-slate-700">{wo.description}</p>}
            <DefList
              items={[
                [t("Site"), wo.site && <Link className="text-brand-700 hover:underline" href={`/sites/${wo.site.id}`}>{wo.site.name}</Link>],
                [t("Address"), [wo.site?.address, wo.site?.city].filter(Boolean).join(", ") || "—"],
                [
                  t("Asset"),
                  wo.asset ? (
                    <Link className="text-brand-700 hover:underline" href={`/assets/${wo.asset.id}`}>
                      {wo.asset.name} {wo.asset.tag && <span className="text-slate-500">({wo.asset.tag})</span>}
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
                [t("Category"), t(wo.category)],
                [t("Location"), wo.location_detail ?? "—"],
                [t("Requested by"), personName(wo.requester)],
                [t("Technician"), personName(wo.tech)],
                [t("Vendor"), wo.vendor ? `${wo.vendor.name}${wo.vendor.phone ? ` · ${wo.vendor.phone}` : ""}` : "—"],
                [t("Scheduled"), wo.scheduled_date ? `${fmtDate(wo.scheduled_date, L)}${wo.scheduled_start ? ` · ${fmtTime(wo.scheduled_start)}` : ""}${wo.estimated_hours ? ` · ~${wo.estimated_hours}h` : ""}` : t("Not scheduled")],
                [t("Due"), fmtDateTime(wo.due_at, L)],
                [signoff ? t("Work done") : t("Completed"), fmtDateTime(wo.completed_at, L)],
                ...(wo.signed_off_at
                  ? [
                      [
                        t("Signed off"),
                        `${fmtDateTime(wo.signed_off_at, L)} · ${
                          wo.signoff_method === "auto" ? t("closed automatically (no sign-off)") : wo.signoff_method === "admin" ? t("closed by {name} (admin)", { name: personName(signer) }) : personName(signer)
                        }`,
                      ] as [string, React.ReactNode],
                    ]
                  : []),
                ...(wo.pm_schedule_id ? [[t("PM schedule"), <Link key="pm" className="text-brand-700 hover:underline" href={`/pm/${wo.pm_schedule_id}`}>{t("View schedule")}</Link>] as [string, React.ReactNode]] : []),
                ...(wo.compliance_requirement_id ? [[t("Compliance item"), <Link key="c" className="text-brand-700 hover:underline" href={`/compliance/${wo.compliance_requirement_id}`}>{t("View requirement")}</Link>] as [string, React.ReactNode]] : []),
              ]}
            />
            {wo.resolution_notes && (
              <div className="border-t border-slate-100 px-5 py-4">
                <p className="text-xs font-medium text-slate-500">{t("Resolution")}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{wo.resolution_notes}</p>
              </div>
            )}
          </Card>

          {role !== "vendor" && role !== "manager" && !awaiting && (
            <TimeCard supabase={supabase} woId={id} woStatus={wo.status} visit={wo.visit ?? 1} profile={profile} techs={lookups?.staff ?? []} />
          )}

          {role !== "vendor" && (
            <PartsCard supabase={supabase} woId={id} companyId={wo.company_id} profile={profile} closed={closed} files={files} open={!!sp.add_part} />
          )}

          {role !== "vendor" && <ReceiptsCard supabase={supabase} woId={id} profile={profile} open={!!sp.add_receipt} />}

          <Attachments items={files.filter((f) => f.category !== "receipt" && f.category !== "checklist" && f.category !== "part" && !(role === "manager" && ["invoice", "quote", "vendor_receipt"].includes(f.category ?? "")))} action={uploadWoFiles} hidden={{ id }} allowInternal={role === "admin" || role === "tech"} categories={role === "admin" || role === "tech"} />

          <Card>
            <CardHeader title={t("Activity / Notes")} />
            <ol className="space-y-4 px-5 py-4">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <div className={`mt-1.5 h-2 w-2 flex-none rounded-full ${e.kind === "comment" ? "bg-brand-500" : "bg-slate-300"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-500">
                      <span className="font-medium text-slate-800">
                        {e.user ? personName(e.user) : e.actor_label ? e.actor_label : t("System")}
                      </span>
                      {e.actor_type === "vendor" && <span className="ml-1 rounded bg-violet-50 px-1 text-[10px] font-medium text-violet-700">VENDOR</span>}{" "}
                      {e.kind === "status" && (
                        <>
                          {t("changed status")} {e.from_status && <>{t("from")} <b>{t(STATUS_LABEL[e.from_status])}</b> </>}{t("to")}{" "}
                          <b>{e.to_status && t(STATUS_LABEL[e.to_status])}</b>
                        </>
                      )}
                      {e.kind === "assignment" && <>{t("updated assignment:")} {e.body}</>}
                      {e.kind === "schedule" && <>{e.body?.replace(/^S/, "s").replace(/^R/, "r")}</>}
                      {["system", "dispatch", "approval", "invoice", "vendor", "quote", "vendor_cost"].includes(e.kind) && <>{e.body && t(e.body)}</>}
                      {e.kind === "comment" && (e.meta?.to_vendor ? t("messaged the vendor") : t("commented"))}
                      {e.kind === "vendor_update" && t("posted an update")}
                      {e.kind === "progress_report" && t("posted a progress report")}
                      {e.kind === "email_reply" && (e.meta?.unverified ? t("sent an email (unrecognized sender)") : t("replied by email"))}
                      {e.meta?.via === "email" && e.kind === "comment" && <span className="ml-1 text-[10px] text-slate-400">· {t("via email")}</span>}
                      {e.staff_only && role !== "manager" && (
                        <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-800">{t("STAFF ONLY")}</span>
                      )}
                      {e.visibility === "shared" && ["comment", "vendor_update", "email_reply"].includes(e.kind) && role !== "vendor" && (
                        <span className="ml-1 text-[10px] text-slate-400">· {t("visible to vendor")}</span>
                      )}
                      <span className="ml-2 text-xs text-slate-400">{fmtDateTime(e.created_at, L)}</span>
                    </p>
                    {e.kind === "progress_report" && (
                      <div className="mt-1 whitespace-pre-wrap rounded-lg bg-amber-50 px-3 py-2 text-slate-800 ring-1 ring-amber-200">
                        {e.body}
                        {typeof e.meta?.files === "number" && e.meta.files > 0 && (
                          <p className="mt-1 text-xs text-slate-500">📎 {t(e.meta.files > 1 ? "{n} photos added to Photos & files" : "{n} photo added to Photos & files", { n: e.meta.files })}</p>
                        )}
                      </div>
                    )}
                    {(e.kind === "comment" || e.kind === "vendor_update" || e.kind === "email_reply") && (
                      <div
                        className={`mt-1 whitespace-pre-wrap rounded-lg px-3 py-2 text-slate-800 ${
                          e.actor_type === "vendor" ? "bg-violet-50" : e.staff_only ? "bg-amber-50/60 ring-1 ring-amber-200" : "bg-slate-50"
                        }`}
                      >
                        {e.body}
                        {typeof e.meta?.files === "number" && e.meta.files > 0 && (
                          <p className="mt-1 text-xs text-slate-500">📎 {t(e.meta.files > 1 ? "{n} attachments added to Photos & files" : "{n} attachment added to Photos & files", { n: e.meta.files })}</p>
                        )}
                        {typeof e.meta?.materials === "string" && e.meta.materials && <p className="mt-1 text-xs text-slate-600">{t("Materials:")} {e.meta.materials}</p>}
                        {typeof e.meta?.needs === "string" && e.meta.needs !== "none" && (
                          <p className="mt-1 text-xs font-medium text-orange-700">
                            {e.meta.needs === "parts" ? t("Needs parts") : e.meta.needs === "visit" ? t("Needs another visit") : t("Needs parts and another visit")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <form action={addComment} className="border-t border-slate-100 px-5 py-4">
              <input type="hidden" name="id" value={id} />
              <div className="flex gap-2">
                <Textarea name="body" rows={2} placeholder={t("Add a note, update or question…")} required />
                <div className="self-end">
                  <SubmitButton size="sm" pendingText="…">{t("Post")}</SubmitButton>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                {role !== "vendor" && <span>{noteAudience}</span>}
                {(role === "admin" || role === "tech") && (
                  <label className="flex items-center gap-1.5 text-slate-600">
                    <input type="checkbox" name="staff_only" className="rounded border-slate-300" /> {t("Staff only (hidden from the store's GM)")}
                  </label>
                )}
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
              <CardHeader title={t("Waiting for GM sign-off")} />
              <p className="px-5 py-4 text-sm text-slate-600">
                {closesOn
                  ? t("The store's GM checks the work and signs off. If no one does, it closes automatically on {date}. If it isn't fixed, it comes back to you with a note.", { date: fmtDate(closesOn, L) })
                  : t("The store's GM checks the work and signs off. If it isn't fixed, it comes back to you with a note.")}
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
                    <TechOptions techs={lookups.techs} />
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
              <CardHeader title={t("Waiting for approval")} />
              <p className="px-5 py-4 text-sm text-slate-600">
                {t("An admin will review this request and assign a technician or vendor.")} {role === "manager" ? t("You'll get an email when it's approved.") : ""}
              </p>
            </Card>
          )}
          {role !== "vendor" && !awaiting && <VendorPanel supabase={supabase} wo={wo} profile={profile} />}
          {statuses.length > 0 && (
            <Card>
              <CardHeader title={t("Update status")} />
              {statusButtons.length > 0 && (
              <form className="space-y-3 p-5">
                <input type="hidden" name="id" value={id} />
                {statuses.includes("completed") && (
                  <Field label={t("Resolution notes")} hint={t("What was done? Required details for the record.")}>
                    <Textarea name="resolution_notes" rows={3} defaultValue={wo.resolution_notes ?? ""} />
                  </Field>
                )}
                {statuses.includes("completed") && wo.type === "compliance" && (
                  <Field label={t("Certificate / tag #")} hint={t("Saved to the compliance record. Upload the certificate under Photos & files as “Certificate”.")}>
                    <Input name="certificate_number" defaultValue={wo.certificate_number ?? ""} />
                  </Field>
                )}
                <Field label={t("Note (optional)")}>
                  <Input name="note" placeholder={t("e.g. Waiting on part, ETA Friday")} />
                </Field>
                {checklistOpen > 0 && statusButtons.includes("completed") && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                    {t(checklistOpen > 1 ? "{n} checklist items still need photos and a result before this PM can be completed." : "{n} checklist item still needs photos and a result before this PM can be completed.", { n: checklistOpen })}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {statusButtons.map((s) => (
                    <SubmitButton
                      key={s}
                      formAction={setStatus.bind(null, s)}
                      disabled={checklistOpen > 0 && s === "completed"}
                      size="sm"
                      variant={s === "completed" ? "primary" : s === "cancelled" ? "danger" : "secondary"}
                      confirm={s === "cancelled" ? t("Cancel this work order?") : undefined}
                    >
                      {closed ? t("Reopen") : t(STATUS_VERB[s] ?? STATUS_LABEL[s])}
                    </SubmitButton>
                  ))}
                </div>
              </form>
              )}
              {techHold && (
                <details className={`group ${statusButtons.length ? "border-t border-slate-100" : ""}`} open={!!sp.hold}>
                  <summary className="cursor-pointer list-none px-5 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
                    <span className="mr-1 inline-block transition group-open:rotate-90">›</span> {t("Put on hold")}
                    <span className="ml-1 font-normal text-slate-500">· {t("progress report required")}</span>
                  </summary>
                  <form action={putOnHoldWithReport} className="space-y-3 border-t border-slate-100 bg-amber-50/40 p-5">
                    <input type="hidden" name="id" value={id} />
                    <Field label={`${t("Work done so far")} *`}>
                      <Textarea name="work_done" rows={3} required placeholder={t("e.g. Diagnosed walk-in cooler: failed condenser fan motor. Removed old motor.")} />
                    </Field>
                    <Field label={`${t("Why is it on hold?")} *`}>
                      <Select name="hold_reason" required defaultValue="">
                        <option value="" disabled>
                          {t("Choose a reason…")}
                        </option>
                        {Object.entries(HOLD_REASONS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {t(v)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={`${t("What's left / next step")} *`}>
                      <Textarea name="next_steps" rows={2} required placeholder={t("e.g. Install new motor and test temps once part arrives")} />
                    </Field>
                    <Field label={t("Parts needed")} hint={t("Required when waiting on parts. This opens a part request below; add the part #, price and a photo there.")}>
                      <Input name="parts_needed" placeholder={t("e.g. 1× condenser fan motor 1/3 HP 208-230V")} />
                    </Field>
                    <Field label={t("Expected back on")}>
                      <Input type="date" name="return_on" />
                    </Field>
                    <div>
                      <span className="mb-1 block text-sm font-medium text-slate-700">{t("Photos (optional)")}</span>
                      <PhotoInput name="files" />
                    </div>
                    <SubmitButton size="sm">{t("Submit report & put on hold")}</SubmitButton>
                  </form>
                </details>
              )}
            </Card>
          )}

          {canAssign && lookups && (
            <Card>
              <CardHeader title={t("Assignment & schedule")} action={<Link href={`/schedule?date=${wo.scheduled_date ?? ""}`} className="text-xs font-medium text-brand-700">{t("Calendar")}</Link>} />
              <form action={updateAssignment} className="space-y-3 p-5">
                <input type="hidden" name="id" value={id} />
                <Field label={t("Technician")} hint={role === "admin" ? undefined : t("Only admins assign technicians and vendors")}>
                  <Select name="assigned_tech_id" defaultValue={wo.assigned_tech_id ?? ""} disabled={role !== "admin"}>
                    <option value="">— {t("Unassigned")} —</option>
                    <TechOptions techs={lookups.techs} staff={lookups.staff} current={wo.assigned_tech_id} />
                  </Select>
                </Field>
                <Field label={t("Vendor")}>
                  <Select name="vendor_id" defaultValue={wo.vendor_id ?? ""} disabled={role !== "admin"}>
                    <option value="">— {t("None")} —</option>
                    {lookups.vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3">
                  <Field label={t("Schedule date")}>
                    <Input type="date" name="scheduled_date" defaultValue={wo.scheduled_date ?? ""} />
                  </Field>
                  <Field label={t("Start")}>
                    <Input type="time" name="scheduled_start" step={900} defaultValue={wo.scheduled_start?.slice(0, 5) ?? ""} />
                  </Field>
                  <Field label={t("Est. hrs")}>
                    <Input name="estimated_hours" inputMode="decimal" defaultValue={wo.estimated_hours ?? ""} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("Priority")}>
                    <Select name="priority" defaultValue={wo.priority}>
                      {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {t(v)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("Type")}>
                    <Select name="type" defaultValue={wo.type}>
                      {Object.entries(TYPE_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {t(v)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("Due date")}>
                    <Input type="date" name="due_date" defaultValue={toDateInput(wo.due_at)} />
                  </Field>
                  <Field label="NTE ($)">
                    <Input name="nte_amount" inputMode="decimal" defaultValue={wo.nte_amount ?? ""} />
                  </Field>
                </div>
                <Field label={t("Category")}>
                  <Select name="category" defaultValue={wo.category}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t(c)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton size="sm" variant="secondary">{t("Save assignment")}</SubmitButton>
              </form>
            </Card>
          )}

          {canCost && (
            <Card>
              <CardHeader title={t("Costs")} subtitle={wo.nte_amount ? `${t("NTE")} ${fmtMoney(wo.nte_amount)}` : undefined} />
              <form action={updateCosts} className="space-y-3 p-5">
                <input type="hidden" name="id" value={id} />
                {role !== "vendor" && (
                  <Field label={t("Other parts $")} hint={t("Parts not entered as receipts (e.g. from stock)")}>
                    <Input name="parts_cost" inputMode="decimal" defaultValue={wo.parts_cost || ""} />
                  </Field>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("Vendor invoice $")}>
                    <Input name="vendor_invoice_amount" inputMode="decimal" defaultValue={wo.vendor_invoice_amount || ""} />
                  </Field>
                  <Field label={t("Invoice #")}>
                    <Input name="invoice_number" defaultValue={wo.invoice_number ?? ""} />
                  </Field>
                </div>
                <Field label={t("Resolution notes")}>
                  <Textarea name="resolution_notes" rows={2} defaultValue={wo.resolution_notes ?? ""} />
                </Field>
                <table className="w-full overflow-hidden rounded-lg bg-slate-50 text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="px-3 pb-1 pt-2 font-medium">{t("Expense category")}</th>
                      <th className="px-3 pb-1 pt-2 text-right font-medium">{t("Amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-1 text-slate-600">
                        <a href="#time" className="hover:text-brand-700">
                          {t("Internal technician labor ({n} hrs)", { n: fmtHours(wo.labor_hours) })}
                        </a>
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums text-slate-800">{role === "admin" ? fmtMoney(laborCost, 2) : <span className="text-slate-400">{t("Admin only")}</span>}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1 text-slate-600">
                        <a href="#receipts" className="hover:text-brand-700">
                          {t("Parts & materials")}
                        </a>
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums text-slate-800">{fmtMoney(partsTotal, 2)}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1 text-slate-600">{t("Outside vendor costs")}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-slate-800">{fmtMoney(wo.vendor_invoice_amount, 2)}</td>
                    </tr>
                    <tr className="border-t border-slate-200 font-semibold text-slate-900">
                      <td className="px-3 pb-2 pt-1.5">{role === "admin" ? t("Total R&M cost") : t("Total (excl. internal labor)")}</td>
                      <td className="px-3 pb-2 pt-1.5 text-right tabular-nums">{fmtMoney(role === "admin" ? rmTotal : wo.total_cost, 2)}</td>
                    </tr>
                  </tbody>
                </table>
                {labor?.missing_rate && <p className="text-xs text-orange-700">Some labor has no hourly rate set. Set it on Users.</p>}
                {wo.nte_amount != null && (role === "admin" ? rmTotal : wo.total_cost) > wo.nte_amount && (
                  <Alert tone="serious">{t("Total exceeds the not-to-exceed amount — get approval.")}</Alert>
                )}
                <div className="flex items-center justify-end">
                  <SubmitButton size="sm" variant="secondary">{t("Save costs")}</SubmitButton>
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
          <p className="text-right text-xs text-slate-400">{t("Last updated {date}", { date: fmtDate(wo.updated_at, L) })}</p>
        </div>
      </div>
    </>
  );
}
