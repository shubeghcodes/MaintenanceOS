import { getSession } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { CATEGORIES, PRIORITY_LABEL, PRIORITY_SLA, TYPE_LABEL } from "@/lib/constants";
import { personName } from "@/lib/format";
import { Alert, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SiteAssetPicker } from "@/components/SiteAssetPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { PhotoInput } from "@/components/PhotoInput";
import { redirect } from "next/navigation";
import { createWorkOrder } from "../actions";

export const metadata = { title: "New work order" };

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  if (profile.role === "vendor") redirect("/work-orders");
  const { sites, vendors, techs, assets } = await getLookups(supabase, { assets: true });
  const isStaff = profile.role === "admin" || profile.role === "tech";
  const isManager = profile.role === "manager";

  return (
    <>
      <PageHeader
        title={isManager ? "Submit a maintenance request" : "New work order"}
        subtitle={isManager ? "Describe the problem — maintenance will triage and assign it." : undefined}
        back={{ href: "/work-orders", label: "Work orders" }}
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sites.length === 0 && (
        <Alert tone="warning">You aren’t assigned to any sites yet. Ask an admin to add you to your location.</Alert>
      )}

      <form action={createWorkOrder} className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-4 p-5 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <SiteAssetPicker sites={sites} assets={assets} defaultSiteId={sp.site} defaultAssetId={sp.asset} />
          </div>
          <Field label="What’s the problem?">
            <Input name="title" required maxLength={140} placeholder="e.g. Walk-in cooler reading 45°F" />
          </Field>
          <Field label="Details" hint="When did it start? Anything already tried? Is it affecting service?">
            <Textarea name="description" rows={5} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Select name="category" defaultValue="Other">
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Where in the building?">
              <Input name="location_detail" placeholder="e.g. Back of house, men’s restroom" />
            </Field>
          </div>
          <Field label="Photos" hint="Images or PDFs, up to 10 MB each.">
            <PhotoInput name="files" />
          </Field>
        </Card>

        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">Priority</legend>
              <div className="space-y-2">
                {(Object.keys(PRIORITY_LABEL) as (keyof typeof PRIORITY_LABEL)[]).map((p) => (
                  <label key={p} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 ring-1 ring-slate-200 has-[:checked]:bg-brand-50 has-[:checked]:ring-brand-500">
                    <input type="radio" name="priority" value={p} defaultChecked={p === "medium"} className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">{PRIORITY_LABEL[p]}</span>
                      <span className="block text-xs text-slate-500">
                        Target: {PRIORITY_SLA[p]}
                        {p === "emergency" && " · safety, food safety, or can’t operate"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Card>

          {isStaff && (
            <Card className="space-y-4 p-5">
              <Field label="Type">
                <Select name="type" defaultValue="reactive">
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Assign technician">
                <Select name="assigned_tech_id" defaultValue="">
                  <option value="">— Unassigned —</option>
                  {techs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {personName(t)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Dispatch vendor">
                <Select name="vendor_id" defaultValue="">
                  <option value="">— None —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Schedule for">
                  <Input type="date" name="scheduled_date" />
                </Field>
                <Field label="Start time">
                  <Input type="time" name="scheduled_start" step={900} />
                </Field>
                <Field label="Est. hours">
                  <Input name="estimated_hours" inputMode="decimal" placeholder="1.5" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Due date" hint="Blank = SLA">
                  <Input type="date" name="due_date" />
                </Field>
                <Field label="NTE ($)">
                  <Input name="nte_amount" inputMode="decimal" placeholder="0" />
                </Field>
              </div>
            </Card>
          )}

          <SubmitButton pendingText="Submitting…">{isManager ? "Submit request" : "Create work order"}</SubmitButton>
        </div>
      </form>
    </>
  );
}
