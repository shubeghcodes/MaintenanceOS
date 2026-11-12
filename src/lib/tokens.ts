import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * Vendor links are derived, not stored: token = HMAC(secret, dispatchId:version).
 * Only sha256(token) is saved, so a database leak doesn't expose working links, yet the server
 * can re-create the current link for every email. Bumping `token_version` (renew/revoke) kills old links.
 * Set LINK_SIGNING_SECRET (any long random string). Changing it invalidates all outstanding links.
 */
export function linkSecret() {
  const s = process.env.LINK_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("LINK_SIGNING_SECRET is not set");
  return s;
}

export function linkTokenFor(dispatchId: string, version: number) {
  return createHmac("sha256", linkSecret()).update(`${dispatchId}:${version}`).digest("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function vendorLink(dispatchId: string, version: number) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/v/${linkTokenFor(dispatchId, version)}`;
}
