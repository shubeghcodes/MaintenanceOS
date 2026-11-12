import "server-only";

export type EmailResult = { ok: true; id?: string } | { ok: false; error: string; skipped?: boolean };

/**
 * Sends email through Resend's HTTP API (https://resend.com — free tier covers a small team).
 * Set RESEND_API_KEY and EMAIL_FROM (a sender on a domain you've verified in Resend).
 * To use another provider, replace the body of this function; nothing else calls a provider directly.
 */
export type EmailAttachment = { filename: string; content: string /* base64 */ };

export async function sendEmail(msg: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, skipped: true, error: "Email isn't configured (set RESEND_API_KEY and EMAIL_FROM)" };

  try {
    const res = await fetch(`${resendApiBase()}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: Array.isArray(msg.to) ? msg.to : [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
        ...(msg.replyTo || process.env.EMAIL_REPLY_TO ? { reply_to: msg.replyTo ?? process.env.EMAIL_REPLY_TO } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: body.message ?? `Email provider returned ${res.status}` };
    return { ok: true, id: body.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Email send failed" };
  }
}

/** Resend API base. RESEND_API_BASE is only for testing against a mock server. */
export function resendApiBase() {
  return (process.env.RESEND_API_BASE || "https://api.resend.com").replace(/\/$/, "");
}

export function appUrl(path = "") {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  return base + path;
}

export const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
