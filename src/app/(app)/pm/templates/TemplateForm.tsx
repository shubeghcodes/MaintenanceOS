import { CATEGORIES, FREQ_UNIT_LABEL, PRIORITY_LABEL } from "@/lib/constants";
import { Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { saveTemplate } from "../template-actions";

export type TemplateRow = {
  id: string;
  name: string;
  category: string;
  instructions: string | null;
  frequency_interval: number;
  frequency_unit: string;
  priority: string;
  lead_days: number;
  estimated_hours: number | null;
  active: boolean;
};

export function TemplateForm({ tpl, scheduleCount = 0 }: { tpl?: TemplateRow; scheduleCount?: number }) {
  return (
    <Card>
      <CardHeader title={tpl ? "Template details" : "New template"} />
      <form action={saveTemplate} className="grid gap-4 p-5 sm:grid-cols-2">
        {tpl && <input type="hidden" name="id" value={tpl.id} />}
        <Field label="Name" className="sm:col-span-2" hint="Becomes the work order title, e.g. Quarterly PM – HVAC.">
          <Input name="name" required defaultValue={tpl?.name ?? ""} />
        </Field>
        <Field label="Category">
          <Select name="category" defaultValue={tpl?.category ?? "HVAC"}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select name="priority" defaultValue={tpl?.priority ?? "medium"}>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Every">
            <Input type="number" min={1} name="frequency_interval" required defaultValue={tpl?.frequency_interval ?? 3} />
          </Field>
          <Field label="Unit">
            <Select name="frequency_unit" defaultValue={tpl?.frequency_unit ?? "month"}>
              {Object.entries(FREQ_UNIT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}(s)
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Create WO days before">
            <Input type="number" min={0} name="lead_days" defaultValue={tpl?.lead_days ?? 7} />
          </Field>
          <Field label="Est. hours">
            <Input type="number" min={0} step="0.25" name="estimated_hours" defaultValue={tpl?.estimated_hours ?? ""} />
          </Field>
        </div>
        <Field label="Instructions" className="sm:col-span-2" hint="General notes shown on every work order (e.g. safety, roof access).">
          <Textarea name="instructions" rows={3} defaultValue={tpl?.instructions ?? ""} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="active" defaultChecked={tpl?.active ?? true} className="rounded border-slate-300" /> Active (uncheck to archive)
        </label>
        {tpl && scheduleCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="sync" defaultChecked className="rounded border-slate-300" />
            Also update the {scheduleCount} store schedule{scheduleCount > 1 ? "s" : ""} made from this template
          </label>
        )}
        <div className="sm:col-span-2">
          <SubmitButton>{tpl ? "Save template" : "Create template"}</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
