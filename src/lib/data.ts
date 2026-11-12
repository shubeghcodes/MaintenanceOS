import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset, Profile, Site, Vendor } from "./types";

/** Reference lists used by forms and filters. RLS limits sites/assets to what the viewer can see. */
export async function getLookups(supabase: SupabaseClient, opts: { assets?: boolean } = {}) {
  const [sites, vendors, techs, assets] = await Promise.all([
    supabase.from("sites").select("id,name,code,type").eq("active", true).order("name"),
    supabase.from("vendors").select("id,name,trades,phone").eq("active", true).order("name"),
    supabase.from("profiles").select("id,full_name,email,role").in("role", ["tech", "admin"]).eq("active", true).order("full_name"),
    opts.assets
      ? supabase.from("assets").select("id,name,tag,site_id,category").neq("status", "retired").order("name")
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
