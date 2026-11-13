import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getSession } from "./auth";

export const COMPANY_COOKIE = "mos_company";

export type Company = { id: string; name: string; legal_name: string | null; notes: string | null; active: boolean };

/**
 * The companies the viewer can pick from and the one currently selected.
 * `companyId` is null for "All companies" (and when the companies migration hasn't been run yet,
 * in which case `enabled` is false and nothing is filtered). Cached per request.
 */
export const getCompanyScope = cache(async () => {
  const { supabase, profile } = await getSession();
  const { data, error } = await supabase.from("companies").select("id,name,legal_name,notes,active").order("name");
  if (error) return { enabled: false, companies: [] as Company[], companyId: null as string | null, company: null as Company | null };

  const companies = (data ?? []) as Company[];
  const wanted = (await cookies()).get(COMPANY_COOKIE)?.value;
  const company = (wanted && wanted !== "all" && companies.find((c) => c.id === wanted)) || null;
  // Vendors work across companies through their dispatched jobs; never filter them.
  const companyId = profile.role === "vendor" ? null : company?.id ?? null;
  return { enabled: true, companies, companyId, company: companyId ? company : null };
});

/** Narrow a query to the selected company (no-op for "All companies"). */
export function inCompany<Q>(q: Q, companyId: string | null, column = "company_id"): Q {
  return companyId ? (q as unknown as { eq: (column: string, value: string) => Q }).eq(column, companyId) : q;
}

/** For tables tied to a work order (dispatches, invoices, approvals, receipts): select string to add, and the filter column. */
export const WO_COMPANY_JOIN = "wo_company:work_orders!inner(company_id)";
export const WO_COMPANY_COL = "wo_company.company_id";

/**
 * Work orders waiting on the viewer: admins → requests to approve; GMs → finished jobs to sign off.
 * Row security limits GMs to their own locations. Cached per request.
 */
export const getApprovalsWaiting = cache(async () => {
  const { supabase, profile } = await getSession();
  if (profile.role !== "admin" && profile.role !== "manager") return 0;
  const { companyId } = await getCompanyScope();
  const status = profile.role === "admin" ? "requested" : "awaiting_signoff";
  const { count } = await inCompany(supabase.from("work_orders").select("id", { count: "exact", head: true }).eq("status", status), companyId);
  return count ?? 0;
});

/** Receipts waiting for an admin's review in the selected company (0 for non-admins). Cached per request. */
export const getReceiptsToReview = cache(async () => {
  const { supabase, profile } = await getSession();
  if (profile.role !== "admin") return 0;
  const { companyId } = await getCompanyScope();
  const q = supabase.from("wo_purchases").select(companyId ? `id, ${WO_COMPANY_JOIN}` : "id", { count: "exact", head: true }).eq("status", "submitted");
  const { count } = await inCompany(q, companyId, WO_COMPANY_COL);
  return count ?? 0;
});
