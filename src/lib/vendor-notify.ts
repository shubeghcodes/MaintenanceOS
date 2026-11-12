import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRIORITY_LABEL } from "./constants";
import { appUrl, esc, sendEmail, type EmailAttachment, type EmailResult } from "./email";
import { fmtDate, fmtMoney } from "./format";
import { replyAddress } from "./reply-address";
import type { WoPriority } from "./types";

/** Everything the vendor and management emails need about one dispatched job. */
export type DispatchContext = {
  dispatch: {
    id: string;
    contact_name: string | null;
    contact_email: string;
    contact_phone: string | null;
    instructions: string | null;
    requested_by: string | null;
    created_by: string | null;
    token_expires_at: string;
  };
  wo: {
    id: string;
    number: number;
    title: string;
    description: string | null;
    priority: WoPriority;
    nte_amount: number | null;
    location_detail: string | null;
  };
  site: { name: string; code: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null } | null;
  asset: { name: string; manufacturer: string | null; model: string | null; serial_number: string | null } | null;
  vendor: { id: string; name: string };
};

export async function loadDispatchContext(db: SupabaseClient, dispatchId: string): Promise<DispatchContext | null> {
  const { data } = await db
    .from("vendor_dispatches")
    .select(
      "id,contact_name,contact_email,contact_phone,instructions,requested_by,created_by,token_expires_at," +
        "vendor:vendors(id,name)," +
        "wo:work_orders(id,number,title,description,priority,nte_amount,location_detail," +
        "site:sites(name,code,address,city,state,zip,phone), asset:assets(name,manufacturer,model,serial_number))",
    )
    .eq("id", dispatchId)
    .maybeSingle();
  if (!data) return null;
  const d = data as unknown as DispatchContext["dispatch"] & {
    vendor: DispatchContext["vendor"];
    wo: DispatchContext["wo"] & { site: DispatchContext["site"]; asset: DispatchContext["asset"] };
  };
  const { vendor, wo, ...dispatch } = d;
  const { site, asset, ...woRest } = wo;
  return { dispatch, wo: woRest, site, asset, vendor };
}

const FONT = "-apple-system,Segoe UI,Roboto,Arial,sans-serif";
const siteAddress = (s: DispatchContext["site"]) => [s?.address, [s?.city, s?.state].filter(Boolean).join(", "), s?.zip].filter(Boolean).join(" ");

function shell(opts: { eyebrow: string; title: string; intro?: string; body?: string; button?: { label: string; url: string }; footer?: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#fff;border-radius:12px;padding:24px;font:14px/21px ${FONT};color:#334155">
<tr><td style="font-weight:600;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#2c58c4">${esc(opts.eyebrow)}</td></tr>
<tr><td style="padding-top:6px;font-weight:600;font-size:20px;line-height:28px;color:#0f172a">${esc(opts.title)}</td></tr>
${opts.intro ? `<tr><td style="padding-top:8px">${opts.intro}</td></tr>` : ""}
${opts.body ? `<tr><td style="padding-top:16px">${opts.body}</td></tr>` : ""}
${opts.button ? `<tr><td style="padding-top:20px"><a href="${opts.button.url}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#2c58c4;color:#fff;font-weight:600;font-size:15px;text-decoration:none">${esc(opts.button.label)}</a></td></tr>` : ""}
<tr><td style="padding-top:20px;border-top:1px solid #e2e8f0;margin-top:20px;font-size:12px;line-height:18px;color:#94a3b8">${opts.footer ?? "Sent by MaintainOS."}</td></tr>
</table></td></tr></table></body></html>`;
}

function detailTable(rows: [string, string | null | undefined][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px">${rows
    .filter(([, v]) => v)
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:8px 12px;width:150px;vertical-align:top;color:#64748b;font-size:13px;${i ? "border-top:1px solid #f1f5f9;" : ""}">${esc(k)}</td><td style="padding:8px 12px;vertical-align:top;color:#0f172a;${i ? "border-top:1px solid #f1f5f9;" : ""}">${v}</td></tr>`,
    )
    .join("")}</table>`;
}

const vendorFooter = (c: DispatchContext) =>
  (replyAddress(c.dispatch.id, c.wo.number) ? "Questions? Just reply to this email. Your reply (and any photos) is added to the work order. " : "") +
  `This link is unique to ${esc(c.vendor.name)} for work order #${c.wo.number}. Please don't forward it. It works until ${fmtDate(c.dispatch.token_expires_at)}; if it expires you can request a new one from the page.`;

// ------------------------------------------------------------------ vendor emails

export type VendorEmailKind = "assigned" | "updated" | "approval_decision" | "invoice_decision" | "message" | "reminder" | "new_link" | "sent_back";

export async function emailVendor(
  c: DispatchContext,
  kind: VendorEmailKind,
  link: string | null, // portal URL with token (only available when we just generated it)
  extra: { note?: string | null; decision?: string; amount?: number | null; invoiceNumber?: string; attachments?: EmailAttachment[]; reminderReason?: string } = {},
): Promise<EmailResult> {
  const n = c.wo.number;
  const loc = `${c.site?.name ?? ""}${c.site?.code ? ` (Store ${c.site.code})` : ""}`;
  const hi = c.dispatch.contact_name ? `Hi ${esc(c.dispatch.contact_name.split(" ")[0])},` : "Hello,";
  const button = link ? { label: "View Work Order", url: link } : undefined;
  const linkNote = link ? "" : `<p style="margin:12px 0 0;color:#64748b">Use the “View Work Order” link from your original email to respond.</p>`;

  let subject = "";
  let title = "";
  let intro = "";
  let body = "";

  if (kind === "assigned" || kind === "new_link" || kind === "updated") {
    subject =
      kind === "assigned"
        ? `New work order #${n} — ${c.wo.title} — ${loc}`
        : kind === "updated"
          ? `Updated: work order #${n} — ${c.wo.title}`
          : `Your new link for work order #${n}`;
    title = kind === "assigned" ? `Work order #${n}: ${c.wo.title}` : kind === "updated" ? `Work order #${n} was updated` : `New link for work order #${n}`;
    intro =
      kind === "assigned"
        ? `${hi}<br>${esc(c.vendor.name)} has been assigned a work order. Please review it and accept or decline using the button below.`
        : kind === "updated"
          ? `${hi}<br>The details of this work order have changed. The current version is below.${extra.note ? `<br><br><b>Note:</b> ${esc(extra.note)}` : ""}`
          : `${hi}<br>Here is a fresh link to work order #${n}. Any earlier link has been turned off.`;
    const map = siteAddress(c.site) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(siteAddress(c.site))}` : null;
    body =
      detailTable([
        ["Work order", `#${n}`],
        ["Priority", `<b>${PRIORITY_LABEL[c.wo.priority]}</b>`],
        ["Location", esc(loc)],
        ["Address", siteAddress(c.site) ? (map ? `<a href="${map}" style="color:#2c58c4">${esc(siteAddress(c.site))}</a>` : esc(siteAddress(c.site))) : null],
        ["Store phone", c.site?.phone ? esc(c.site.phone) : null],
        ["Equipment", c.asset ? esc([c.asset.name, c.asset.manufacturer, c.asset.model].filter(Boolean).join(" · ")) : null],
        ["Where", c.wo.location_detail ? esc(c.wo.location_detail) : null],
        ["Requested by", c.dispatch.requested_by ? fmtDate(c.dispatch.requested_by) : null],
        ["Not to exceed", c.wo.nte_amount != null ? fmtMoney(c.wo.nte_amount, 2) : null],
        ["Issue", c.wo.description ? esc(c.wo.description).replace(/\n/g, "<br>") : esc(c.wo.title)],
        ["Special instructions", c.dispatch.instructions ? esc(c.dispatch.instructions).replace(/\n/g, "<br>") : null],
      ]) +
      (extra.attachments?.length
        ? `<p style="margin:12px 0 0;color:#64748b;font-size:13px">📎 ${extra.attachments.length} photo/attachment${extra.attachments.length > 1 ? "s" : ""} attached. All photos are also on the work order page.</p>`
        : "") +
      linkNote;
  } else if (kind === "approval_decision") {
    const ok = extra.decision === "approved";
    subject = `${ok ? "Approved" : "Not approved"}: additional work on #${n}`;
    title = ok ? `Additional work approved — #${n}` : `Additional work not approved — #${n}`;
    intro = `${hi}<br>Your request${extra.amount != null ? ` (${fmtMoney(extra.amount, 2)})` : ""} for work order #${n} was <b>${ok ? "approved" : "not approved"}</b>.${extra.note ? `<br><br><b>Note:</b> ${esc(extra.note)}` : ""}${ok ? "<br><br>You can proceed." : ""}`;
    body = linkNote;
  } else if (kind === "invoice_decision") {
    const map: Record<string, [string, string]> = {
      approved: ["approved", "Your invoice has been approved for payment."],
      rejected: ["needs revision", "Please review the note below and submit a revised invoice from the work order page."],
      paid: ["paid", "Payment has been recorded for your invoice."],
      under_review: ["under review", "We're reviewing your invoice."],
    };
    const [word, line] = map[extra.decision ?? "approved"] ?? map.approved;
    subject = `Invoice ${extra.invoiceNumber ? `${extra.invoiceNumber} ` : ""}${word} — work order #${n}`;
    title = `Invoice ${word} — #${n}`;
    intro = `${hi}<br>${line}${extra.amount != null ? `<br>Amount: <b>${fmtMoney(extra.amount, 2)}</b>` : ""}${extra.note ? `<br><br><b>Note:</b> ${esc(extra.note)}` : ""}`;
    body = linkNote;
  } else if (kind === "message" || kind === "sent_back") {
    subject = kind === "sent_back" ? `Follow-up needed on work order #${n}` : `Message about work order #${n}`;
    title = kind === "sent_back" ? `Work order #${n} needs follow-up` : `New message — work order #${n}`;
    intro = `${hi}<br>${kind === "sent_back" ? "Our team reviewed the completed work and it needs follow-up before we can close it." : "You have a new message about this work order:"}<br><br><div style="padding:12px;background:#f8fafc;border-radius:8px;color:#0f172a">${esc(extra.note ?? "").replace(/\n/g, "<br>")}</div>`;
    body = linkNote;
  } else if (kind === "reminder") {
    subject = `Reminder: work order #${n} — ${c.wo.title}`;
    title = `Reminder — work order #${n}`;
    intro = `${hi}<br>${esc(extra.reminderReason ?? "This work order is still open.")}`;
    body = linkNote;
  }

  const text = `${title}\n\n${intro.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")}\n\nLocation: ${loc}\n${siteAddress(c.site)}\n${link ? `\nView work order: ${link}\n` : ""}`;
  return sendEmail({
    to: c.dispatch.contact_email,
    subject,
    html: shell({ eyebrow: "Work order", title, intro, body, button, footer: vendorFooter(c) }),
    text,
    attachments: extra.attachments,
    replyTo: replyAddress(c.dispatch.id, c.wo.number) ?? (process.env.EMAIL_REPLY_TO || undefined),
  });
}

// ------------------------------------------------------------------ management emails

export type MgmtEventKind = "accepted" | "declined" | "started" | "update" | "approval_requested" | "completed" | "invoice" | "link_requested" | "email_reply" | "unverified_email";

export async function notifyManagement(
  db: SupabaseClient,
  c: DispatchContext,
  kind: MgmtEventKind,
  actor: string,
  detail: { note?: string | null; amount?: number | null; invoiceNumber?: string | null } = {},
) {
  const recipients = await managementRecipients(db, c.dispatch.created_by);
  if (!recipients.length) return { ok: false as const, error: "No recipients" };
  const n = c.wo.number;
  const who = kind === "unverified_email" ? actor : `${actor} (${c.vendor.name})`;
  const verb: Record<MgmtEventKind, string> = {
    accepted: "accepted",
    declined: "DECLINED",
    started: "started work on",
    update: "posted an update on",
    approval_requested: "is requesting approval on",
    completed: "marked work complete on",
    invoice: "submitted an invoice for",
    link_requested: "requested a new link for",
    email_reply: "replied by email on",
    unverified_email: "(not the assigned vendor) emailed about",
  };
  const subject = `[WO #${n}] ${c.vendor.name} ${verb[kind]} — ${c.wo.title}`;
  const lines = [
    detail.amount != null ? `<b>Amount:</b> ${fmtMoney(detail.amount, 2)}` : "",
    detail.invoiceNumber ? `<b>Invoice #:</b> ${esc(detail.invoiceNumber)}` : "",
    detail.note ? `<div style="margin-top:8px;padding:12px;background:#f8fafc;border-radius:8px;color:#0f172a">${esc(detail.note).replace(/\n/g, "<br>")}</div>` : "",
  ]
    .filter(Boolean)
    .join("<br>");
  const action =
    kind === "approval_requested" ? "Review the request" : kind === "completed" ? "Review completed work" : kind === "invoice" ? "Review invoice" : kind === "declined" ? "Reassign" : "Open work order";
  return sendEmail({
    to: recipients,
    replyTo: replyAddress(c.dispatch.id, c.wo.number, "internal") ?? undefined,
    subject,
    html: shell({
      eyebrow: `Vendor update · WO #${n}`,
      title: `${who} ${verb[kind]} #${n}`,
      intro: `${esc(c.wo.title)}<br><span style="color:#64748b">${esc(c.site?.name ?? "")}</span>${lines ? `<br><br>${lines}` : ""}`,
      button: { label: action, url: appUrl(`/work-orders/${c.wo.id}`) },
      footer: replyAddress(c.dispatch.id, c.wo.number, "internal")
        ? "Reply to this email to add an internal note to the work order (not visible to the vendor)."
        : undefined,
    }),
    text: `${who} ${verb[kind]} work order #${n} (${c.wo.title}).\n${detail.note ?? ""}\n${appUrl(`/work-orders/${c.wo.id}`)}`,
  });
}

/** Admins + whoever dispatched the job, plus VENDOR_NOTIFY_EMAILS (comma-separated). */
async function managementRecipients(db: SupabaseClient, createdBy: string | null) {
  const { data } = await db.from("profiles").select("id,email,role,active").or(`role.eq.admin${createdBy ? `,id.eq.${createdBy}` : ""}`);
  const emails = new Set(
    ((data ?? []) as { email: string | null; active: boolean }[]).filter((p) => p.active && p.email).map((p) => p.email!.toLowerCase()),
  );
  (process.env.VENDOR_NOTIFY_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .forEach((e) => emails.add(e));
  return [...emails];
}

/** Download a work order's shared photos/files (up to ~8 MB total) to attach to the dispatch email. */
export async function workOrderAttachmentsForEmail(db: SupabaseClient, workOrderId: string): Promise<EmailAttachment[]> {
  const { data } = await db
    .from("attachments")
    .select("storage_path,file_name,size_bytes")
    .eq("entity_type", "work_order")
    .eq("entity_id", workOrderId)
    .eq("visibility", "shared")
    .neq("category", "invoice")
    .order("created_at")
    .limit(10);
  const out: EmailAttachment[] = [];
  let total = 0;
  for (const a of (data ?? []) as { storage_path: string; file_name: string; size_bytes: number | null }[]) {
    if (total + (a.size_bytes ?? 0) > 8 * 1024 * 1024) break;
    const { data: blob } = await db.storage.from("attachments").download(a.storage_path);
    if (!blob) continue;
    const buf = Buffer.from(await blob.arrayBuffer());
    total += buf.length;
    out.push({ filename: a.file_name, content: buf.toString("base64") });
  }
  return out;
}
