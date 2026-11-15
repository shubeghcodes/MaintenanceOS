import Link from "next/link";
import { SITE_TYPE_LABEL } from "@/lib/constants";
import type { Site } from "@/lib/types";
import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { FormFooter, FormSection } from "@/components/FormSection";
import { saveSite } from "./actions";

export function SiteForm({
  site,
  companies = [],
  defaultCompanyId,
}: {
  site?: Site & { company_id?: string };
  companies?: { id: string; name: string; active: boolean }[];
  defaultCompanyId?: string | null;
}) {
  const selectedCompany = site?.company_id ?? defaultCompanyId ?? companies.find((c) => c.active)?.id ?? "";
  return (
    <form action={saveSite}>
      {site && <input type="hidden" name="id" value={site.id} />}
      <Card>
        <FormSection title="Location" help="How this site shows up in lists, work orders and emails.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Store #" hint="Short ID shown in lists">
              <Input name="code" defaultValue={site?.code ?? ""} placeholder="101" />
            </Field>
            <Field label="Name" className="sm:col-span-2">
              <Input name="name" required defaultValue={site?.name} placeholder="Del Taco #101 – Fullerton" />
            </Field>
            <Field label="Type" hint="Sets the compliance checklist template">
              <Select name="type" defaultValue={site?.type ?? "qsr"}>
                {Object.entries(SITE_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Brand / concept" className="sm:col-span-2">
              <Input name="brand" defaultValue={site?.brand ?? ""} placeholder="Del Taco" />
            </Field>
          </div>
        </FormSection>

        {companies.length > 0 && (
          <FormSection
            title="Company"
            help={site ? "Moving a site moves its work orders, assets, PM and compliance with it." : "Which corporation owns this location."}
          >
            <Select name="company_id" defaultValue={selectedCompany} required>
              {companies
                .filter((c) => c.active || c.id === selectedCompany)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </FormSection>
        )}

        <FormSection title="Address and contact" help="Used for directions on My day and in vendor emails.">
          <div className="grid gap-4 sm:grid-cols-6">
            <Field label="Street address" className="sm:col-span-6">
              <Input name="address" defaultValue={site?.address ?? ""} />
            </Field>
            <Field label="City" className="sm:col-span-3">
              <Input name="city" defaultValue={site?.city ?? ""} />
            </Field>
            <Field label="State" className="sm:col-span-1">
              <Input name="state" maxLength={2} defaultValue={site?.state ?? ""} />
            </Field>
            <Field label="ZIP" className="sm:col-span-2">
              <Input name="zip" defaultValue={site?.zip ?? ""} />
            </Field>
            <Field label="Store phone" className="sm:col-span-3">
              <Input name="phone" defaultValue={site?.phone ?? ""} />
            </Field>
            <Field label="Sq ft" className="sm:col-span-3">
              <Input name="sq_ft" inputMode="numeric" defaultValue={site?.sq_ft ?? ""} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Notes" help="Access codes, landlord contacts, shut-off locations. Everyone at this location can see them.">
          <Textarea name="notes" rows={4} defaultValue={site?.notes ?? ""} />
        </FormSection>

        <FormSection title="Status" help="Inactive sites are hidden from lists and pickers. Their history stays.">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="active" defaultChecked={site?.active ?? true} className="rounded border-slate-300" />
            Active
          </label>
        </FormSection>

        <FormFooter>
          <Link href={site ? `/sites/${site.id}` : "/sites"} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </Link>
          <SubmitButton>{site ? "Save changes" : "Add site"}</SubmitButton>
        </FormFooter>
      </Card>
    </form>
  );
}
