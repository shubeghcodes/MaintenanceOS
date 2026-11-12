import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { linkSecret } from "./tokens";

/**
 * Reply addresses route an emailed reply back to the right work order:
 *   wo1023-<dispatch id>-<signature>@reply.yourcompany.com     → vendor conversation (shared with vendor)
 *   wo1023-<dispatch id>-<signature>-n@reply.yourcompany.com   → internal note (staff only)
 * The signature (HMAC with LINK_SIGNING_SECRET) means addresses can't be guessed or forged.
 */
export type ReplyKind = "vendor" | "internal";

export function replyDomain() {
  const d = process.env.REPLY_DOMAIN?.trim().toLowerCase();
  return d || null;
}

function sig(dispatchId: string, kind: ReplyKind) {
  return createHmac("sha256", linkSecret()).update(`reply:${kind}:${dispatchId}`).digest("hex").slice(0, 12);
}

export function replyAddress(dispatchId: string, woNumber: number, kind: ReplyKind = "vendor") {
  const domain = replyDomain();
  if (!domain) return null;
  return `wo${woNumber}-${dispatchId.replace(/-/g, "")}-${sig(dispatchId, kind)}${kind === "internal" ? "-n" : ""}@${domain}`;
}

/** Returns the dispatch + kind for a valid reply address, or null. Accepts "Name <addr>" too. */
export function parseReplyAddress(raw: string): { dispatchId: string; kind: ReplyKind } | null {
  const domain = replyDomain();
  if (!domain) return null;
  const addr = (/<([^>]+)>/.exec(raw)?.[1] ?? raw).trim().toLowerCase();
  const m = /^wo\d+-([0-9a-f]{32})-([0-9a-f]{12})(-n)?@(.+)$/.exec(addr);
  if (!m || m[4] !== domain) return null;
  const hex = m[1];
  const dispatchId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const kind: ReplyKind = m[3] ? "internal" : "vendor";
  const expected = Buffer.from(sig(dispatchId, kind));
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { dispatchId, kind };
}
