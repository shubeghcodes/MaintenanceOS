import { requireRole } from "@/lib/auth";
import { getLookups, getPickerLocations } from "@/lib/data";
import { fmtFreq, todayISO } from "@/lib/format";
import type { FreqUnit } from "@/lib/types";
import { Alert, Card, CardHeader, Field, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { LocationPicker } from "@/components/LocationPicker";
import { TechOptions } from "@/components/TechOptions";
import { rolloutTemplates } from "../../template-actions";

export const metadata = { title: "Roll out PM templates" };

type Tpl = { id: string; name: string; frequency_interval: number; frequency_unit: FreqUnit; items: { id: string }[] };

export default async function RolloutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin");
  const picked = new Set([sp.template ?? []].flat());
  const [{ data }, locations, lookups] = await Promise.all([
    supabase.from("pm_templates").select("id,name,frequency_interval,frequency_unit,items:pm_template_items(id)").eq("active", true).order("name"),
    getPickerLocations(supabase),
    getLookups(supabase),
  ]);
  const templates = (data ?? []) as unknown as Tpl[];
  const allPicked = picked.size === 0;

  return (
    <>
      <PageHeader title="Roll out to stores" back={{ href: "/pm/templates", label: "PM templates" }} />
      {typeof sp.error === "string" && <Alert>{sp.error}</Alert>}
      <form action={rolloutTemplates} className="space-y-6">
        <Card>
          <CardHeader title="1. Templates" subtitle="Each store gets one schedule per template, all due the same day so it's one trip." />
          <div className="grid gap-2 p-5 sm:grid-cols-2">
            {templates.map((t) => (
              <label key={t.id} className="flex items-start gap-2 rounded-lg p-2 ring-1 ring-slate-200 hover:bg-slate-50">
                <input type="checkbox" name="template_ids" value={t.id} defaultChecked={allPicked || picked.has(t.id)} className="mt-0.5 rounded border-slate-300" />
                <span className="text-sm">
                  <span className="font-medium text-slate-900">{t.name}</span>
                  <span className="block text-xs text-slate-500">
                    {fmtFreq(t.frequency_interval, t.frequency_unit)} · {t.items.length} activities
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="2. Stores" subtitle="Stores that already have a template are skipped for it, so it's safe to run again for new stores." />
          <div className="p-5">
            <LocationPicker sites={locations.sites} companies={locations.companies} />
          </div>
        </Card>

        <Card>
          <CardHeader title="3. First due dates" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Start on">
              <Input type="date" name="start_on" required defaultValue={todayISO()} />
            </Field>
            <Field label="Assign technician (optional)" hint="You can change it per store later.">
              <Select name="assigned_tech_id" defaultValue="">
                <option value="">— Unassigned —</option>
                <TechOptions techs={lookups.techs} />
              </Select>
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="spread" defaultChecked className="rounded border-slate-300" />
                Spread stores out evenly over the next
                <Input type="number" name="spread_weeks" min={1} max={52} defaultValue={13} className="w-20" />
                weeks
              </label>
              <p className="text-xs text-slate-500">
                13 weeks is one quarter. Stores are ordered by store # and given evenly spaced first due dates from the start date, so the
                workload is level. Each schedule then repeats on its own frequency from its first date. Unchecked, every store starts on the
                start date.
              </p>
            </div>
          </div>
        </Card>

        <SubmitButton>Create schedules</SubmitButton>
      </form>
    </>
  );
}
