import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInboundEmail, verifyWebhook } from "@/lib/inbound";

/**
 * Resend "email.received" webhook. Point a Resend webhook at
 *   https://YOUR-APP/api/inbound/email
 * and set RESEND_WEBHOOK_SECRET to its signing secret (whsec_...).
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Inbound email isn't configured" }, { status: 503 });
  const body = await request.text();
  if (!verifyWebhook(body, request.headers, secret)) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  try {
    const result = await processInboundEmail(createAdminClient(), event);
    return NextResponse.json(result);
  } catch (e) {
    // 500 → Resend retries later; the duplicate guard keeps retries safe.
    console.error("inbound email failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
