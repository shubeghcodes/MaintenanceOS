import { CATEGORIES, FREQ_UNIT_LABEL, PRIORITY_LABEL } from "@/lib/constants";
import { personName, todayISO } from "@/lib/format";
import type { PmSchedule } from "@/lib/types";
import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import { SiteAssetPicker } from "@/components/SiteAssetPicker";
import { SubmitButton } from "@/components/SubmitButton";
import type { getLookups } from "@/lib/data";
import { savePm } from "./actions";

export function PmForm({
  pm,
  lookups,
  defaults,
}: {
  pm?: PmSchedule;
  lookups: Awaited<ReturnType<typeof getLookups>>;
  defaults?: { site?: string; asset?: string };
}) {
  return (
    <form action={savePm}>
      {pm && <input type="hidden" name="id" value={pm.id} />}
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">
          <Input name="title" required defaultValue={pm?.title} placeholder="e.g. RTU filter change & belt check" />
        </Field>
        <SiteAssetPicker
          sites={lookups.sites}
          assets={lookups.assets}
          defaultSiteId={pm?.site_id ?? defaults?.site}
          defaultAssetId={pm?.asset_id ?? defaults?.asset}
          assetLabel="Asset (optional — leave blank for site-wide tasks)"
        />
        <Field label="Category">
          <Select name="category" defaultValue={pm?.category ?? "Other"}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select name="priority" defaultValue={pm?.priority ?? "medium"}>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Every">
            <Input type="number" min={1} name="frequency_interval" required defaultValue={pm?.frequency_interval ?? 1} />
          </Field>
          <Field label="Unit">
            <Select name="frequency_unit" defaultValue={pm?.frequency_unit ?? "month"}>
              {Object.entries(FREQ_UNIT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}(s)
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Next due">
            <Input type="date" name="next_due_on" required defaultValue={pm?.next_due_on ?? todayISO()} />
          </Field>
          <Field label="Create WO days before">
            <Input type="number" min={0} name="lead_days" defaultValue={pm?.lead_days ?? 7} />
          </Field>
        </div>
        <Field label="Assign technician">
          <Select name="assigned_tech_id" defaultValue={pm?.assigned_tech_id ?? ""}>
            <option value="">— Unassigned —</option>
            {lookups.techs.map((t) => (
              <option key={t.id} value={t.id}>
                {personName(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Or vendor">
          <Select name="vendor_id" defaultValue={pm?.vendor_id ?? ""}>
            <option value="">— None —</option>
            {lookups.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Instructions" className="sm:col-span-2">
          <Textarea name="instructions" rows={3} defaultValue={pm?.instructions ?? ""} />
        </Field>
        <Field label="Checklist" hint="One step per line — copied into each work order." className="sm:col-span-2">
          <Textarea name="checklist" rows={4} defaultValue={pm?.checklist.join("\n") ?? ""} />
        </Field>
        <Field label="Estimated hours">
          <Input name="estimated_hours" inputMode="decimal" defaultValue={pm?.estimated_hours ?? ""} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={pm?.active ?? true} className="rounded border-slate-300" />
          Active (generates work orders)
        </label>
        <div className="sm:col-span-2">
          <SubmitButton>{pm ? "Save schedule" : "Create schedule"}</SubmitButton>
        </div>
      </Card>
    </form>
  );
}
