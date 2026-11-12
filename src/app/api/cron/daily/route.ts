import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDaySchedules } from "@/lib/schedule-email";
import { sendVendorReminders } from "@/lib/vendor-reminders";
import { autoDispatchCompliance } from "@/lib/compliance-dispatch";
import { todayISO } from "@/lib/format";

/**
 * One morning job (fits hosting plans that allow a single daily cron):
 *  1. create due PM + compliance work orders
 *  2. email due compliance work orders to their vendors (secure link)
 *  3. email techs today's schedule
 *  4. nudge vendors with overdue responses / work / invoices
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const out: Record<string, unknown> = {};
  const gen = await db.rpc("generate_due_work_orders");
  out.generated = gen.error ? { error: gen.error.message } : gen.data;
  try {
    out.complianceEmails = await autoDispatchCompliance(db);
  } catch (e) {
    out.complianceEmails = { error: e instanceof Error ? e.message : "failed" };
  }
  try {
    out.schedules = (await sendDaySchedules(db, { date: todayISO(), onlyUnsent: true })).map((r) => ({ tech: r.name, status: r.status, error: r.error }));
  } catch (e) {
    out.schedules = { error: e instanceof Error ? e.message : "failed" };
  }
  try {
    out.vendorReminders = (await sendVendorReminders(db)).length;
  } catch (e) {
    out.vendorReminders = { error: e instanceof Error ? e.message : "failed" };
  }
  return NextResponse.json(out);
}
