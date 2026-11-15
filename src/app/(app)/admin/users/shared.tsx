import { isSuper } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { getCompanyScope } from "@/lib/company";
import { ROLE_LABEL } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import type { Profile, UserRole } from "@/lib/types";
import { Badge } from "@/components/ui";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Short label used in lists ("GM" reads better than the full manager label in a table). */
export const ROLE_SHORT: Record<UserRole | "super_admin", string> = {
  super_admin: "Super admin",
  admin: "Admin",
  manager: "GM",
  tech: "Tech",
  vendor: "Vendor",
};

export function roleKey(u: Pick<Profile, "role" | "is_super">): UserRole | "super_admin" {
  return isSuper(u) ? "super_admin" : u.role;
}

const ROLE_TONE = { super_admin: "info", admin: "info", manager: "neutral", tech: "good", vendor: "warning" } as const;

export function RoleBadge({ u }: { u: Pick<Profile, "role" | "is_super"> }) {
  const k = roleKey(u);
  return (
    <Badge tone={ROLE_TONE[k]} dot={false}>
      {ROLE_SHORT[k]}
    </Badge>
  );
}

/** Role choices: only super admins can make admins or super admins. */
export function roleOptions(superMe: boolean): [string, string][] {
  return [
    ...(superMe ? ([["super_admin", "Super admin"], ["admin", "Admin"]] as [string, string][]) : []),
    ["manager", ROLE_LABEL.manager],
    ["tech", ROLE_LABEL.tech],
    ["vendor", ROLE_LABEL.vendor],
  ];
}

export type Location = { id: string; name: string; code: string | null; city: string | null; company_id: string | null };
export type Rate = { id: string; user_id: string; hourly_rate: number; effective_from: string; note: string | null; created_at: string };

/** Everything the Users screens need, loaded once. */
export async function loadUsersData(supabase: SupabaseClient) {
  const [{ data: pData }, { data: mData }, lookups, { data: locData }, scope, { data: rData }, { data: acData }] = await Promise.all([
    supabase.from("profiles").select("*").order("active", { ascending: false }).order("role").order("full_name"),
    supabase.from("site_members").select("site_id,user_id"),
    getLookups(supabase, { allCompanies: true }),
    supabase.from("sites").select("id,name,code,city,company_id").eq("active", true).order("code", { nullsFirst: false }).order("name"),
    getCompanyScope(),
    // Hourly rates (admin only by row security). Newest first per person.
    supabase.from("tech_rates").select("id,user_id,hourly_rate,effective_from,note,created_at").order("effective_from", { ascending: false }),
    supabase.from("admin_companies").select("user_id,company_id"),
  ]);
  const users = (pData ?? []) as Profile[];
  const members = (mData ?? []) as { site_id: string; user_id: string }[];
  const locations = (locData ?? []) as Location[];
  const rates = (rData ?? []) as Rate[];
  const adminCompanies = (acData ?? []) as { user_id: string; company_id: string }[];
  const today = todayISO();
  // Selected company first in the location picker.
  const pickerCompanies = [...scope.companies].sort((a, b) => (a.id === scope.companyId ? -1 : b.id === scope.companyId ? 1 : 0));
  return {
    users,
    members,
    lookups,
    locations,
    scope,
    pickerCompanies,
    rates,
    today,
    companyName: new Map(scope.companies.map((c) => [c.id, c.name])),
    sitesOf: (uid: string) => members.filter((m) => m.user_id === uid).map((m) => m.site_id),
    scopeOf: (uid: string) => adminCompanies.filter((a) => a.user_id === uid).map((a) => a.company_id),
    ratesOf: (uid: string) => rates.filter((r) => r.user_id === uid),
    currentRate: (uid: string) => rates.find((r) => r.user_id === uid && r.effective_from <= today),
  };
}

export { FormSection as Section } from "@/components/FormSection";
