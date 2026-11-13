import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPEN_STATUSES, PRIORITY_LABEL } from "./constants";
import { appUrl, esc, sendEmail } from "./email";
import { dayLabel, fmtTime } from "./format";
import type { WoPriority } from "./types";

type Job = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  priority: WoPriority;
  scheduled_start: string | null;
  estimated_hours: number | null;
  assigned_tech_id: string;
  location_detail: string | null;
  site: { name: string; code: string | null; address: string | null; city: string | null; state: string | null; phone: string | null } | null;
  asset: { name: string } | null;
};

export type ScheduleSendResult = {
  techId: string;
  name: string;
  email: string | null;
  jobs: number;
  status: "sent" | "failed" | "skipped";
  error?: string;
};

const PRIORITY_COLOR: Record<WoPriority, string> = { emergency: "#b91c1c", high: "#c2410c", medium: "#a16207", low: "#475569" };

/**
 * Email each tech their open jobs for `date`.
 * - techIds: limit to these techs (default: every tech with jobs that day)
 * - onlyUnsent: skip techs who already got a successful email for that date (used by the morning job)
 * The supabase client must be able to read all work orders (an admin session or the service role).
 */
export async function sendDaySchedules(
  supabase: SupabaseClient,
  opts: { date: string; techIds?: string[]; onlyUnsent?: boolean; sentBy?: string | null },
): Promise<ScheduleSendResult[]> {
  let q = supabase
    .from("work_orders")
    .select(
      "id,number,title,description,priority,scheduled_start,estimated_hours,assigned_tech_id,location_detail," +
        "site:sites(name,code,address,city,state,phone), asset:assets(name)",
    )
    .eq("scheduled_date", opts.date)
    .in("status", OPEN_STATUSES)
    .not("assigned_tech_id", "is", null)
    .order("scheduled_start", { ascending: true, nullsFirst: false });
  if (opts.techIds?.length) q = q.in("assigned_tech_id", opts.techIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as unknown as Job[];

  const techIds = opts.techIds?.length ? opts.techIds : [...new Set(jobs.map((j) => j.assigned_tech_id))];
  if (!techIds.length) return [];

  const [{ data: techs }, { data: already }] = await Promise.all([
    supabase.from("profiles").select("id,full_name,email,active").in("id", techIds),
    opts.onlyUnsent
      ? supabase.from("schedule_emails").select("tech_id").eq("schedule_date", opts.date).eq("status", "sent")
      : Promise.resolve({ data: [] as { tech_id: string }[] }),
  ]);
  const sentAlready = new Set((already ?? []).map((r) => r.tech_id));

  const results: ScheduleSendResult[] = [];
  for (const t of (techs ?? []) as { id: string; full_name: string | null; email: string | null; active: boolean }[]) {
    const mine = jobs.filter((j) => j.assigned_tech_id === t.id);
    const name = t.full_name || t.email || "Tech";
    const base = { techId: t.id, name, email: t.email, jobs: mine.length };

    if (!t.active || !t.email) {
      results.push({ ...base, status: "skipped", error: !t.email ? "No email on file" : "User inactive" });
      continue;
    }
    if (opts.onlyUnsent && sentAlready.has(t.id)) {
      results.push({ ...base, status: "skipped", error: "Already sent" });
      continue;
    }
    if (mine.length === 0) {
      results.push({ ...base, status: "skipped", error: "No jobs scheduled" });
      continue;
    }

    const { subject, html, text } = renderScheduleEmail(name, opts.date, mine);
    const res = await sendEmail({ to: t.email, subject, html, text });
    const status = res.ok ? "sent" : res.skipped ? "skipped" : "failed";
    results.push({ ...base, status, error: res.ok ? undefined : res.error });

    if (!(!res.ok && res.skipped)) {
      await supabase.from("schedule_emails").insert({
        tech_id: t.id,
        schedule_date: opts.date,
        job_count: mine.length,
        sent_to: t.email,
        sent_by: opts.sentBy ?? null,
        status,
        error: res.ok ? null : res.error,
      });
    }
  }
  return results;
}

function mapsLink(site: Job["site"]) {
  const addr = [site?.address, site?.city, site?.state].filter(Boolean).join(", ");
  return addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
}

export function renderScheduleEmail(techName: string, date: string, jobs: Job[]) {
  const first = techName.split(" ")[0];
  const day = dayLabel(date, "long");
  const hours = jobs.reduce((s, j) => s + Number(j.estimated_hours || 0), 0);
  const subject = `Your schedule for ${day} — ${jobs.length} job${jobs.length === 1 ? "" : "s"}`;
  const myDay = appUrl(`/my-day?date=${date}`);

  const rows = jobs
    .map((j, i) => {
      const url = appUrl(`/work-orders/${j.id}`);
      const map = mapsLink(j.site);
      const addr = [j.site?.address, j.site?.city].filter(Boolean).join(", ");
      return `
      <tr><td style="padding:14px 0;border-top:1px solid #e2e8f0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="76" valign="top" style="font:600 14px/20px -apple-system,Segoe UI,Arial,sans-serif;color:#0f172a">${esc(fmtTime(j.scheduled_start) || "Anytime")}</td>
          <td valign="top" style="font:14px/20px -apple-system,Segoe UI,Arial,sans-serif;color:#334155">
            <div style="font-size:12px;color:${PRIORITY_COLOR[j.priority]};font-weight:600">${i + 1}. ${PRIORITY_LABEL[j.priority].toUpperCase()} · #${j.number}</div>
            <div style="font-weight:600;color:#0f172a;font-size:15px">${esc(j.title)}</div>
            <div>${esc(j.site?.name)}${j.asset ? ` · ${esc(j.asset.name)}` : ""}${j.location_detail ? ` · ${esc(j.location_detail)}` : ""}</div>
            ${addr ? `<div>${map ? `<a href="${map}" style="color:#2c58c4">${esc(addr)}</a>` : esc(addr)}${j.site?.phone ? ` · ${esc(j.site.phone)}` : ""}</div>` : ""}
            ${j.estimated_hours ? `<div style="color:#64748b;font-size:12px">Est. ${j.estimated_hours} h</div>` : ""}
            <div style="margin-top:8px"><a href="${url}" style="display:inline-block;padding:7px 12px;border-radius:6px;background:#eef4ff;color:#24479e;font-weight:600;font-size:13px;text-decoration:none">Open job #${j.number} →</a></div>
          </td>
        </tr></table>
      </td></tr>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:24px">
      <tr><td style="font:600 13px -apple-system,Segoe UI,Arial,sans-serif;color:#2c58c4">MaintenanceOS</td></tr>
      <tr><td style="padding-top:8px;font:600 20px/28px -apple-system,Segoe UI,Arial,sans-serif;color:#0f172a">Good morning, ${esc(first)}</td></tr>
      <tr><td style="padding:4px 0 16px;font:14px/20px -apple-system,Segoe UI,Arial,sans-serif;color:#475569">
        ${esc(day)}: <b>${jobs.length} job${jobs.length === 1 ? "" : "s"}</b>${hours ? `, about ${hours} hours` : ""}.
      </td></tr>
      <tr><td style="padding-bottom:16px"><a href="${myDay}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2c58c4;color:#ffffff;font:600 14px -apple-system,Segoe UI,Arial,sans-serif;text-decoration:none">Open my day in the app</a></td></tr>
      ${rows}
      <tr><td style="padding-top:16px;border-top:1px solid #e2e8f0;font:12px/18px -apple-system,Segoe UI,Arial,sans-serif;color:#94a3b8">
        Update status, add photos and log costs from each job in the app. Schedule changes after this email are always current in the app.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    `Good morning, ${first}`,
    `${day}: ${jobs.length} job(s)${hours ? `, about ${hours} hours` : ""}`,
    `Open my day: ${myDay}`,
    "",
    ...jobs.map(
      (j, i) =>
        `${i + 1}. ${fmtTime(j.scheduled_start) || "Anytime"} — #${j.number} ${j.title} [${PRIORITY_LABEL[j.priority]}]\n` +
        `   ${j.site?.name ?? ""}${j.site?.address ? `, ${j.site.address}` : ""}\n` +
        `   ${appUrl(`/work-orders/${j.id}`)}`,
    ),
  ].join("\n");

  return { subject, html, text };
}
