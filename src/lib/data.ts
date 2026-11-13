import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset, Profile, Site, Vendor } from "./types";
import { getCompanyScope, inCompany } from "./company";

/** Reference lists used by forms and filters. RLS limits sites/assets to what the viewer can see. */
export async function getLookups(supabase: SupabaseClient, opts: { assets?: boolean; allCompanies?: boolean } = {}) {
  // Sites and assets follow the selected company, so pickers only offer that company's locations.
  // Edit pages pass allCompanies so a record's current site is always in the list.
  const cid = opts.allCompanies ? null : (await getCompanyScope()).companyId;
  const [sites, vendors, techs, assets] = await Promise.all([
    inCompany(supabase.from("sites").select("id,name,code,type").eq("active", true), cid).order("name"),
    supabase.from("vendors").select("id,name,trades,phone").eq("active", true).order("name"),
    supabase.from("profiles").select("id,full_name,email,role").in("role", ["tech", "admin"]).eq("active", true).order("full_name"),
    opts.assets
      ? inCompany(supabase.from("assets").select("id,name,tag,site_id,category").neq("status", "retired"), cid).order("name")
      : Promise.resolve({ data: [] }),
  ]);
  return {
    sites: (sites.data ?? []) as Pick<Site, "id" | "name" | "code" | "type">[],
    vendors: (vendors.data ?? []) as Pick<Vendor, "id" | "name" | "trades" | "phone">[],
    techs: (techs.data ?? []) as Pick<Profile, "id" | "full_name" | "email" | "role">[],
    assets: (assets.data ?? []) as Pick<Asset, "id" | "name" | "tag" | "site_id" | "category">[],
  };
}

export function byId<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((r) => [r.id, r]));
}
