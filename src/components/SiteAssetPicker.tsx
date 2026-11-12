"use client";

import { useState } from "react";
import { Field, Select } from "./ui";

type SiteOpt = { id: string; name: string; code: string | null };
type AssetOpt = { id: string; name: string; tag: string | null; site_id: string };

/** Site dropdown that filters the asset dropdown to that site. */
export function SiteAssetPicker({
  sites,
  assets,
  defaultSiteId,
  defaultAssetId,
  assetLabel = "Asset (optional)",
  requireAsset = false,
}: {
  sites: SiteOpt[];
  assets: AssetOpt[];
  defaultSiteId?: string | null;
  defaultAssetId?: string | null;
  assetLabel?: string;
  requireAsset?: boolean;
}) {
  const [siteId, setSiteId] = useState(defaultSiteId ?? (sites.length === 1 ? sites[0].id : ""));
  const siteAssets = assets.filter((a) => a.site_id === siteId);

  return (
    <>
      <Field label="Site">
        <Select name="site_id" required value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="" disabled>
            Select a site…
          </option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code ? `${s.code} · ` : ""}
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={assetLabel}>
        <Select name="asset_id" defaultValue={defaultAssetId ?? ""} key={siteId} required={requireAsset} disabled={!siteId}>
          <option value="">{siteId ? (requireAsset ? "Select…" : "— None / not sure —") : "Pick a site first"}</option>
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
