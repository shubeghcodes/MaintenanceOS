import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { listAttachments } from "@/lib/attachments";
import { fmtDate, fmtFreq, personName, relativeDue, todayISO } from "@/lib/format";
import type { ComplianceRecord, ComplianceRequirement, WoStatus } from "@/lib/types";
import { Alert, Badge, Card, CardHeader, DefList, EmptyState, Field, Input, PageHeader, Select, Stat, Textarea } from "@/components/ui";
import { DueBadge, StatusBadge } from "@/components/badges";
import { Attachments } from "@/components/Attachments";
import { SubmitButton } from "@/components/SubmitButton";
import { RequirementForm } from "../RequirementForm";
import { deleteRequirement, logCompletion, scheduleCompliance, uploadComplianceFiles } from "../actions";

export default async function RequirementPage({
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
    .from("compliance_requirements")
    .select("*, site:sites(id,name), vendor:vendors(id,name,phone)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const req = data as unknown as ComplianceRequirement & { site: { id: string; name: string } | null; vendor: { id: string; name: string; phone: string | null } | null };

  const [{ data: recData }, { data: woData }, files, lookups] = await Promise.all([
    supabase
      .from("compliance_records")
      .select("*, vendor:vendors(name), recorder:profiles(full_name,email)")
      .eq("requirement_id", id)
      .order("completed_on", { ascending: false }),
    supabase
      .from("work_orders")
      .select("id,number,status,due_at")
      .eq("compliance_requirement_id", id)
      .in("status", ["new", "assigned", "in_progress", "on_hold"]),
    listAttachments(supabase, "compliance", id),
    getLookups(supabase, { allCompanies: true }),
  ]);
  const records = (recData ?? []) as (ComplianceRecord & { vendor: { name: string } | null; recorder: { full_name: string | null; email: string | null } | null })[];
  const openWos = (woData ?? []) as { id: string; number: number; status: WoStatus; due_at: string | null }[];
  const isAdmin = profile.role === "admin";
  const canLog = isAdmin || profile.role === "tech";

  return (
    <>
      <PageHeader
        title={req.name}
        subtitle={
          <span className="flex items-center gap-2">
            <DueBadge date={req.next_due_on} /> {req.site?.name} · {fmtFreq(req.frequency_interval, req.frequency_unit)}
          </span>
        }
        back={{ href: "/compliance", label: "Compliance" }}
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.saved && <Alert tone="good">Requirement saved.</Alert>}
      {sp.logged && <Alert tone="good">Completion recorded. Next due date updated.</Alert>}
      {sp.notice && <Alert tone="good">{sp.notice}</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Next due"
          value={relativeDue(req.next_due_on)}
          sub={req.scheduled_for ? `${fmtDate(req.next_due_on)} · service scheduled ${fmtDate(req.scheduled_for)}` : `${fmtDate(req.next_due_on)} · not scheduled`}
        />
        <Stat label="Last completed" value={req.last_completed_on ? fmtDate(req.last_completed_on) : "—"} />
        <Stat label="Records" value={records.length} sub={`${records.filter((r) => r.result === "fail").length} failed`} />
        <Stat label="Vendor" value={<span className="text-lg">{req.vendor?.name ?? "—"}</span>} sub={req.vendor?.phone ?? undefined} />
      </div>

      {openWos.length > 0 && (
        <Alert tone="info">
          Open work order{openWos.length > 1 ? "s" : ""}:{" "}
          {openWos.map((w) => (
            <Link key={w.id} href={`/work-orders/${w.id}`} className="mr-2 font-medium underline">
              #{w.number}
            </Link>
          ))}
          — completing it records the inspection automatically.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="History" />
            {records.length === 0 ? (
              <EmptyState title="No completions recorded yet." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {records.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{fmtDate(r.completed_on)}</span>
                      <Badge tone={r.result === "pass" ? "good" : r.result === "fail" ? "critical" : "warning"}>
                        {r.result === "pass" ? "Pass" : r.result === "fail" ? "Fail" : "Conditional"}
                      </Badge>
                      {r.vendor && <span className="text-slate-500">· {r.vendor.name}</span>}
                      {r.certificate_number && <span className="text-slate-500">· Cert #{r.certificate_number}</span>}
                      {r.work_order_id && (
                        <Link href={`/work-orders/${r.work_order_id}`} className="text-xs text-brand-700">
                          View WO
                        </Link>
                      )}
                    </div>
                    {r.notes && <p className="mt-1 text-slate-600">{r.notes}</p>}
                    <p className="mt-0.5 text-xs text-slate-400">Recorded by {personName(r.recorder)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div id="certificates"><Attachments items={files} action={canLog ? uploadComplianceFiles : undefined} hidden={{ id }} title="Certificates & reports" /></div>

          {isAdmin ? (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Edit requirement</h2>
              <RequirementForm req={req} sites={lookups.sites} vendors={lookups.vendors} />
            </div>
          ) : (
            <Card>
              <CardHeader title="Details" />
              <DefList
                items={[
                  ["Category", req.category],
                  ["Authority / standard", req.authority ?? "—"],
                  ["Reminder", `${req.lead_days} days before`],
                  ["Auto work order", req.auto_create_wo ? "Yes" : "No"],
                ]}
              />
              {req.notes && <p className="border-t border-slate-100 px-5 py-4 text-sm">{req.notes}</p>}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {isAdmin && (
            <Card>
              <CardHeader
                title="Schedule service"
                subtitle={req.scheduled_for ? `Currently ${fmtDate(req.scheduled_for)}` : "Pick a date and email the vendor"}
                action={<Link href={`/compliance/calendar?month=${(req.scheduled_for ?? req.next_due_on).slice(0, 7)}`} className="text-xs font-medium text-brand-700">Calendar</Link>}
              />
              <form action={scheduleCompliance} className="space-y-3 p-5">
                <input type="hidden" name="requirement_id" value={id} />
                <input type="hidden" name="back" value={`/compliance/${id}`} />
                <Field label="Service date">
                  <Input type="date" name="date" required defaultValue={req.scheduled_for ?? req.next_due_on} />
                </Field>
                <Field label="Vendor">
                  <Select name="vendor_id" defaultValue={req.vendor_id ?? ""}>
                    <option value="">— In-house / no vendor —</option>
                    {lookups.vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Note to vendor (optional)">
                  <Input name="note" />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="send" defaultChecked={!!req.vendor_id} className="rounded border-slate-300" /> Email the work order to the vendor
                </label>
                <SubmitButton pendingText="Scheduling…">Schedule</SubmitButton>
              </form>
            </Card>
          )}
          {canLog && (
            <Card>
              <CardHeader title="Record completion" subtitle="Pass or conditional rolls the due date forward." />
              <form action={logCompletion} className="space-y-3 p-5">
                <input type="hidden" name="id" value={id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date">
                    <Input type="date" name="completed_on" required defaultValue={todayISO()} />
                  </Field>
                  <Field label="Result">
                    <Select name="result" defaultValue="pass">
                      <option value="pass">Pass</option>
                      <option value="conditional">Conditional</option>
                      <option value="fail">Fail</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Vendor">
                  <Select name="vendor_id" defaultValue={req.vendor_id ?? ""}>
                    <option value="">— None / in-house —</option>
                    {lookups.vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Certificate / report #">
                  <Input name="certificate_number" />
                </Field>
                <Field label="Notes">
                  <Textarea name="notes" rows={2} placeholder="Deficiencies, follow-ups…" />
                </Field>
                <Field label="Certificate file">
                  <input type="file" name="files" multiple accept="image/*,application/pdf" className="block w-full text-xs" />
                </Field>
                <SubmitButton>Record</SubmitButton>
              </form>
            </Card>
          )}
          {isAdmin && (
            <form action={deleteRequirement} className="text-right">
              <input type="hidden" name="id" value={id} />
              <SubmitButton size="sm" variant="ghost" confirm="Delete this requirement and its history?">
                Delete requirement
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
