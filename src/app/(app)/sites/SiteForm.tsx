import { SITE_TYPE_LABEL } from "@/lib/constants";
import type { Site } from "@/lib/types";
import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { saveSite } from "./actions";

export function SiteForm({ site }: { site?: Site }) {
  return (
    <form action={saveSite}>
      {site && <input type="hidden" name="id" value={site.id} />}
      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Name" className="sm:col-span-2">
          <Input name="name" required defaultValue={site?.name} placeholder="e.g. Del Taco #101 – Fullerton" />
        </Field>
        <Field label="Code" hint="Short ID shown in lists">
          <Input name="code" defaultValue={site?.code ?? ""} placeholder="DT-101" />
        </Field>
        <Field label="Type">
          <Select name="type" defaultValue={site?.type ?? "qsr"}>
            {Object.entries(SITE_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Brand / concept">
          <Input name="brand" defaultValue={site?.brand ?? ""} />
        </Field>
        <Field label="Address" className="sm:col-span-2 lg:col-span-3">
          <Input name="address" defaultValue={site?.address ?? ""} />
        </Field>
        <Field label="City">
          <Input name="city" defaultValue={site?.city ?? ""} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State">
            <Input name="state" maxLength={2} defaultValue={site?.state ?? ""} />
          </Field>
          <Field label="ZIP">
            <Input name="zip" defaultValue={site?.zip ?? ""} />
          </Field>
        </div>
        <Field label="Phone">
          <Input name="phone" defaultValue={site?.phone ?? ""} />
        </Field>
        <Field label="Sq ft">
          <Input name="sq_ft" inputMode="numeric" defaultValue={site?.sq_ft ?? ""} />
        </Field>
        <Field label="Notes" hint="Access codes, landlord contacts, shut-off locations…" className="sm:col-span-2 lg:col-span-4">
          <Textarea name="notes" defaultValue={site?.notes ?? ""} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={site?.active ?? true} className="rounded border-slate-300" />
          Active
        </label>
        <div className="sm:col-span-2 lg:col-span-4">
          <SubmitButton>{site ? "Save site" : "Add site"}</SubmitButton>
        </div>
      </Card>
    </form>
  );
}
