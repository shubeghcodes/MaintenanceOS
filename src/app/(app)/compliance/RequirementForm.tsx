import { CATEGORIES, FREQ_UNIT_LABEL } from "@/lib/constants";
import { addDaysISO, todayISO } from "@/lib/format";
import type { ComplianceRequirement } from "@/lib/types";
import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { saveRequirement } from "./actions";

export function RequirementForm({
  req,
  sites,
  vendors,
  defaultSiteId,
}: {
  req?: ComplianceRequirement;
  sites: { id: string; name: string; code: string | null }[];
  vendors: { id: string; name: string }[];
  defaultSiteId?: string;
}) {
  return (
    <form action={saveRequirement}>
      {req && <input type="hidden" name="id" value={req.id} />}
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Requirement" className="sm:col-span-2">
          <Input name="name" required defaultValue={req?.name} placeholder="e.g. Fire suppression system inspection" />
        </Field>
        <Field label="Site">
          <Select name="site_id" required defaultValue={req?.site_id ?? defaultSiteId ?? ""}>
            <option value="" disabled>
              Select…
            </option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} · ` : ""}
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category">
          <Select name="category" defaultValue={req?.category ?? "Fire/Life Safety"}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Authority / standard" hint="Who requires it — e.g. NFPA 96, County Health">
          <Input name="authority" defaultValue={req?.authority ?? ""} />
        </Field>
        <Field label="Default vendor">
          <Select name="vendor_id" defaultValue={req?.vendor_id ?? ""}>
            <option value="">— None —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Every">
            <Input type="number" min={1} name="frequency_interval" defaultValue={req?.frequency_interval ?? 1} />
          </Field>
          <Field label="Unit">
            <Select name="frequency_unit" defaultValue={req?.frequency_unit ?? "year"}>
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
            <Input type="date" name="next_due_on" required defaultValue={req?.next_due_on ?? addDaysISO(todayISO(), 30)} />
          </Field>
          <Field label="Remind days before">
            <Input type="number" min={0} name="lead_days" defaultValue={req?.lead_days ?? 21} />
          </Field>
        </div>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea name="notes" defaultValue={req?.notes ?? ""} />
        </Field>
        <div className="flex flex-wrap gap-6 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="auto_create_wo" defaultChecked={req?.auto_create_wo ?? true} className="rounded border-slate-300" />
            Auto-create a work order when it comes due
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="auto_dispatch" defaultChecked={req?.auto_dispatch ?? true} className="rounded border-slate-300" />
            Automatically email it to the vendor
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={req?.active ?? true} className="rounded border-slate-300" />
            Active
          </label>
        </div>
        <div className="sm:col-span-2">
          <SubmitButton>{req ? "Save requirement" : "Add requirement"}</SubmitButton>
        </div>
      </Card>
    </form>
  );
}
