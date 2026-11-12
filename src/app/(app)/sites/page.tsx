import Link from "next/link";
import { MapPin, Plus } from "lucide-react";
import { getSession } from "@/lib/auth";
import { OPEN_STATUSES, SITE_TYPE_LABEL } from "@/lib/constants";
import { daysUntil, isOverdue } from "@/lib/format";
import type { Site } from "@/lib/types";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Sites" };

export default async function SitesPage() {
  const { supabase, profile } = await getSession();
  const [{ data: sData }, { data: woData }, { data: cData }, { data: aData }] = await Promise.all([
    supabase.from("sites").select("*").order("active", { ascending: false }).order("name"),
    supabase.from("work_orders").select("site_id,status,due_at").in("status", OPEN_STATUSES).limit(5000),
    supabase.from("compliance_requirements").select("site_id,next_due_on").eq("active", true),
    supabase.from("assets").select("site_id,status").neq("status", "retired"),
  ]);
  const sites = (sData ?? []) as Site[];
  const wos = (woData ?? []) as { site_id: string; status: string; due_at: string | null }[];
  const comp = (cData ?? []) as { site_id: string; next_due_on: string }[];
  const assets = (aData ?? []) as { site_id: string; status: string }[];

  return (
    <>
      <PageHeader
        title="Sites"
        subtitle={`${sites.length} location${sites.length === 1 ? "" : "s"}`}
        actions={
          profile.role === "admin" && (
            <ButtonLink href="/sites/new">
              <Plus className="h-4 w-4" aria-hidden /> Add site
            </ButtonLink>
          )
        }
      />
      {sites.length === 0 ? (
        <Card>
          <EmptyState title="No sites visible.">{profile.role === "admin" ? "Add your first location." : "Ask an admin to add you to your location."}</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sites.map((s) => {
            const open = wos.filter((w) => w.site_id === s.id);
            const overdue = open.filter((w) => isOverdue(w.due_at, w.status)).length;
            const compOver = comp.filter((c) => c.site_id === s.id && (daysUntil(c.next_due_on) ?? 0) < 0).length;
            const down = assets.filter((a) => a.site_id === s.id && a.status === "down").length;
            return (
              <Link key={s.id} href={`/sites/${s.id}`}>
                <Card className={`h-full p-5 transition hover:border-slate-300 hover:shadow ${s.active ? "" : "opacity-60"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs text-slate-400">{s.code}</p>
                      <p className="font-semibold text-slate-900">{s.name}</p>
                    </div>
                    <Badge dot={false}>{SITE_TYPE_LABEL[s.type]}</Badge>
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3 w-3" aria-hidden /> {[s.city, s.state].filter(Boolean).join(", ") || "—"}
                  </p>
                  <div className="mt-4 grid grid-cols-4 gap-2 border-t border-slate-100 pt-3 text-center">
                    <Metric label="Open" value={open.length} />
                    <Metric label="Overdue" value={overdue} bad={overdue > 0} />
                    <Metric label="Compl. due" value={compOver} bad={compOver > 0} />
                    <Metric label="Down" value={down} bad={down > 0} />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function Metric({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div>
      <p className={`text-lg font-semibold tabular-nums ${bad ? "text-red-700" : "text-slate-900"}`}>{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
