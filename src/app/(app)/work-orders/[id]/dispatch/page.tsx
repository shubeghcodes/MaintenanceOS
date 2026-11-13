import { notFound } from "next/navigation";
import { Send } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { PRIORITY_LABEL, ACTIVE_DISPATCH } from "@/lib/constants";
import { addDaysISO, toDateInput, todayISO } from "@/lib/format";
import type { WorkOrder } from "@/lib/types";
import { Alert, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { VendorContactFields } from "./VendorContactFields";
import { dispatchToVendor } from "../../vendor-actions";

export const metadata = { title: "Assign to external vendor" };

export default async function DispatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireRole("admin", "tech");

  const [{ data }, { data: vData }, { count: fileCount }, { data: live }] = await Promise.all([
    supabase.from("work_orders").select("*, site:sites(name,code,address,city)").eq("id", id).maybeSingle(),
    supabase.from("vendors").select("id,name,trades,contact_name,email,phone,coi_expires_on").eq("active", true).order("name"),
    supabase.from("attachments").select("id", { count: "exact", head: true }).eq("entity_type", "work_order").eq("entity_id", id).eq("visibility", "shared"),
    supabase.from("vendor_dispatches").select("id,vendor:vendors(name)").eq("work_order_id", id).in("status", ACTIVE_DISPATCH).maybeSingle(),
  ]);
  if (!data) notFound();
  const wo = data as WorkOrder & { site: { name: string; code: string | null; address: string | null; city: string | null } | null };
  const vendors = (vData ?? []) as { id: string; name: string; trades: string[]; contact_name: string | null; email: string | null; phone: string | null; coi_expires_on: string | null }[];
  const liveVendor = (live as unknown as { vendor: { name: string } | null } | null)?.vendor?.name;
  const defaultDate = wo.due_at ? toDateInput(wo.due_at) : addDaysISO(todayISO(), wo.priority === "emergency" ? 0 : wo.priority === "high" ? 1 : 3);

  return (
    <>
      <PageHeader
        title="Assign to external vendor"
        subtitle={`#${wo.number} ${wo.title} · ${wo.site?.name ?? ""}`}
        back={{ href: `/work-orders/${id}`, label: `Work order #${wo.number}` }}
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {liveVendor && <Alert tone="warning">This job is currently with {liveVendor}. Sending it to a vendor now revokes their link.</Alert>}

      <form action={dispatchToVendor} className="grid gap-6 lg:grid-cols-3">
        <input type="hidden" name="work_order_id" value={id} />
        <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:col-span-2">
          <VendorContactFields vendors={vendors} defaultVendorId={wo.vendor_id} suggestedTrade={wo.category} />
          <Field label="Special instructions for the vendor" hint="Access, contacts on site, hours, parking, what's already been tried…" className="sm:col-span-2">
            <Textarea name="instructions" rows={4} placeholder="e.g. Check in with the shift manager. Roof access ladder is behind the building. Unit is RTU #1 over the dining room." />
          </Field>
        </Card>

        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <Field label="Priority">
              <Select name="priority" defaultValue={wo.priority}>
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Requested completion date">
              <Input type="date" name="requested_by" defaultValue={defaultDate} />
            </Field>
            <Field label="Not-to-exceed ($)" hint="Vendor must request approval above this.">
              <Input name="nte_amount" inputMode="decimal" defaultValue={wo.nte_amount ?? ""} />
            </Field>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" name="quote_required" className="mt-0.5 rounded border-slate-300" />
              <span>
                Require a quote before work starts
                <span className="block text-xs text-slate-500">The vendor can accept, but can&apos;t start until you approve their quote.</span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="include_files" defaultChecked={(fileCount ?? 0) > 0} disabled={!fileCount} className="rounded border-slate-300" />
              Attach photos &amp; files ({fileCount ?? 0})
            </label>
          </Card>
          <SubmitButton pendingText="Sending…">
            <Send className="h-4 w-4" aria-hidden /> Send work order to vendor
          </SubmitButton>
          <p className="text-xs text-slate-500">
            The vendor gets an email with the job details and a secure “View Work Order” link. No account is needed. You can revoke the link at any time.
          </p>
        </div>
      </form>
    </>
  );
}
