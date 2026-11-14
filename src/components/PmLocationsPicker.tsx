"use client";

import { useState } from "react";
import { Field, Select } from "./ui";
import { LocationPicker } from "./LocationPicker";

type SiteOpt = { id: string; name: string; code: string | null; city: string | null; company_id: string | null };
type Company = { id: string; name: string };
type AssetOpt = { id: string; name: string; tag: string | null; site_id: string };

/**
 * For new PM schedules: pick one or many locations (one schedule is created per location).
 * An asset can only be chosen when exactly one location is picked; with several, each schedule is site-wide.
 */
export function PmLocationsPicker({
  sites,
  companies,
  assets,
  defaultSiteIds = [],
  defaultAssetId,
}: {
  sites: SiteOpt[];
  companies: Company[];
  assets: AssetOpt[];
  defaultSiteIds?: string[];
  defaultAssetId?: string | null;
}) {
  const [ids, setIds] = useState<string[]>(defaultSiteIds);
  const single = ids.length === 1 ? ids[0] : null;
  const siteAssets = single ? assets.filter((a) => a.site_id === single) : [];

  return (
    <>
      <div className="sm:col-span-2">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-slate-700">Locations</span>
          <span className="text-xs text-slate-500">
            {ids.length > 1
              ? `${ids.length} schedules will be created, one per location. Each can be edited on its own afterward.`
              : "Pick every location that gets this PM. Use Select all to cover a whole company."}
          </span>
        </div>
        <LocationPicker sites={sites} companies={companies} selected={defaultSiteIds} onChange={setIds} />
      </div>
      <Field
        label="Asset (optional)"
        hint={ids.length > 1 ? "Assets belong to one location, so schedules for several locations are site-wide." : "Leave blank for site-wide tasks."}
        className="sm:col-span-2"
      >
        <Select name="asset_id" defaultValue={defaultAssetId ?? ""} key={single ?? "none"} disabled={!single}>
          <option value="">{single ? "— None (site-wide) —" : ids.length ? "Site-wide at each location" : "Pick a location first"}</option>
          {siteAssets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.tag ? ` (${a.tag})` : ""}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
