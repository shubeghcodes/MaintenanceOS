"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, requireRole } from "@/lib/auth";
import { saveAttachments } from "@/lib/attachments";
import { addDaysISO, num, str, todayISO } from "@/lib/format";
import type { SiteType } from "@/lib/types";
import { TEMPLATES } from "./templates";
import { createDispatch, sendAndRecord } from "@/lib/dispatch";
import { autoDispatchCompliance, complianceInstructions } from "@/lib/compliance-dispatch";
import { ACTIVE_DISPATCH } from "@/lib/constants";
import { dayLabel, isISODate } from "@/lib/format";

export async function saveRequirement(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "id");
  const back = id ? `/compliance/${id}` : "/compliance/new";
  const row = {
    site_id: str(fd, "site_id"),
    name: str(fd, "name"),
    category: str(fd, "category") ?? "Fire/Life Safety",
    authority: str(fd, "authority"),
    frequency_interval: num(fd, "frequency_interval") ?? 1,
    frequency_unit: str(fd, "frequency_unit") ?? "year",
    next_due_on: str(fd, "next_due_on"),
    lead_days: num(fd, "lead_days") ?? 21,
    vendor_id: str(fd, "vendor_id"),
    notes: str(fd, "notes"),
    auto_create_wo: fd.get("auto_create_wo") === "on",
    auto_dispatch: fd.get("auto_dispatch") === "on",
    active: fd.get("active") === "on",
  };
  if (!row.site_id || !row.name || !row.next_due_on) redirect(`${back}?error=Site,+name+and+next+due+date+are+required`);
  const res = id
    ? await supabase.from("compliance_requirements").update(row).eq("id", id).select("id").single()
    : await supabase.from("compliance_requirements").insert(row).select("id").single();
  if (res.error || !res.data) redirect(`${back}?error=${encodeURIComponent(res.error?.message ?? "Save failed")}`);
  revalidatePath("/compliance");
  redirect(`/compliance/${res.data.id}?saved=1`);
}

export async function deleteRequirement(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "id")!;
  const { error } = await supabase.from("compliance_requirements").delete().eq("id", id);
  if (error) redirect(`/compliance/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/compliance");
  redirect("/compliance");
}

/** Record an inspection/service. A pass rolls the next due date forward from the completion date. */
export async function logCompletion(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (!(profile.role === "admin" || profile.role === "tech")) redirect(`/compliance/${id}?error=Not+allowed`);
  const { data: rec, error } = await supabase
    .from("compliance_records")
    .insert({
      requirement_id: id,
      completed_on: str(fd, "completed_on") ?? todayISO(),
      result: str(fd, "result") ?? "pass",
      vendor_id: str(fd, "vendor_id"),
      certificate_number: str(fd, "certificate_number"),
      notes: str(fd, "notes"),
      recorded_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !rec) redirect(`/compliance/${id}?error=${encodeURIComponent(error?.message ?? "Couldn't save")}`);
  const fileIds = await saveAttachments(supabase, "compliance", id, profile.id, fd.getAll("files"), { category: "certificate" });
  if (fileIds.length) await supabase.from("attachments").update({ compliance_record_id: rec.id }).in("id", fileIds);
  revalidatePath("/compliance");
  revalidatePath(`/compliance/${id}`);
  redirect(`/compliance/${id}?logged=1`);
}

export async function uploadComplianceFiles(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  // Certificates uploaded here belong to the most recent completion, so they show on the Certificates tab.
  const { data: latest } = await supabase
    .from("compliance_records")
    .select("id")
    .eq("requirement_id", id)
    .order("completed_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ids = await saveAttachments(supabase, "compliance", id, profile.id, fd.getAll("files"), { category: "certificate" });
  if (latest && ids.length) await supabase.from("attachments").update({ compliance_record_id: latest.id }).in("id", ids);
  revalidatePath(`/compliance/${id}`);
}

/** Add the standard checklist for a site's type, skipping items it already has. */
export async function applyTemplate(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const siteId = str(fd, "site_id");
  if (!siteId) redirect("/compliance?error=Pick+a+site");
  const [{ data: site }, { data: existing }] = await Promise.all([
    supabase.from("sites").select("id,type").eq("id", siteId).single(),
    supabase.from("compliance_requirements").select("name").eq("site_id", siteId),
  ]);
  if (!site) redirect("/compliance?error=Site+not+found");
  const have = new Set((existing ?? []).map((e) => e.name.toLowerCase()));
  // New items default to due in 30 days — edit each with the real date from your last certificate.
  const due = addDaysISO(todayISO(), 30);
  const rows = TEMPLATES[site.type as SiteType]
    .filter((t) => !have.has(t.name.toLowerCase()))
    .map((t) => ({ ...t, site_id: siteId, next_due_on: due }));
  if (rows.length) {
    const { error } = await supabase.from("compliance_requirements").insert(rows);
    if (error) redirect(`/compliance?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/compliance");
  redirect(`/compliance?site=${siteId}&added=${rows.length}`);
}

const backTo = (fd: FormData, fallback: string) => {
  const b = str(fd, "back");
  return b && b.startsWith("/compliance") ? b : fallback;
};
const withMsg = (url: string, key: string, msg: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`;

/**
 * Set (or change) the service date for a compliance item, make sure its work order exists,
 * and optionally email the vendor right away with the secure work order link.
 */
export async function scheduleCompliance(fd: FormData) {
  const { supabase, profile } = await requireRole("admin");
  const id = str(fd, "requirement_id")!;
  const back = backTo(fd, `/compliance/${id}`);
  const date = str(fd, "date");
  if (!isISODate(date)) redirect(withMsg(back, "error", "Pick a service date."));
  const vendorId = str(fd, "vendor_id");
  const send = fd.get("send") === "on";

  const { error: upErr } = await supabase.from("compliance_requirements").update({ scheduled_for: date, vendor_id: vendorId }).eq("id", id);
  if (upErr) redirect(withMsg(back, "error", upErr.message));
  const { data: woId, error: rpcErr } = await supabase.rpc("ensure_compliance_work_order", { p_requirement: id, p_scheduled: date });
  if (rpcErr || !woId) redirect(withMsg(back, "error", rpcErr?.message ?? "Couldn't create the work order"));
  await supabase.from("work_orders").update({ vendor_id: vendorId, scheduled_date: date }).eq("id", woId);

  let msg = `Scheduled for ${dayLabel(date, "long")}.`;
  if (send) {
    if (!vendorId) redirect(withMsg(back, "error", "Pick a vendor to email."));
    const { data: req } = await supabase.from("compliance_requirements").select("name,authority,next_due_on,scheduled_for").eq("id", id).single();
    const { data: vendor } = await supabase.from("vendors").select("name,email,contact_name,phone").eq("id", vendorId).single();
    const email = (str(fd, "contact_email") ?? vendor?.email ?? "").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(withMsg(back, "error", `Add an email for ${vendor?.name ?? "this vendor"} to send it.`));
    const note = str(fd, "note");

    // Already with this vendor? Update the date on their existing link instead of sending a new one.
    const { data: live } = await supabase
      .from("vendor_dispatches")
      .select("id,vendor_id,token_version")
      .eq("work_order_id", woId)
      .in("status", ACTIVE_DISPATCH)
      .maybeSingle();
    if (live && live.vendor_id === vendorId) {
      await supabase.from("vendor_dispatches").update({ requested_by: date }).eq("id", live.id);
      const r = await sendAndRecord(supabase, live.id, live.token_version, "updated", { note: `Service date set to ${dayLabel(date, "long")}.${note ? ` ${note}` : ""}` });
      msg += r.ok ? ` ${vendor?.name} was emailed the new date.` : ` Email failed: ${r.error}`;
    } else {
      const r = await createDispatch(supabase, {
        woId,
        vendorId,
        contactEmail: email,
        contactName: vendor?.contact_name,
        contactPhone: vendor?.phone,
        requestedBy: date,
        instructions: req ? complianceInstructions(req, note) : note,
        createdBy: profile.id,
        reason: "Compliance service scheduled and emailed to vendor",
      });
      if (!r.ok) redirect(withMsg(back, "error", r.error));
      msg += r.emailOk ? ` Work order emailed to ${vendor?.name}.` : ` Saved, but the email failed: ${r.emailError}`;
    }
  }
  revalidatePath("/compliance", "layout");
  revalidatePath("/vendor-jobs");
  redirect(withMsg(back, "notice", msg));
}

export async function clearComplianceDate(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "requirement_id")!;
  const back = backTo(fd, `/compliance/${id}`);
  await supabase.from("compliance_requirements").update({ scheduled_for: null }).eq("id", id);
  await supabase
    .from("work_orders")
    .update({ scheduled_date: null })
    .eq("compliance_requirement_id", id)
    .not("status", "in", "(completed,cancelled)");
  revalidatePath("/compliance", "layout");
  redirect(withMsg(back, "notice", "Service date cleared."));
}

/** "Email due items now": create due work orders and email vendors without waiting for the morning job. */
export async function runComplianceEmails(fd: FormData) {
  const { supabase, profile } = await requireRole("admin");
  const back = backTo(fd, "/compliance");
  await supabase.rpc("generate_due_work_orders");
  const results = await autoDispatchCompliance(supabase, profile.id);
  const sent = results.filter((r) => r.status === "sent");
  const skipped = results.filter((r) => r.status !== "sent");
  const msg = [
    sent.length ? `Emailed ${sent.length} vendor work order${sent.length > 1 ? "s" : ""}: ${sent.map((r) => `${r.item} → ${r.vendor}`).join("; ")}.` : "No new compliance work orders to email.",
    skipped.length ? `Not sent: ${skipped.map((r) => `${r.item} (${r.reason})`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  revalidatePath("/compliance", "layout");
  redirect(withMsg(back, skipped.length ? "error" : "notice", msg));
}
