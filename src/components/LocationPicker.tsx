"use client";

import { useMemo, useState } from "react";

type Site = { id: string; name: string; code: string | null; company_id: string | null; city?: string | null };
type Company = { id: string; name: string };

/**
 * Choose the locations a person can see. Grouped by company, with search and "select all" per company.
 * Submits one `site_ids` value per checked location.
 */
export function LocationPicker({ sites, companies, selected = [], name = "site_ids" }: { sites: Site[]; companies: Company[]; selected?: string[]; name?: string }) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected));
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (s: Site) => !term || [s.code, s.name, s.city].some((v) => v?.toLowerCase().includes(term));
    const byCompany = new Map<string, Site[]>();
    for (const s of sites) {
      if (!match(s)) continue;
      const k = s.company_id ?? "none";
      if (!byCompany.has(k)) byCompany.set(k, []);
      byCompany.get(k)!.push(s);
    }
    const named = companies.filter((c) => byCompany.has(c.id)).map((c) => ({ id: c.id, name: c.name, sites: byCompany.get(c.id)! }));
    if (byCompany.has("none")) named.push({ id: "none", name: "No company", sites: byCompany.get("none")! });
    return named;
  }, [sites, companies, q]);

  if (!sites.length) return <p className="text-sm text-slate-500">No locations yet. Add them on Sites first.</p>;

  const toggle = (ids: string[], on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  return (
    <div className="rounded-lg ring-1 ring-slate-200">
      {/* Hidden inputs carry every checked location, including ones filtered out by the search. */}
      {[...checked].map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search store #, name or city"
          className="min-w-[12rem] flex-1 rounded-md border-0 bg-slate-50 px-2.5 py-1.5 text-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-brand-500"
        />
        <span className="text-xs text-slate-500">
          {checked.size} of {sites.length} selected
        </span>
        {checked.size > 0 && (
          <button type="button" onClick={() => setChecked(new Set())} className="text-xs font-medium text-slate-500 hover:text-slate-800">
            Clear
          </button>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto">
        {groups.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">No locations match “{q}”.</p>}
        {groups.map((g) => {
          const ids = g.sites.map((s) => s.id);
          const all = ids.every((id) => checked.has(id));
          return (
            <div key={g.id} className="border-b border-slate-100 last:border-0">
              <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  {g.name} <span className="font-normal text-slate-500">· {ids.filter((id) => checked.has(id)).length}/{ids.length}</span>
                </span>
                <button type="button" onClick={() => toggle(ids, !all)} className="text-xs font-medium text-brand-700 hover:underline">
                  {all ? "Unselect all" : q ? "Select these" : "Select all"}
                </button>
              </div>
              <div className="grid gap-x-3 px-3 py-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {g.sites.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={checked.has(s.id)} onChange={(e) => toggle([s.id], e.target.checked)} className="rounded border-slate-300" />
                    <span className="min-w-0 truncate">
                      {s.code && <span className="font-mono text-xs text-slate-500">{s.code} </span>}
                      {s.name}
                      {s.city && <span className="text-xs text-slate-400"> · {s.city}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
