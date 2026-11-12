import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDaySchedules } from "@/lib/schedule-email";
import { isISODate, todayISO } from "@/lib/format";

/**
 * Morning job: emails every tech their open jobs scheduled for today (company timezone).
 * Skips techs who were already sent today's schedule. Optional ?date=YYYY-MM-DD.
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET` (see vercel.json).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const param = new URL(request.url).searchParams.get("date");
  const date = isISODate(param) ? param : todayISO();
  try {
    const results = await sendDaySchedules(createAdminClient(), { date, onlyUnsent: true });
    return NextResponse.json({ date, results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
