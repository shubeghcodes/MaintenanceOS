import "server-only";
import { emailGmsNote } from "./wo-notify";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resendApiBase } from "./email";
import { parseReplyAddress, parseTeamReplyAddress, type ReplyKind } from "./reply-address";
import { saveAttachments } from "./attachments";
import { loadDispatchContext, notifyManagement } from "./vendor-notify";
import { sendAndRecord } from "./dispatch";
import { ACTIVE_DISPATCH } from "./constants";

// ------------------------------------------------------------------ webhook signature (Svix format)

/** Verify a Resend webhook: HMAC-SHA256 over `id.timestamp.body` with the whsec_ secret, 5-minute window. */
export function verifyWebhook(body: string, headers: Headers, secret: string) {
  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  const ts = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const sigHeader = headers.get("svix-signature") ?? headers.get("webhook-signature");
  if (!id || !ts || !sigHeader) return false;
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  return sigHeader.split(" ").some((part) => {
    const [, sig] = part.split(",");
    if (!sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// ------------------------------------------------------------------ reading the email

async function resendGet<T>(path: string): Promise<T> {
  const res = await fetch(`${resendApiBase()}${path}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
  if (!res.ok) throw new Error(`Resend ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

type Received = { id: string; from: string; to: string[]; subject: string | null; text: string | null; html: string | null };
type ReceivedAttachment = { id: string; filename: string; size: number; content_type: string; content_disposition: string | null; content_id: string | null; download_url: string };

function htmlToText(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "\n")
    .replace(/<div class="gmail_quote[\s\S]*$/i, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Keep only the new message: drop the quoted original and common signatures. */
export function extractReply(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const next = (lines[i + 1] ?? "").trim();
    const quoteHeader =
      /^On .+wrote:$/i.test(t) ||
      (/^On .+/.test(t) && /wrote:$/i.test(next)) || // "On Thu, Nov 12 ... <x@y.com>" + "wrote:" on the next line
      /^-{2,}\s*(Original Message|Forwarded message)/i.test(t) ||
      /^_{5,}$/.test(t) ||
      (/^From: .+/i.test(t) && out.some((l) => l.trim())) ||
      /^Sent from my (iPhone|iPad|Android|Galaxy|mobile)/i.test(t) ||
      /^Get Outlook for/i.test(t);
    if (quoteHeader) break;
    if (t.startsWith(">")) continue;
    out.push(lines[i]);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);
}

const bare = (a: string) => ((/<([^>]+)>/.exec(a)?.[1] ?? a).trim().toLowerCase());
const domainOf = (a: string) => bare(a).split("@")[1] ?? "";
const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "live.com", "msn.com", "me.com", "comcast.net", "att.net", "sbcglobal.net"]);

// ------------------------------------------------------------------ main handler

export type InboundOutcome = "vendor_reply" | "staff_reply" | "internal_note" | "team_reply" | "unverified" | "ignored" | "duplicate";

/** Text of the reply (quoted original removed) and its photo / PDF attachments. */
async function readEmail(emailId: string) {
  const email = await resendGet<Received>(`/emails/receiving/${emailId}`);
  const body = extractReply(email.text?.trim() ? email.text : htmlToText(email.html ?? "")) || "(no message text)";
  let files: File[] = [];
  try {
    const list = await resendGet<{ data: ReceivedAttachment[] }>(`/emails/receiving/${emailId}/attachments`);
    for (const a of list.data ?? []) {
      if (a.content_disposition === "inline" && a.size < 25_000) continue;
      if (!/^(image\/|application\/pdf$)/.test(a.content_type) || a.size > 10 * 1024 * 1024) continue;
      const r = await fetch(a.download_url);
      if (!r.ok) continue;
      files.push(new File([await r.arrayBuffer()], a.filename || "attachment", { type: a.content_type }));
    }
  } catch {
    files = [];
  }
  return { body, files };
}

export async function processInboundEmail(
  db: SupabaseClient,
  event: { type: string; data: { email_id: string; from: string; to?: string[]; cc?: string[]; received_for?: string[]; subject?: string } },
): Promise<{ outcome: InboundOutcome; detail?: string }> {
  if (event.type !== "email.received") return { outcome: "ignored", detail: event.type };
  const d = event.data;

  // Resend retries deliveries; the unique provider_id makes this idempotent.
  const { data: logRow, error: dupErr } = await db
    .from("inbound_emails")
    .insert({ provider_id: d.email_id, from_address: d.from, to_address: (d.to ?? []).join(", "), subject: d.subject ?? null })
    .select("id")
    .single();
  if (dupErr?.code === "23505") return { outcome: "duplicate" };
  if (dupErr || !logRow) throw new Error(dupErr?.message ?? "Couldn't log inbound email");
  const finish = async (outcome: InboundOutcome, patch: Record<string, unknown> = {}) => {
    await db.from("inbound_emails").update({ outcome, ...patch }).eq("id", logRow.id);
    return { outcome, detail: patch.detail as string | undefined };
  };

  try {
    return await handle();
  } catch (e) {
    await db.from("inbound_emails").delete().eq("id", logRow.id);
    throw e;
  }

  async function handle(): Promise<{ outcome: InboundOutcome; detail?: string }> {
  // A reply to a team email (GM notes, sign-off, approvals) → note on the work order.
  for (const a of [...(d.to ?? []), ...(d.received_for ?? []), ...(d.cc ?? [])]) {
    const team = parseTeamReplyAddress(a);
    if (team) return handleTeamReply(team.woId);
  }

  // Which work order is this for?
  let route: { dispatchId: string; kind: ReplyKind } | null = null;
  for (const a of [...(d.to ?? []), ...(d.received_for ?? []), ...(d.cc ?? [])]) {
    route = parseReplyAddress(a);
    if (route) break;
  }
  if (!route) return finish("ignored", { detail: "Not addressed to a work order reply address" });

  const ctx = await loadDispatchContext(db, route.dispatchId);
  if (!ctx) return finish("ignored", { detail: "Unknown work order", dispatch_id: null });
  const { data: dispatchRow } = await db.from("vendor_dispatches").select("status,token_version,vendor:vendors(email)").eq("id", route.dispatchId).single();
  const vendorDirEmail = ((dispatchRow as unknown as { vendor: { email: string | null } | null } | null)?.vendor?.email ?? "").toLowerCase();

  // Who sent it?
  const from = bare(d.from);
  const { data: staff } = await db.from("profiles").select("id,full_name,email,role,active").ilike("email", from).maybeSingle();
  const isStaff = !!staff && staff.active && (staff.role === "admin" || staff.role === "tech");
  const vendorAddrs = [ctx.dispatch.contact_email.toLowerCase(), vendorDirEmail].filter(Boolean);
  const isVendor =
    vendorAddrs.includes(from) ||
    (!FREE_MAIL.has(domainOf(from)) && vendorAddrs.some((v) => domainOf(v) === domainOf(from)));

  // Content + attachments.
  const email = await resendGet<Received>(`/emails/receiving/${d.email_id}`);
  const body = extractReply(email.text?.trim() ? email.text : htmlToText(email.html ?? "")) || "(no message text)";
  let files: File[] = [];
  try {
    const list = await resendGet<{ data: ReceivedAttachment[] }>(`/emails/receiving/${d.email_id}/attachments`);
    for (const a of list.data ?? []) {
      // Skip tiny inline images (logos, signature icons).
      if (a.content_disposition === "inline" && a.size < 25_000) continue;
      if (!/^(image\/|application\/pdf$)/.test(a.content_type) || a.size > 10 * 1024 * 1024) continue;
      const r = await fetch(a.download_url);
      if (!r.ok) continue;
      files.push(new File([await r.arrayBuffer()], a.filename || "attachment", { type: a.content_type }));
    }
  } catch {
    files = []; // message still posts; attachments are best effort
  }

  const woId = ctx.wo.id;
  const meta = { via: "email", from, subject: d.subject ?? null, email_id: d.email_id, dispatch_id: route.dispatchId };
  const actorName = (n: string | null) => n || from;
  const saveFiles = (label: string, visibility: "shared" | "internal") =>
    saveAttachments(db, "work_order", woId, staff?.id ?? null, files, { category: "photo", visibility, dispatchId: route!.dispatchId, label });

  // 1) The vendor replied to a work order email → shared message on the work order.
  if (route.kind === "vendor" && isVendor) {
    const label = `${ctx.dispatch.contact_name && vendorAddrs[0] === from ? ctx.dispatch.contact_name : from} · ${ctx.vendor.name}`;
    const saved = await saveFiles(label, "shared");
    await db.from("work_order_events").insert({
      work_order_id: woId,
      kind: "email_reply",
      body,
      actor_type: "vendor",
      actor_label: label,
      visibility: "shared",
      meta: { ...meta, files: saved.length },
    });
    await notifyManagement(db, ctx, "email_reply", label, { note: `${body}${saved.length ? `\n\n📎 ${saved.length} attachment(s) added` : ""}` });
    await emailGmsNote(woId, { body, authorLabel: label });
    return finish("vendor_reply", { work_order_id: woId, dispatch_id: route.dispatchId, attachment_count: saved.length });
  }

  // 2) Our staff replied → vendor thread: message the vendor; internal thread: internal note.
  if (isStaff) {
    const shared = route.kind === "vendor";
    const saved = await saveFiles(actorName(staff!.full_name), shared ? "shared" : "internal");
    await db.from("work_order_events").insert({
      work_order_id: woId,
      user_id: staff!.id,
      kind: "comment",
      body,
      actor_type: "user",
      visibility: shared ? "shared" : "internal",
      meta: { ...meta, ...(shared ? { to_vendor: true } : {}), files: saved.length },
    });
    await emailGmsNote(woId, { body: shared ? `(Message to the vendor) ${body}` : body, authorId: staff!.id });
    if (shared && dispatchRow && ACTIVE_DISPATCH.includes((dispatchRow as { status: string }).status as never)) {
      await sendAndRecord(db, route.dispatchId, (dispatchRow as { token_version: number }).token_version, "message", { note: body });
    }
    return finish(shared ? "staff_reply" : "internal_note", { work_order_id: woId, dispatch_id: route.dispatchId, attachment_count: saved.length });
  }

  // 3) Anyone else: keep it, but internal-only and flagged.
  const saved = await saveFiles(from, "internal");
  await db.from("work_order_events").insert({
    work_order_id: woId,
    kind: "email_reply",
    body: `⚠ Email from ${from} (not the assigned vendor or a staff member). Not shared with the vendor.\n\n${body}`,
    actor_type: "system",
    actor_label: from,
    visibility: "internal",
    meta: { ...meta, unverified: true, files: saved.length },
  });
  await notifyManagement(db, ctx, "unverified_email", from, { note: body });
  return finish("unverified", { work_order_id: woId, dispatch_id: route.dispatchId, attachment_count: saved.length, detail: `Sender ${from} not recognized` });
  }

  /** GMs at the work order's location, techs and admins post a note; anyone else is kept as a flagged staff-only note. */
  async function handleTeamReply(woId: string): Promise<{ outcome: InboundOutcome; detail?: string }> {
    const { data: wo } = await db.from("work_orders").select("id,site_id").eq("id", woId).maybeSingle();
    if (!wo) return finish("ignored", { detail: "Unknown work order" });
    const from = bare(d.from);
    const { data: person } = await db.from("profiles").select("id,full_name,email,role,active").ilike("email", from).maybeSingle();
    let allowed = !!person && person.active && (person.role === "admin" || person.role === "tech");
    if (person && person.active && person.role === "manager") {
      const { count } = await db.from("site_members").select("user_id", { count: "exact", head: true }).eq("site_id", wo.site_id).eq("user_id", person.id);
      allowed = !!count;
    }
    const { body, files } = await readEmail(d.email_id);
    const meta = { via: "email", from, subject: d.subject ?? null, email_id: d.email_id };
    const saved = await saveAttachments(db, "work_order", woId, allowed ? person!.id : null, files, {
      category: "photo",
      visibility: "internal",
      label: allowed ? person!.full_name || from : from,
    });
    if (allowed) {
      await db.from("work_order_events").insert({
        work_order_id: woId,
        user_id: person!.id,
        kind: "comment",
        body,
        actor_type: "user",
        visibility: "internal",
        meta: { ...meta, files: saved.length },
      });
      // A tech's or admin's reply is a note the GMs should see; a GM's reply doesn't email the GMs.
      await emailGmsNote(woId, { body, authorId: person!.id });
      return finish("team_reply", { work_order_id: woId, attachment_count: saved.length });
    }
    await db.from("work_order_events").insert({
      work_order_id: woId,
      kind: "email_reply",
      body: `⚠ Email from ${from} (not a GM at this location or a staff member). Staff only.\n\n${body}`,
      actor_type: "system",
      actor_label: from,
      visibility: "internal",
      meta: { ...meta, unverified: true, files: saved.length },
    });
    return finish("unverified", { work_order_id: woId, attachment_count: saved.length, detail: `Sender ${from} not recognized` });
  }
}
