import Link from "next/link";
import clsx from "clsx";
import { ChevronRight, FileSpreadsheet, Search, UserPlus } from "lucide-react";
import { isSuper, requireRole } from "@/lib/auth";
import { fmtMoney, personName } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/constants";
import type { Profile } from "@/lib/types";
import { Alert, Badge, ButtonLink, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { addSiteMember, inviteUser, removeSiteMember } from "./actions";
import { loadUsersData, RoleBadge, roleKey } from "./shared";

export const metadata = { title: "Users" };

type Filter = "all" | "admin" | "manager" | "tech" | "vendor" | "inactive";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["admin", "Admins"],
  ["manager", "GMs"],
  ["tech", "Techs"],
  ["vendor", "Vendors"],
  ["inactive", "Inactive"],
];
const ROLE_ORDER = { super_admin: 0, admin: 1, tech: 2, manager: 3, vendor: 4 } as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile: me } = await requireRole("admin");
  const d = await loadUsersData(supabase);
  const superMe = isSuper(me);
  const view = sp.view === "sites" || sp.site ? "sites" : "users";
  const siteById = new Map(d.locations.map((l) => [l.id, l]));

  const filter: Filter = FILTERS.some(([k]) => k === sp.role) ? (sp.role as Filter) : "all";
  const q = (sp.q ?? "").trim().toLowerCase();
  const company = sp.company ?? "";

  const codesOf = (u: Profile) => d.sitesOf(u.id).map((id) => siteById.get(id)?.code ?? siteById.get(id)?.name ?? "").filter(Boolean);
  const inCompany = (u: Profile) => {
    if (!company) return true;
    if (u.role === "admin") return isSuper(u) || !d.scopeOf(u.id).length || d.scopeOf(u.id).includes(company);
    return d.sitesOf(u.id).some((id) => siteById.get(id)?.company_id === company);
  };
  const matches = (u: Profile) =>
    !q ||
    [u.full_name, u.email, u.phone, ...codesOf(u)].some((v) => (v ?? "").toLowerCase().includes(q));

  const base = d.users.filter(inCompany);
  const count = (f: Filter) => base.filter((u) => (f === "all" ? u.active : f === "inactive" ? !u.active : u.active && u.role === f)).length;
  const rows = base
    .filter((u) => (filter === "inactive" ? !u.active : u.active && (filter === "all" || u.role === filter)))
    .filter(matches)
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) || ROLE_ORDER[roleKey(a)] - ROLE_ORDER[roleKey(b)] || personName(a).localeCompare(personName(b)),
    );

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const next = { role: filter === "all" ? undefined : filter, q: sp.q, company: company || undefined, ...patch };
    Object.entries(next).forEach(([k, v]) => v && p.set(k, v));
    const s = p.toString();
    return `/admin/users${s ? `?${s}` : ""}`;
  };

  const locationsLabel = (u: Profile) => {
    if (u.role === "vendor") return d.lookups.vendors.find((v) => v.id === u.vendor_id)?.name ?? <span className="text-orange-700">No vendor linked</span>;
    if (u.role === "admin") {
      const sc = d.scopeOf(u.id);
      return isSuper(u) || !sc.length ? <span className="text-slate-500">All companies</span> : sc.map((id) => d.companyName.get(id) ?? "—").join(", ");
    }
    const codes = codesOf(u);
    if (!codes.length) return <span className="text-orange-700">No locations</span>;
    return (
      <>
        {codes.slice(0, 3).map((c) => `#${c}`).join(", ")}
        {codes.length > 3 && <span className="text-slate-400"> +{codes.length - 3}</span>}
      </>
    );
  };

  const activeCount = d.users.filter((u) => u.active).length;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={`${activeCount} active ${activeCount === 1 ? "person" : "people"} across ${d.locations.length} locations`}
        actions={
          <>
            <ButtonLink href="/admin/users/import" variant="secondary">
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> Import
            </ButtonLink>
            <ButtonLink href="/admin/users/invite">
              <UserPlus className="h-4 w-4" aria-hidden /> Invite person
            </ButtonLink>
          </>
        }
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.invited && <Alert tone="good">Invite sent to {sp.invited}.</Alert>}
      {sp.added && <Alert tone="good">{sp.added} now has access.</Alert>}
      {sp.removed && <Alert tone="good">Removed from the location.</Alert>}
      {sp.saved && <Alert tone="good">User updated.</Alert>}

      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
        {(
          [
            ["users", "By person", "/admin/users"],
            ["sites", "By location", "/admin/users?view=sites"],
          ] as const
        ).map(([key, label, href]) => (
          <Link
            key={key}
            href={href}
            className={clsx("rounded-md px-3 py-1.5 font-medium", view === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
          >
            {label}
          </Link>
        ))}
      </div>

      {view === "sites" ? (
        <SitesView d={d} focusSite={sp.site} meId={me.id} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(([k, label]) => (
                <Link
                  key={k}
                  href={qs({ role: k === "all" ? undefined : k })}
                  className={clsx(
                    "rounded-full px-3 py-1 text-sm ring-1 ring-inset",
                    filter === k ? "bg-brand-50 font-medium text-brand-700 ring-brand-300" : "text-slate-600 ring-slate-200 hover:bg-slate-50",
                  )}
                >
                  {label} <span className="tabular-nums text-slate-400">{count(k)}</span>
                </Link>
              ))}
            </div>
            <form action="/admin/users" className="ml-auto flex w-full flex-wrap gap-2 sm:w-auto">
              {filter !== "all" && <input type="hidden" name="role" value={filter} />}
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
                <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, email or store #" className="pl-8" />
              </div>
              {d.scope.companies.length > 1 && (
                <Select name="company" defaultValue={company} className="w-auto">
                  <option value="">All companies</option>
                  {d.scope.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
              <button className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">Go</button>
            </form>
          </div>

          <Card className="overflow-hidden">
            {rows.length === 0 ? (
              <EmptyState title="No one matches.">
                <Link href="/admin/users" className="font-medium text-brand-700">
                  Clear filters
                </Link>
              </EmptyState>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5">Name</th>
                    <th className="px-3 py-2.5">Role</th>
                    <th className="hidden px-3 py-2.5 md:table-cell">Locations</th>
                    <th className="hidden px-3 py-2.5 lg:table-cell">Phone</th>
                    {superMe && <th className="hidden px-3 py-2.5 sm:table-cell">Rate</th>}
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((u) => {
                    const rate = d.currentRate(u.id);
                    const href = `/admin/users/${u.id}`;
                    return (
                      <tr key={u.id} className={clsx("group hover:bg-slate-50", !u.active && "text-slate-400")}>
                        <td className="px-5 py-3">
                          <Link href={href} className="block">
                            <span className={clsx("font-medium", u.active ? "text-slate-900" : "text-slate-500")}>
                              {personName(u)}
                              {u.id === me.id && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
                            </span>
                            <span className="block truncate text-xs text-slate-500">{u.email}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            <RoleBadge u={u} />
                            {!u.active && <Badge tone="muted">Inactive</Badge>}
                          </div>
                        </td>
                        <td className="hidden px-3 py-3 text-slate-700 md:table-cell">{locationsLabel(u)}</td>
                        <td className="hidden whitespace-nowrap px-3 py-3 text-slate-600 lg:table-cell">{u.phone ?? <span className="text-slate-300">—</span>}</td>
                        {superMe && (
                          <td className="hidden whitespace-nowrap px-3 py-3 tabular-nums sm:table-cell">
                            {u.role === "tech" || u.role === "admin" ? (
                              rate ? (
                                `${fmtMoney(rate.hourly_rate, 2)}/hr`
                              ) : (
                                <span className={u.role === "tech" ? "font-medium text-orange-700" : "text-slate-400"}>No rate</span>
                              )
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-5 py-3 text-right">
                          <Link href={href} className="inline-flex items-center gap-0.5 text-sm font-medium text-brand-700 group-hover:underline">
                            {superMe || u.role !== "admin" ? "Edit" : "View"} <ChevronRight className="h-4 w-4" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </>
  );
}

type Data = Awaited<ReturnType<typeof loadUsersData>>;

/** By location: one compact row per store (GMs and techs), or the full manage card for one store. */
function SitesView({ d, focusSite, meId }: { d: Data; focusSite?: string; meId: string }) {
  if (!d.locations.length) {
    return (
      <Card className="p-5 text-sm text-slate-600">
        No locations yet.{" "}
        <Link href="/sites/new" className="font-medium text-brand-700">
          Add a site
        </Link>{" "}
        first.
      </Card>
    );
  }
  const byId = new Map(d.users.map((u) => [u.id, u]));
  const teamOf = (siteId: string) =>
    d.members
      .filter((m) => m.site_id === siteId)
      .map((m) => byId.get(m.user_id))
      .filter((u): u is Profile => !!u && (u.role === "manager" || u.role === "tech"))
      .sort((a, b) => a.role.localeCompare(b.role) || personName(a).localeCompare(personName(b)));
  const names = (list: Profile[]) =>
    list.length ? list.map((u) => <span key={u.id} className={clsx(!u.active && "text-slate-400 line-through")}>{personName(u)}</span>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), []) : <span className="text-orange-700">None</span>;

  const site = focusSite ? d.locations.find((s) => s.id === focusSite) : null;
  if (site) return <ManageSite d={d} site={site} team={teamOf(site.id)} meId={meId} />;

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
          <tr>
            <th className="px-5 py-2.5">Location</th>
            <th className="px-3 py-2.5">GM</th>
            <th className="hidden px-3 py-2.5 md:table-cell">Techs</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {d.locations.map((s) => {
            const team = teamOf(s.id);
            return (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <span className="font-medium text-slate-900">{s.code ? `#${s.code}` : s.name}</span>
                  {s.code && <span className="block text-xs text-slate-500">{s.name}</span>}
                </td>
                <td className="px-3 py-3 text-slate-700">{names(team.filter((u) => u.role === "manager"))}</td>
                <td className="hidden px-3 py-3 text-slate-700 md:table-cell">{names(team.filter((u) => u.role === "tech"))}</td>
                <td className="px-5 py-3 text-right">
                  <Link href={`/admin/users?view=sites&site=${s.id}`} className="inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline">
                    Manage <ChevronRight className="h-4 w-4" aria-hidden />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function ManageSite({ d, site, team, meId }: { d: Data; site: Data["locations"][number]; team: Profile[]; meId: string }) {
  const back = `/admin/users?view=sites&site=${site.id}`;
  const teamIds = new Set(team.map((u) => u.id));
  const candidates = d.users.filter((u) => u.active && (u.role === "manager" || u.role === "tech") && !teamIds.has(u.id));
  const admins = d.users.filter((u) => u.role === "admin" && u.active);
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  return (
    <div className="space-y-4">
      <Link href="/admin/users?view=sites" className="text-sm text-slate-500 hover:text-slate-800">
        ← All locations
      </Link>
      <Card>
        <CardHeader
          title={site.code ? `#${site.code} · ${site.name}` : site.name}
          subtitle={`${team.length} ${team.length === 1 ? "person" : "people"} · admins see every location`}
          action={
            <Link href={`/sites/${site.id}`} className="text-xs font-medium text-brand-700">
              Site page →
            </Link>
          }
        />
        {team.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">No GMs or techs assigned yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {team.map((u) => (
              <li key={u.id} className={clsx("flex flex-wrap items-center gap-3 px-5 py-3", !u.active && "opacity-60")}>
                <Link href={`/admin/users/${u.id}`} className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    {personName(u)} {u.id === meId && <span className="text-xs font-normal text-slate-400">(you)</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {u.email}
                    {u.phone && ` · ${u.phone}`}
                  </p>
                </Link>
                <RoleBadge u={u} />
                {!u.active && <Badge tone="muted">Inactive</Badge>}
                <form action={removeSiteMember}>
                  <input type="hidden" name="site_id" value={site.id} />
                  <input type="hidden" name="user_id" value={u.id} />
                  <input type="hidden" name="back" value={back} />
                  <SubmitButton
                    size="sm"
                    variant="ghost"
                    pendingText="Removing…"
                    confirm={`Remove ${personName(u)} from ${site.code ?? site.name}? Their other locations stay as they are.`}
                  >
                    Remove
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-4 border-t border-slate-100 bg-slate-50/60 p-5 lg:grid-cols-2">
          <form action={addSiteMember} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="site_id" value={site.id} />
            <input type="hidden" name="back" value={back} />
            <div className="min-w-[14rem] flex-1">
              <Field label="Add an existing person">
                <Select name="user_id" defaultValue="" required disabled={!candidates.length}>
                  <option value="">{candidates.length ? "Choose a GM or tech…" : "Everyone is already here"}</option>
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {personName(u)} · {ROLE_LABEL[u.role]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <SubmitButton size="md" variant="secondary" pendingText="Adding…">
              Add
            </SubmitButton>
          </form>
          <details className="rounded-lg bg-white ring-1 ring-slate-200">
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-brand-700">+ Invite someone new to this location</summary>
            {!hasServiceKey ? (
              <p className="px-3 pb-3 text-xs text-slate-600">
                Set <code className="rounded bg-slate-100 px-1">SUPABASE_SERVICE_ROLE_KEY</code> to send invites from here.
              </p>
            ) : (
              <form action={inviteUser} className="grid gap-3 px-3 pb-3 sm:grid-cols-2">
                <input type="hidden" name="site_ids" value={site.id} />
                <input type="hidden" name="back" value={back} />
                <Field label="Email">
                  <Input type="email" name="email" required />
                </Field>
                <Field label="Name">
                  <Input name="full_name" />
                </Field>
                <Field label="Role">
                  <Select name="role" defaultValue="manager">
                    <option value="manager">{ROLE_LABEL.manager}</option>
                    <option value="tech">{ROLE_LABEL.tech}</option>
                  </Select>
                </Field>
                <div className="flex items-end">
                  <SubmitButton pendingText="Sending…">Send invite</SubmitButton>
                </div>
                <p className="text-xs text-slate-500 sm:col-span-2">If they already have a login, they’re just added to this location.</p>
              </form>
            )}
          </details>
        </div>
      </Card>
      {admins.length > 0 && <p className="text-xs text-slate-500">Admins see every location: {admins.map((a) => personName(a)).join(", ")}</p>}
    </div>
  );
}
