import "server-only";
import { createAdminClient } from "./supabase/admin";
import { PRIORITY_LABEL } from "./constants";
import { appUrl, esc, sendEmail } from "./email";
import { fmtDate, fmtTime } from "./format";
import { detailTable, shell } from "./vendor-notify";
import type { WoPriority } from "./types";

/**
 * Work order emails to staff: admins (new requests), the person who asked for the work
 * (approved / not approved / vendor assigned / completed) and the assigned technician.
 * Lookups use the service-role client so a GM's action can still find the right admins.
 * Every send is best-effort: a failed email never blocks the action that triggered it.
 */

type Person = { id: string; email: string | null; full_name: string | null; role: string; active: boolean };

type WoInfo = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  priority: WoPriority;
  status: string;
  site_id: string;
  requested_by: string | null;
  assigned_tech_id: string | null;
  scheduled_date: string | null;
  scheduled_start: string | null;
  resolution_notes: string | null;
  location_detail: string | null;
  site: { name: string; code: string | null; address: string | null; city: string | null } | null;
  vendor: { name: string } | null;
  tech: { full_name: string | null; email: string | null } | null;
};

async function loadWo(woId: string): Promise<WoInfo | null> {
  const { data } = await createAdminClient()
    .from("work_orders")
    .select(
      "id,number,title,description,priority,status,site_id,requested_by,assigned_tech_id,scheduled_date,scheduled_start,resolution_notes,location_detail," +
        "site:sites(name,code,address,city), vendor:vendors(name), tech:profiles!work_orders_assigned_tech_id_fkey(full_name,email)",
    )
    .eq("id", woId)
    .maybeSingle();
  return (data as unknown as WoInfo) ?? null;
}

async function person(id: string | null): Promise<Person | null> {
  if (!id) return null;
  const { data } = await createAdminClient().from("profiles").select("id,email,full_name,role,active").eq("id", id).maybeSingle();
  return (data as Person) ?? null;
}

const first = (p: { full_name: string | null } | null) => (p?.full_name ?? "").split(" ")[0];
const nameOf = (p: { full_name: string | null; email: string | null } | null) => p?.full_name || p?.email || "";
const where = (w: WoInfo) => `${w.site?.name ?? ""}${w.site?.code ? ` (Store ${w.site.code})` : ""}`;
const btn = (w: WoInfo) => ({ label: "Open work order", url: appUrl(`/work-orders/${w.id}`) });

/** Active admins who cover this location: super admins, admins with no company limits, and admins limited to its company. */
export async function adminEmailsForSite(siteId: string | null): Promise<string[]> {
  const db = createAdminClient();
  const [{ data: admins }, { data: limits }, { data: site }] = await Promise.all([
    db.from("profiles").select("id,email,is_super").eq("role", "admin").eq("active", true),
    db.from("admin_companies").select("user_id,company_id"),
    siteId ? db.from("sites").select("company_id").eq("id", siteId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const companyId = (site as { company_id: string | null } | null)?.company_id ?? null;
  const byUser = new Map<string, string[]>();
  for (const l of (limits ?? []) as { user_id: string; company_id: string }[]) byUser.set(l.user_id, [...(byUser.get(l.user_id) ?? []), l.company_id]);
  return ((admins ?? []) as { id: string; email: string | null; is_super: boolean }[])
    .filter((a) => a.email && (a.is_super || !byUser.has(a.id) || (companyId != null && byUser.get(a.id)!.includes(companyId))))
    .map((a) => a.email!.toLowerCase());
}

function details(w: WoInfo, extra: [string, string | null | undefined][] = []) {
  return detailTable([
    ["Location", esc(where(w))],
    ["Address", esc([w.site?.address, w.site?.city].filter(Boolean).join(", "))],
    ["Priority", esc(PRIORITY_LABEL[w.priority])],
    ["Area", esc(w.location_detail)],
    ...extra,
  ]);
}

async function safeSend(msg: Parameters<typeof sendEmail>[0]) {
  try {
    return await sendEmail(msg);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Email failed" };
  }
}

/** A GM or tech submitted a request: tell the admins for that location (used for emergency and high priority). */
export async function notifyAdminsOfRequest(woId: string) {
  const w = await loadWo(woId);
  if (!w) return;
  const to = await adminEmailsForSite(w.site_id);
  if (!to.length) return;
  const requester = await person(w.requested_by);
  const urgent = w.priority === "emergency";
  const label = urgent ? "EMERGENCY" : `${PRIORITY_LABEL[w.priority]} priority`;
  await safeSend({
    to,
    subject: `[Approval needed] ${label} — WO #${w.number}: ${w.title}`,
    html: shell({
      eyebrow: `Approval needed · WO #${w.number}`,
      title: `${urgent ? "Emergency request" : "New request"}: ${w.title}`,
      intro: `${esc(nameOf(requester) || "Someone")} submitted a ${esc(label.toLowerCase())} request that needs approval and an assignee.${
        w.description ? `<br><br><div style="padding:12px;background:#f8fafc;border-radius:8px;color:#0f172a">${esc(w.description).replace(/\n/g, "<br>")}</div>` : ""
      }`,
      body: details(w),
      button: { label: "Approve & assign", url: appUrl(`/work-orders/${w.id}#approve`) },
    }),
    text: `${label} request needs approval: WO #${w.number} ${w.title} at ${where(w)}.\n${w.description ?? ""}\n${appUrl(`/work-orders/${w.id}`)}`,
  });
}

export type RequesterEvent = "approved" | "rejected" | "vendor_assigned" | "completed";

/** Keep the person who asked for the work in the loop. Skipped when they did it themselves. */
export async function notifyRequester(woId: string, event: RequesterEvent, actorId: string | null, note?: string | null) {
  const w = await loadWo(woId);
  if (!w?.requested_by || w.requested_by === actorId) return;
  const r = await person(w.requested_by);
  if (!r?.active || !r.email || r.role === "vendor") return;
  const hi = first(r) ? `Hi ${esc(first(r))},` : "Hello,";
  const assignee = w.tech ? nameOf(w.tech) : w.vendor ? w.vendor.name : null;
  const when = w.scheduled_date ? `${fmtDate(w.scheduled_date)}${w.scheduled_start ? ` at ${fmtTime(w.scheduled_start)}` : ""}` : null;
  const noteBox = note ? `<br><br><div style="padding:12px;background:#f8fafc;border-radius:8px;color:#0f172a">${esc(note).replace(/\n/g, "<br>")}</div>` : "";

  const copy: Record<RequesterEvent, { subject: string; title: string; intro: string; extra: [string, string | null | undefined][] }> = {
    approved: {
      subject: `Approved: WO #${w.number} — ${w.title}`,
      title: `Your request was approved — #${w.number}`,
      intro: `${hi}<br>Your request <b>${esc(w.title)}</b> was approved${assignee ? ` and assigned to <b>${esc(assignee)}</b>` : ". We'll assign it shortly"}.${noteBox}`,
      extra: [["Assigned to", esc(assignee) || "Being assigned"], ["Scheduled", esc(when)]],
    },
    rejected: {
      subject: `Not approved: WO #${w.number} — ${w.title}`,
      title: `Your request wasn't approved — #${w.number}`,
      intro: `${hi}<br>Your request <b>${esc(w.title)}</b> was not approved and has been closed.${noteBox}<br><br>Reply to your admin or submit a new request if it still needs attention.`,
      extra: [],
    },
    vendor_assigned: {
      subject: `Vendor assigned: WO #${w.number} — ${w.title}`,
      title: `A vendor is assigned — #${w.number}`,
      intro: `${hi}<br><b>${esc(w.vendor?.name ?? "An outside vendor")}</b> has been assigned to <b>${esc(w.title)}</b>. You'll see their updates on the work order.${noteBox}`,
      extra: [["Vendor", esc(w.vendor?.name)]],
    },
    completed: {
      subject: `Completed: WO #${w.number} — ${w.title}`,
      title: `Work completed — #${w.number}`,
      intro: `${hi}<br>The work on <b>${esc(w.title)}</b> has been completed${assignee ? ` by ${esc(assignee)}` : ""}.${
        w.resolution_notes ? `<br><br><b>What was done:</b><br>${esc(w.resolution_notes).replace(/\n/g, "<br>")}` : ""
      }<br><br>If something still isn't right, comment on the work order.`,
      extra: [],
    },
  };
  const c = copy[event];
  await safeSend({
    to: r.email,
    subject: c.subject,
    html: shell({ eyebrow: `Work order #${w.number}`, title: c.title, intro: c.intro, body: details(w, c.extra), button: btn(w) }),
    text: `${c.title}\n${w.title} at ${where(w)}\n${note ?? ""}\n${appUrl(`/work-orders/${w.id}`)}`,
  });
}

/** Tell a technician they've been given a job (skipped when they assigned themselves). */
export async function notifyTechAssigned(woId: string, actorId: string | null) {
  const w = await loadWo(woId);
  if (!w?.assigned_tech_id || w.assigned_tech_id === actorId) return;
  const t = await person(w.assigned_tech_id);
  if (!t?.active || !t.email) return;
  const when = w.scheduled_date ? `${fmtDate(w.scheduled_date)}${w.scheduled_start ? ` at ${fmtTime(w.scheduled_start)}` : ""}` : "Not scheduled yet";
  const urgent = w.priority === "emergency";
  await safeSend({
    to: t.email,
    subject: `${urgent ? "EMERGENCY — " : ""}New job assigned: WO #${w.number} — ${w.title}`,
    html: shell({
      eyebrow: `New job · WO #${w.number}`,
      title: w.title,
      intro: `${first(t) ? `Hi ${esc(first(t))},` : "Hello,"}<br>You've been assigned a ${urgent ? "<b>emergency</b> " : ""}job.${
        w.description ? `<br><br><div style="padding:12px;background:#f8fafc;border-radius:8px;color:#0f172a">${esc(w.description).replace(/\n/g, "<br>")}</div>` : ""
      }`,
      body: details(w, [["Scheduled", esc(when)]]),
      button: btn(w),
    }),
    text: `New job assigned: WO #${w.number} ${w.title} at ${where(w)} (${PRIORITY_LABEL[w.priority]}). ${when}.\n${appUrl(`/work-orders/${w.id}`)}`,
  });
}
