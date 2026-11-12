"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";

type V = { id: string; name: string; trades: string[]; contact_name: string | null; email: string | null; phone: string | null; coi_expires_on: string | null };

/** Vendor select that pre-fills contact details, with a "new vendor" option. */
export function VendorContactFields({ vendors, defaultVendorId, suggestedTrade }: { vendors: V[]; defaultVendorId?: string | null; suggestedTrade?: string }) {
  const [vendorId, setVendorId] = useState(defaultVendorId ?? "");
  const v = vendors.find((x) => x.id === vendorId);
  const isNew = vendorId === "new";
  const coiExpired = v?.coi_expires_on && v.coi_expires_on < new Date().toISOString().slice(0, 10);

  // Sort vendors whose trade matches the job category to the top.
  const sorted = [...vendors].sort((a, b) => {
    const am = suggestedTrade && a.trades.some((t) => t.toLowerCase().includes(suggestedTrade.toLowerCase())) ? 0 : 1;
    const bm = suggestedTrade && b.trades.some((t) => t.toLowerCase().includes(suggestedTrade.toLowerCase())) ? 0 : 1;
    return am - bm || a.name.localeCompare(b.name);
  });

  return (
    <>
      <Field label="Vendor" className="sm:col-span-2">
        <Select name="vendor_id" required value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="" disabled>
            Select from your vendor directory…
          </option>
          {sorted.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.trades.length ? ` — ${x.trades.join(", ")}` : ""}
            </option>
          ))}
          <option value="new">+ New vendor (adds to directory)</option>
        </Select>
      </Field>
      {coiExpired && (
        <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900 ring-1 ring-orange-200 sm:col-span-2">
          Heads up: {v?.name}&rsquo;s certificate of insurance expired {v?.coi_expires_on}.
        </p>
      )}
      {isNew && (
        <>
          <Field label="Company name">
            <Input name="new_vendor_name" required />
          </Field>
          <Field label="Trade" hint="e.g. HVAC">
            <Input name="new_vendor_trade" defaultValue={suggestedTrade} />
          </Field>
        </>
      )}
      <div key={vendorId} className="contents">
        <Field label="Contact name">
          <Input name="contact_name" defaultValue={v?.contact_name ?? ""} />
        </Field>
        <Field label="Email (where the work order goes)">
          <Input name="contact_email" type="email" required defaultValue={v?.email ?? ""} placeholder="dispatch@vendor.com" />
        </Field>
        <Field label="Phone">
          <Input name="contact_phone" defaultValue={v?.phone ?? ""} />
        </Field>
        {v && (!v.email || !v.phone || !v.contact_name) && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-600">
            <input type="checkbox" name="save_contact" defaultChecked className="rounded border-slate-300" /> Save missing details to directory
          </label>
        )}
      </div>
    </>
  );
}
