import type { Vendor } from "@/lib/types";
import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { saveVendor } from "./actions";

export function VendorForm({ vendor }: { vendor?: Vendor }) {
  return (
    <form action={saveVendor}>
      {vendor && <input type="hidden" name="id" value={vendor.id} />}
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Company name" className="sm:col-span-2">
          <Input name="name" required defaultValue={vendor?.name} />
        </Field>
        <Field label="Trades" hint="Comma-separated — e.g. HVAC, Refrigeration" className="sm:col-span-2">
          <Input name="trades" defaultValue={vendor?.trades.join(", ")} />
        </Field>
        <Field label="Contact name">
          <Input name="contact_name" defaultValue={vendor?.contact_name ?? ""} />
        </Field>
        <Field label="Email">
          <Input type="email" name="email" defaultValue={vendor?.email ?? ""} />
        </Field>
        <Field label="Phone">
          <Input name="phone" defaultValue={vendor?.phone ?? ""} />
        </Field>
        <Field label="After-hours / emergency">
          <Input name="after_hours_phone" defaultValue={vendor?.after_hours_phone ?? ""} />
        </Field>
        <Field label="License #">
          <Input name="license_number" defaultValue={vendor?.license_number ?? ""} />
        </Field>
        <Field label="COI expires" hint="Certificate of insurance">
          <Input type="date" name="coi_expires_on" defaultValue={vendor?.coi_expires_on ?? ""} />
        </Field>
        <Field label="Hourly rate ($)">
          <Input name="hourly_rate" inputMode="decimal" defaultValue={vendor?.hourly_rate ?? ""} />
        </Field>
        <Field label="Rating">
          <Select name="rating" defaultValue={vendor?.rating?.toString() ?? ""}>
            <option value="">—</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} / 5
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea name="notes" defaultValue={vendor?.notes ?? ""} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={vendor?.active ?? true} className="rounded border-slate-300" />
          Active
        </label>
        <div className="sm:col-span-2">
          <SubmitButton>{vendor ? "Save vendor" : "Add vendor"}</SubmitButton>
        </div>
      </Card>
    </form>
  );
}
