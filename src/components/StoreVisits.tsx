import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { asLocale } from "@/lib/i18n";

type Row = { id: string; kind: "enter" | "exit"; at: string; site: { name: string; code: string | null } | null };

/** "Store visits": arrived / left times for one person, last 30 days, newest first. Shows whatever the database lets this viewer see. */
export async function StoreVisits({ supabase, userId, lang }: { supabase: SupabaseClient; userId: string; lang?: string | null }) {
  const t = await getT();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await supabase
    .from("site_presence_events")
    .select("id,kind,at,site:sites(name,code)")
    .eq("user_id", userId)
    .gte("at", since)
    .order("at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];
  const locale = asLocale(lang);
  return (
    <Card>
      <CardHeader title={t("Store visits")} subtitle={t("Last 30 days, newest first.")} />
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">{t("No store visits logged yet.")}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-5 py-2.5">
              <span className="min-w-0">
                <span className={`font-medium ${r.kind === "enter" ? "text-emerald-700" : "text-slate-600"}`}>{r.kind === "enter" ? t("Arrived") : t("Left")}</span>{" "}
                <span className="text-slate-800">{r.site ? (r.site.code ? `#${r.site.code} ` : "") + r.site.name : "—"}</span>
              </span>
              <span className="text-xs tabular-nums text-slate-500">{fmtDateTime(r.at, locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
