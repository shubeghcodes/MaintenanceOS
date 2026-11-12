import { ASSET_STATUS_LABEL, CATEGORIES } from "@/lib/constants";
import type { Asset } from "@/lib/types";
import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { saveAsset } from "./actions";

export function AssetForm({
  asset,
  sites,
  defaultSiteId,
}: {
  asset?: Asset;
  sites: { id: string; name: string; code: string | null }[];
  defaultSiteId?: string;
}) {
  return (
    <form action={saveAsset}>
      {asset && <input type="hidden" name="id" value={asset.id} />}
      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name" className="sm:col-span-2">
          <Input name="name" required defaultValue={asset?.name} placeholder="e.g. Walk-in Freezer" />
        </Field>
        <Field label="Asset tag" hint="Your label / barcode ID">
          <Input name="tag" defaultValue={asset?.tag ?? ""} />
        </Field>
        <Field label="Site">
          <Select name="site_id" required defaultValue={asset?.site_id ?? defaultSiteId ?? ""}>
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
          <Select name="category" defaultValue={asset?.category ?? "Other"}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={asset?.status ?? "operational"}>
            {Object.entries(ASSET_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Location in site">
          <Input name="location_detail" defaultValue={asset?.location_detail ?? ""} placeholder="e.g. Roof, BOH" />
        </Field>
        <Field label="Manufacturer">
          <Input name="manufacturer" defaultValue={asset?.manufacturer ?? ""} />
        </Field>
        <Field label="Model">
          <Input name="model" defaultValue={asset?.model ?? ""} />
        </Field>
        <Field label="Serial number">
          <Input name="serial_number" defaultValue={asset?.serial_number ?? ""} />
        </Field>
        <Field label="Install date">
          <Input type="date" name="install_date" defaultValue={asset?.install_date ?? ""} />
        </Field>
        <Field label="Warranty expires">
          <Input type="date" name="warranty_expires_on" defaultValue={asset?.warranty_expires_on ?? ""} />
        </Field>
        <Field label="Purchase cost ($)">
          <Input name="purchase_cost" inputMode="decimal" defaultValue={asset?.purchase_cost ?? ""} />
        </Field>
        <Field label="Expected life (years)">
          <Input name="expected_life_years" inputMode="numeric" defaultValue={asset?.expected_life_years ?? ""} />
        </Field>
        <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
          <Textarea name="notes" defaultValue={asset?.notes ?? ""} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <SubmitButton>{asset ? "Save changes" : "Add asset"}</SubmitButton>
        </div>
      </Card>
    </form>
  );
}
