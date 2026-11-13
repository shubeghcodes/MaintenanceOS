import "server-only";
import { createAdminClient } from "./supabase/admin";
import { appUrl, esc, sendEmail } from "./email";
import { PRIORITY_LABEL } from "./constants";
import { fmtDate, fmtDateTime, fmtTime } from "./format";
import { adminCoverage, detailTable, shell } from "./vendor-notify";
import type { WoPriority } from "./types";

/**
 * Work order emails to people inside the company: admins (new requests to approve),
 * the person who asked for the work (approved, declined, vendor assigned, completed)
 * and the technician it was assigned to. Failures never block the action that sent them.
 */

type Person = { id: string; full_name: string | null; email: string | null; active: boolean; role: string };
type Wo = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  priority: WoPriority;
  category: string;
  location_detail: string | null;
  due_at: string | null;
  scheduled_date: string | null;
  scheduled_start: string | null;
  resolution_notes: string | null;
  company_id: string | null;
  requested_by: string | null;
  site: { name: string; code: string | null; address: string | null; city: string | null; state: string | null } | null;
  requester: Person | null;
  tech: Person | null;
  vendor: { name: string } | null;
};

async function load(woId: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("work_orders")
    .select(
      "id,number,title,description,priority,category,location_detail,due_at,scheduled_date,scheduled_start,resolution_notes,company_id,requested_by," +
        "site:sites(name,code,address,city,state), vendor:vendors(name)," +
        "requester:profiles!work_orders_requested_by_fkey(id,full_name,email,active,role)," +
        "tech:profiles!work_orders_assigned_tech_id_fkey(id,full_name,email,active,role)",
    )
    .eq("id", woId)
    .maybeSingle();
  return { db, wo: data as unknown as Wo | null };
}

const first = (p: Person | null) => (p?.full_name ? p.full_name.split(" ")[0] : null);
const hello = (p: Person | null) => (first(p) ? `Hi ${esc(first(p))},` : "Hello,");
const loc = (wo: Wo) => `${wo.site?.name ?? ""}${wo.site?.code ? ` (Store ${wo.site.code})` : ""}`;
const address = (wo: Wo) => [wo.site?.address, [wo.site?.city, wo.site?.state].filter(Boolean).join(", ")].filter(Boolean).join(", ");
const reachable = (p: Person | null, actorId: string | null): p is Person => !!p && p.active && !!p.email && p.id !== actorId;
/** Requester emails go to the GMs and techs who asked; admins already see everything in the app. */
const requesterReachable = (p: Person | null, actorId: string | null): p is Person => reachable(p, actorId) && p!.role !== "admin";
const strip = (html: string) => html.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "");

function summary(wo: Wo, extra: [string, string | null | undefined][] = []) {
  return detailTable([
    ["Location", esc(loc(wo))],
    ["Address", esc(address(wo))],
    ["Priority", esc(PRIORITY_LABEL[wo.priority])],
    ["Category", esc(wo.category)],
    ["Where on site", esc(wo.location_detail)],
    ["Details", wo.description ? esc(wo.description).replace(/\n/g, "<br>") : null],
    ...extra,
  ]);
}

async function send(to: string | string[], subject: string, eyebrow: string, title: string, intro: string, body: string, woId: string, label = "Open work order") {
  try {
    return await sendEmail({
      to,
      subject,
      html: shell({ eyebrow, title, intro, body, button: { label, url: appUrl(`/work-orders/${woId}`) } }),
      text: `${title}\n\n${strip(intro)}\n\n${appUrl(`/work-orders/${woId}`)}`,
    });
  } catch {
    return { ok: false as const, error: "Email failed" };
  }
}

/** A GM or tech submitted a request: tell the admins who cover that company. */
export async function emailApprovalNeeded(woId: string) {
  const { db, wo } = await load(woId);
  if (!wo) return;
  const covers = await adminCoverage(db, wo.company_id);
  const { data } = await db.from("profiles").select("id,email,active").eq("role", "admin").eq("active", true);
  const to = ((data ?? []) as { id: string; email: string | null }[]).filter((a) => a.email && covers(a.id)).map((a) => a.email!);
  if (!to.length) return;
  const urgent = wo.priority === "emergency" || wo.priority === "high";
  await send(
    to,
    `${urgent ? `[${PRIORITY_LABEL[wo.priority].toUpperCase()}] ` : ""}Approval needed: WO #${wo.number} — ${wo.title} (${wo.site?.name ?? ""})`,
    `Needs approval · WO #${wo.number}`,
    wo.title,
    `${esc(wo.requester?.full_name ?? wo.requester?.email ?? "Someone")} submitted a work order for <b>${esc(loc(wo))}</b>. Approve it and assign a technician or vendor, or decline it.`,
    summary(wo),
    woId,
    "Review and assign",
  );
}

/** Tell the requester their request was approved, and who's on it. */
export async function emailRequesterApproved(woId: string, actorId: string, via: "tech" | "vendor", note?: string | null) {
  const { wo } = await load(woId);
  if (!wo || !requesterReachable(wo.requester, actorId)) return;
  const who = via === "tech" ? (wo.tech?.full_name ?? "one of our technicians") : (wo.vendor?.name ?? "an outside vendor");
  const when = wo.scheduled_date ? `${fmtDate(wo.scheduled_date)}${wo.scheduled_start ? ` at ${fmtTime(wo.scheduled_start)}` : ""}` : null;
  await send(
    wo.requester.email!,
    `Approved: WO #${wo.number} — ${wo.title}`,
    `Approved · WO #${wo.number}`,
    `Your request was approved`,
    `${hello(wo.requester)}<br>Your work order <b>${esc(wo.title)}</b> for ${esc(loc(wo))} was approved and assigned to <b>${esc(who)}</b>${via === "vendor" ? " (outside vendor)" : ""}.${when ? `<br>Scheduled: <b>${esc(when)}</b>` : ""}${note ? `<br><br><b>Note:</b> ${esc(note)}` : ""}`,
    "",
    woId,
  );
}

/** A vendor was put on an already-approved job (or swapped): tell the requester. */
export async function emailRequesterVendorAssigned(woId: string, actorId: string) {
  const { wo } = await load(woId);
  if (!wo || !requesterReachable(wo.requester, actorId)) return;
  await send(
    wo.requester.email!,
    `Vendor assigned: WO #${wo.number} — ${wo.title}`,
    `Update · WO #${wo.number}`,
    `A vendor is on it`,
    `${hello(wo.requester)}<br><b>${esc(wo.vendor?.name ?? "An outside vendor")}</b> has been sent your work order <b>${esc(wo.title)}</b> for ${esc(loc(wo))}. You'll get another email when the work is complete.`,
    "",
    woId,
  );
}

export async function emailRequesterDeclined(woId: string, actorId: string, reason: string) {
  const { wo } = await load(woId);
  if (!wo || !requesterReachable(wo.requester, actorId)) return;
  await send(
    wo.requester.email!,
    `Not approved: WO #${wo.number} — ${wo.title}`,
    `Not approved · WO #${wo.number}`,
    `Your request wasn't approved`,
    `${hello(wo.requester)}<br>Your work order <b>${esc(wo.title)}</b> for ${esc(loc(wo))} wasn't approved.<br><br><b>Reason:</b> ${esc(reason)}<br><br>If something has changed, reply on the work order or submit a new request.`,
    "",
    woId,
  );
}

export async function emailRequesterCompleted(woId: string, actorId: string | null) {
  const { wo } = await load(woId);
  if (!wo || !requesterReachable(wo.requester, actorId)) return;
  await send(
    wo.requester.email!,
    `Completed: WO #${wo.number} — ${wo.title}`,
    `Completed · WO #${wo.number}`,
    `Work completed`,
    `${hello(wo.requester)}<br>Work order <b>${esc(wo.title)}</b> for ${esc(loc(wo))} is complete${wo.tech?.full_name ? ` (${esc(wo.tech.full_name)})` : wo.vendor ? ` (${esc(wo.vendor.name)})` : ""}.${wo.resolution_notes ? `<br><br><b>What was done:</b><br>${esc(wo.resolution_notes).replace(/\n/g, "<br>")}` : ""}<br><br>If anything still isn't right, comment on the work order.`,
    "",
    woId,
  );
}

/** Tell a technician they've been given a job (right away, not just in the morning schedule email). */
export async function emailTechAssigned(woId: string, actorId: string, note?: string | null) {
  const { wo } = await load(woId);
  if (!wo || !reachable(wo.tech, actorId)) return;
  const when = wo.scheduled_date ? `${fmtDate(wo.scheduled_date)}${wo.scheduled_start ? ` at ${fmtTime(wo.scheduled_start)}` : ""}` : "Not scheduled yet";
  const urgent = wo.priority === "emergency" || wo.priority === "high";
  await send(
    wo.tech.email!,
    `${urgent ? `[${PRIORITY_LABEL[wo.priority].toUpperCase()}] ` : ""}Assigned to you: WO #${wo.number} — ${wo.title} (${wo.site?.name ?? ""})`,
    `Assigned to you · WO #${wo.number}`,
    wo.title,
    `${hello(wo.tech)}<br>You've been assigned this work order.${note ? `<br><br><b>Note:</b> ${esc(note)}` : ""}`,
    summary(wo, [
      ["Scheduled", esc(when)],
      ["Due", esc(fmtDateTime(wo.due_at))],
    ]),
    woId,
  );
}

/** GMs (store / property managers) at the work order's location. */
async function siteGms(db: ReturnType<typeof createAdminClient>, siteId: string) {
  const { data } = await db.from("site_members").select("user:profiles(id,full_name,email,active,role)").eq("site_id", siteId);
  return ((data ?? []) as unknown as { user: Person | null }[]).map((m) => m.user).filter((p): p is Person => !!p && p.role === "manager" && p.active && !!p.email);
}

/** Work is done: ask the location's GMs to confirm (or a reminder before it auto-closes). */
export async function emailSignoffRequest(woId: string, opts: { reminder?: boolean; closesOn: string }) {
  const { db, wo } = await load(woId);
  if (!wo) return;
  const { data: siteRow } = await db.from("work_orders").select("site_id").eq("id", woId).single();
  const gms = await siteGms(db, (siteRow as { site_id: string }).site_id);
  if (!gms.length) return;
  const who = wo.tech?.full_name ?? wo.vendor?.name ?? null;
  await send(
    gms.map((g) => g.email!),
    `${opts.reminder ? "Reminder: " : ""}Please confirm WO #${wo.number} is fixed — ${wo.title}`,
    `${opts.reminder ? "Reminder · " : ""}Sign-off needed · WO #${wo.number}`,
    `Is it fixed?`,
    `${who ? `${esc(who)} finished` : "Work was finished on"} <b>${esc(wo.title)}</b> at ${esc(loc(wo))}. Please check it and confirm it's fixed, or send it back if it isn't.${
      wo.resolution_notes ? `<br><br><b>What was done:</b><br>${esc(wo.resolution_notes).replace(/\n/g, "<br>")}` : ""
    }<br><br><span style="color:#64748b">If no one signs off, it closes automatically on ${esc(fmtDate(opts.closesOn))}.</span>`,
    "",
    woId,
    "Review and sign off",
  );
}

/** The GM (or an admin) says it isn't fixed: tell the technician. Vendors get their own email. */
export async function emailTechSentBack(woId: string, actorId: string, note: string) {
  const { wo } = await load(woId);
  if (!wo || !reachable(wo.tech, actorId)) return;
  await send(
    wo.tech.email!,
    `Not fixed — back to you: WO #${wo.number} — ${wo.title} (${wo.site?.name ?? ""})`,
    `Sent back · WO #${wo.number}`,
    `The store says it isn't fixed`,
    `${hello(wo.tech)}<br>The GM at ${esc(loc(wo))} checked <b>${esc(wo.title)}</b> and it still needs work. The work order is open again as a return visit.<br><br><b>Their note:</b> ${esc(note)}`,
    "",
    woId,
  );
}
