"use client";

import { useState } from "react";

const HELP: Record<string, string> = {
  super_admin: "Everything, plus companies, admins, labor rates, deletes and paying invoices.",
  admin: "Runs operations for their companies: setup, dispatch, approvals, managers and techs.",
  manager: "Submits and tracks requests for their locations, and signs off on finished work.",
  tech: "Works tickets, logs time and costs, edits assets at their locations.",
  vendor: "Sees and updates only jobs sent to their company.",
};

const selectClass =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500";

/**
 * Role picker with a one-line description of the chosen role. Shows the vendor company only for vendor logins,
 * and the company-access checkboxes only when a super admin is setting up a (non-super) admin.
 */
export function RoleFields({
  options,
  defaultRole,
  vendors,
  defaultVendor,
  companies,
  selectedCompanies = [],
  canScopeCompanies,
}: {
  options: [string, string][];
  defaultRole: string;
  vendors: { id: string; name: string }[];
  defaultVendor?: string | null;
  companies: { id: string; name: string }[];
  selectedCompanies?: string[];
  canScopeCompanies: boolean;
}) {
  const [role, setRole] = useState(defaultRole);
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Role</span>
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={selectClass}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <span className="mt-1.5 block text-xs text-slate-500">{HELP[role]}</span>
      </label>

      {role === "vendor" && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Vendor company</span>
          <select name="vendor_id" defaultValue={defaultVendor ?? ""} required className={selectClass}>
            <option value="">Choose the vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {canScopeCompanies && role === "admin" && companies.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Companies this admin manages</legend>
          <div className="flex flex-wrap gap-2">
            {companies.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-slate-200 has-[:checked]:bg-brand-50 has-[:checked]:ring-brand-500"
              >
                <input type="checkbox" name="admin_company_ids" value={c.id} defaultChecked={selectedCompanies.includes(c.id)} className="rounded border-slate-300" />
                {c.name}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">Leave all unticked for every company. Super admins always see everything.</p>
        </fieldset>
      )}
    </div>
  );
}
