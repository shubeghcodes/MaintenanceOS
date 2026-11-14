import Link from "next/link";
import { PAYMENT_LABEL, SHOP_LABEL, SUPPLY_CATEGORIES } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import { Field, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { PhotoInput } from "@/components/PhotoInput";
import { addSupplyPurchase } from "../actions";

/** The "Log a purchase" form for store supplies. */
export function SupplyForm({
  sites,
  shopCompanies,
  vendors,
  preset,
  back,
  clientKey: key,
}: {
  sites: { id: string; name: string; code: string | null }[];
  shopCompanies: { id: string; name: string }[];
  vendors: string[];
  preset: string;
  back: string;
  clientKey: string;
}) {
  const canShop = shopCompanies.length > 0;
  const self = back;
  return (
    <form action={addSupplyPurchase} className="grid gap-4 p-5 sm:grid-cols-2">
      <input type="hidden" name="client_key" value={key} />
      <input type="hidden" name="back" value={self} />
      <Field label="Receipt photo" className="sm:col-span-2">
        <PhotoInput name="receipt" multiple={false} capture="environment" accept="image/*,application/pdf" />
      </Field>
      <Field label="Location" className={canShop && shopCompanies.length > 1 ? "" : "sm:col-span-2"}>
        <Select name="site_id" required defaultValue={preset}>
          <option value="" disabled>
            Pick a location…
          </option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code ? `${s.code} · ${s.name}` : s.name}
            </option>
          ))}
          {canShop && <option value="shop">{SHOP_LABEL}</option>}
        </Select>
      </Field>
      {canShop &&
        (shopCompanies.length > 1 ? (
          <Field label="Company (shop / warehouse only)">
            <Select name="company_id" defaultValue="">
              <option value="">—</option>
              {shopCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="company_id" value={shopCompanies[0].id} />
        ))}
      <Field label="Vendor / store">
        <Input name="store" required list="supply-vendors" placeholder="Restaurant Depot" />
        <datalist id="supply-vendors">
          {vendors.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <Field label="Total paid ($)">
        <Input name="total" required inputMode="decimal" placeholder="0.00" />
      </Field>
      <Field label="Category">
        <Select name="category" defaultValue="Smallwares">
          {SUPPLY_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label="Date">
        <Input type="date" name="purchase_date" defaultValue={todayISO()} max={todayISO()} />
      </Field>
      <Field label="What was bought" className="sm:col-span-2">
        <Input name="description" placeholder="e.g. sheet pans, sanitizer buckets, to-go cups" />
      </Field>
      <Field label="Paid with">
        <Select name="payment_method" defaultValue="company_card">
          {Object.entries(PAYMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Card last 4 (company card)">
        <Input name="card_last4" inputMode="numeric" maxLength={4} placeholder="1234" />
      </Field>
      <details className="sm:col-span-2">
        <summary className="cursor-pointer text-xs text-slate-500">Add subtotal &amp; tax (optional)</summary>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label="Subtotal ($)">
            <Input name="subtotal" inputMode="decimal" />
          </Field>
          <Field label="Tax ($)">
            <Input name="tax" inputMode="decimal" />
          </Field>
        </div>
      </details>
      <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2">
        <input type="checkbox" name="no_receipt" className="rounded border-slate-300" /> No receipt available (explain in “What was bought”)
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <SubmitButton pendingText="Saving…">Save purchase</SubmitButton>
        <Link href="/purchases" className="text-sm text-slate-500 hover:text-slate-700">
          Cancel
        </Link>
      </div>
      <p className="text-xs text-slate-500 sm:col-span-2">Parts for a repair? Add the receipt on the work order instead, so it counts toward that job.</p>
    </form>  );
}
