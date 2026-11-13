import { requireRole } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { ROLE_LABEL } from "@/lib/constants";
import { personName } from "@/lib/format";
import type { Profile, UserRole } from "@/lib/types";
import Link from "next/link";
import clsx from "clsx";
import { Alert, Badge, Card, CardHeader, Field, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { LocationPicker } from "@/components/LocationPicker";
import { getCompanyScope } from "@/lib/company";
import { addSiteMember, inviteUser, removeSiteMember, setLaborRate, updateUser } from "./actions";
import { fmtDate, fmtMoney, todayISO } from "@/lib/format";

export const metadata = { title: "Users" };

const ROLE_HELP: Record<UserRole, string> = {
  admin: "Everything: setup, all sites, scheduler, users.",
  manager: "Submits and tracks requests for their sites.",
  tech: "Works tickets, logs costs, edits assets at their sites.",
  vendor: "Sees and updates only jobs dispatched to their company.",
};

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile: me } = await requireRole("admin");
  const [{ data: pData }, { data: mData }, lookups] = await Promise.all([
    supabase.from("profiles").select("*").order("active", { ascending: false }).order("role").order("full_name"),
    supabase.from("site_members").select("site_id,user_id"),
    getLookups(supabase, { allCompanies: true }),
  ]);
  const users = (pData ?? []) as Profile[];
  // Every active location with its company, for the location picker.
  const [{ data: locData }, scope] = await Promise.all([
    supabase.from("sites").select("id,name,code,city,company_id").eq("active", true).order("code", { nullsFirst: false }).order("name"),
    getCompanyScope(),
  ]);
  const locations = (locData ?? []) as { id: string; name: string; code: string | null; city: string | null; company_id: string | null }[];
  // Selected company first in the picker.
  const pickerCompanies = [...scope.companies].sort((a, b) => (a.id === scope.companyId ? -1 : b.id === scope.companyId ? 1 : 0));
  const members = (mData ?? []) as { site_id: string; user_id: string }[];
  // Hourly rates (admin only by row security). Newest first per person.
  const { data: rData } = await supabase.from("tech_rates").select("id,user_id,hourly_rate,effective_from,note,created_at").order("effective_from", { ascending: false });
  const rates = (rData ?? []) as { id: string; user_id: string; hourly_rate: number; effective_from: string; note: string | null; created_at: string }[];
  const today = todayISO();
  const currentRate = (uid: string) => rates.find((r) => r.user_id === uid && r.effective_from <= today);
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const view = sp.view === "sites" || sp.site ? "sites" : "users";

  return (
    <>
      <PageHeader title="Users" subtitle="Invite people, set their role, and choose which sites they can see." />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.invited && <Alert tone="good">Invite sent to {sp.invited}.</Alert>}
      {sp.added && <Alert tone="good">{sp.added} now has access.</Alert>}
      {sp.removed && <Alert tone="good">Removed from the location.</Alert>}
      {sp.saved && <Alert tone="good">User updated.</Alert>}
      {sp.rate && <Alert tone="good">Labor rate saved. Time already logged from that date was recalculated.</Alert>}

      <div className="mb-5 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
        {(
          [
            ["users", "By user", "/admin/users"],
            ["sites", "By location", "/admin/users?view=sites"],
          ] as const
        ).map(([key, label, href]) => (
          <Link
            key={key}
            href={href}
            className={clsx(
              "rounded-md px-3 py-1.5 font-medium",
              view === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      {view === "sites" ? (
        <SitesView
          sites={lookups.sites}
          users={users}
          members={members}
          focusSite={sp.site}
          hasServiceKey={hasServiceKey}
          meId={me.id}
        />
      ) : (
        <>

      <Card className="mb-6">
        <CardHeader title="Invite someone" subtitle="They’ll get an email link to sign in and set a password." />
        {!hasServiceKey ? (
          <p className="p-5 text-sm text-slate-600">
            Set <code className="rounded bg-slate-100 px-1">SUPABASE_SERVICE_ROLE_KEY</code> to send invites from here, or invite users from the Supabase dashboard
            (Authentication → Users) and set their role below.
          </p>
        ) : (
          <form action={inviteUser} className="grid gap-4 p-5 md:grid-cols-4">
            <Field label="Email">
              <Input type="email" name="email" required />
            </Field>
            <Field label="Name">
              <Input name="full_name" />
            </Field>
            <Field label="Role">
              <Select name="role" defaultValue="manager">
                {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vendor company" hint="Vendor logins only">
              <Select name="vendor_id" defaultValue="">
                <option value="">—</option>
                {lookups.vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="md:col-span-4">
              <legend className="mb-1 text-sm font-medium text-slate-700">Locations</legend>
              <p className="mb-2 text-xs text-slate-500">Managers and techs only see the locations you pick. Admins see every location; vendor logins see only their jobs.</p>
              <LocationPicker sites={locations} companies={pickerCompanies} />
            </fieldset>
            <div className="md:col-span-4">
              <SubmitButton pendingText="Sending…">Send invite</SubmitButton>
            </div>
          </form>
        )}
      </Card>

      <div className="mb-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(ROLE_HELP) as UserRole[]).map((r) => (
          <p key={r}>
            <b className="text-slate-700">{ROLE_LABEL[r]}:</b> {ROLE_HELP[r]}
          </p>
        ))}
      </div>

      <div className="space-y-3">
        {users.map((u) => {
          const userSites = members.filter((m) => m.user_id === u.id).map((m) => m.site_id);
          return (
            <Card key={u.id} className={u.active ? "" : "opacity-60"}>
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {personName(u)} {u.id === me.id && <span className="text-xs text-slate-400">(you)</span>}
                    </p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </div>
                  <Badge tone={u.role === "admin" ? "info" : "neutral"} dot={false}>
                    {ROLE_LABEL[u.role]}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    {u.role === "vendor"
                      ? lookups.vendors.find((v) => v.id === u.vendor_id)?.name ?? "No vendor linked"
                      : u.role === "admin"
                        ? "All sites"
                        : `${userSites.length} site${userSites.length === 1 ? "" : "s"}`}
                  </span>
                  {(u.role === "tech" || u.role === "admin") && (
                    <span className={`text-xs tabular-nums ${currentRate(u.id) ? "text-slate-600" : u.role === "tech" ? "font-medium text-orange-700" : "text-slate-400"}`}>
                      {currentRate(u.id) ? `${fmtMoney(currentRate(u.id)!.hourly_rate, 2)}/hr` : "No rate"}
                    </span>
                  )}
                  {!u.active && <Badge tone="muted">Inactive</Badge>}
                  <span className="text-xs font-medium text-brand-700">Edit</span>
                </summary>
                <form action={updateUser} className="grid gap-4 border-t border-slate-100 p-5 md:grid-cols-4">
                  <input type="hidden" name="id" value={u.id} />
                  <Field label="Name">
                    <Input name="full_name" defaultValue={u.full_name ?? ""} />
                  </Field>
                  <Field label="Phone">
                    <Input name="phone" defaultValue={u.phone ?? ""} />
                  </Field>
                  <Field label="Role">
                    <Select name="role" defaultValue={u.role}>
                      {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Vendor company" hint="Vendor logins only">
                    <Select name="vendor_id" defaultValue={u.vendor_id ?? ""}>
                      <option value="">—</option>
                      {lookups.vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <fieldset className="md:col-span-4">
                    <legend className="mb-1 text-sm font-medium text-slate-700">Locations</legend>
                    <LocationPicker sites={locations} companies={pickerCompanies} selected={userSites} />
                  </fieldset>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked={u.active} className="rounded border-slate-300" />
                    Active (can sign in)
                  </label>
                  <div className="md:col-span-3 md:text-right">
                    <SubmitButton size="sm">Save user</SubmitButton>
                  </div>
                </form>
                {(u.role === "tech" || u.role === "admin") && (
                  <div className="border-t border-slate-100 bg-slate-50/60 p-5">
                    <p className="text-sm font-medium text-slate-800">Labor rate</p>
                    <p className="mb-3 text-xs text-slate-500">
                      Used to cost this person&apos;s timed work. Each visit uses the rate in effect on the day it started. Only admins can see rates.
                    </p>
                    <form action={setLaborRate} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="user_id" value={u.id} />
                      <Field label="Hourly rate ($)">
                        <Input name="hourly_rate" inputMode="decimal" required placeholder="25.00" className="w-28" />
                      </Field>
                      <Field label="Effective from">
                        <Input type="date" name="effective_from" required defaultValue={today} />
                      </Field>
                      <Field label="Note (optional)">
                        <Input name="note" placeholder="e.g. Annual raise" />
                      </Field>
                      <SubmitButton size="md" variant="secondary" pendingText="Saving…">
                        Save rate
                      </SubmitButton>
                    </form>
                    {rates.some((r) => r.user_id === u.id) && (
                      <ul className="mt-3 space-y-1 text-xs text-slate-600">
                        {rates
                          .filter((r) => r.user_id === u.id)
                          .map((r) => (
                            <li key={r.id} className="flex gap-2">
                              <span className="w-24 tabular-nums font-medium">{fmtMoney(r.hourly_rate, 2)}/hr</span>
                              <span>from {fmtDate(r.effective_from)}</span>
                              {r.effective_from > today && <Badge tone="info" dot={false}>Upcoming</Badge>}
                              {currentRate(u.id)?.id === r.id && <Badge tone="good" dot={false}>Current</Badge>}
                              {r.note && <span className="text-slate-500">· {r.note}</span>}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </details>
            </Card>
          );
        })}
      </div>
        </>
      )}
    </>
  );
}

type SiteLite = { id: string; name: string; code: string | null };

function SitesView({
  sites,
  users,
  members,
  focusSite,
  hasServiceKey,
  meId,
}: {
  sites: SiteLite[];
  users: Profile[];
  members: { site_id: string; user_id: string }[];
  focusSite?: string;
  hasServiceKey: boolean;
  meId: string;
}) {
  if (!sites.length) {
    return (
      <Card className="p-5 text-sm text-slate-600">
        No locations yet. <Link href="/sites/new" className="font-medium text-brand-700">Add a site</Link> first.
      </Card>
    );
  }
  const byId = new Map(users.map((u) => [u.id, u]));
  const admins = users.filter((u) => u.role === "admin" && u.active);
  // People who can be given a location: active managers and techs.
  const assignable = users.filter((u) => u.active && (u.role === "manager" || u.role === "tech"));
  const shown = focusSite ? sites.filter((s) => s.id === focusSite) : sites;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <form className="flex items-end gap-2" action="/admin/users">
          <input type="hidden" name="view" value="sites" />
          <Field label="Location">
            <Select name="site" defaultValue={focusSite ?? ""}>
              <option value="">All locations</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code ? `${s.code} · ${s.name}` : s.name}
                </option>
              ))}
            </Select>
          </Field>
          <button className="rounded-lg px-3 py-2 text-sm font-medium text-brand-700 ring-1 ring-slate-300 hover:bg-slate-50">Show</button>
        </form>
        {admins.length > 0 && (
          <p className="text-xs text-slate-500">
            Admins see every location: {admins.map((a) => personName(a)).join(", ")}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {shown.map((site) => {
          const back = `/admin/users?view=sites${focusSite ? `&site=${site.id}` : ""}#site-${site.id}`;
          const team = members
            .filter((m) => m.site_id === site.id)
            .map((m) => byId.get(m.user_id))
            .filter((u): u is Profile => !!u && u.role !== "admin" && u.role !== "vendor")
            .sort((a, b) => a.role.localeCompare(b.role) || personName(a).localeCompare(personName(b)));
          const teamIds = new Set(team.map((u) => u.id));
          const candidates = assignable.filter((u) => !teamIds.has(u.id));

          return (
            <Card key={site.id} id={`site-${site.id}`} className="scroll-mt-6">
              <CardHeader
                title={site.code ? `${site.code} · ${site.name}` : site.name}
                subtitle={`${team.length} ${team.length === 1 ? "person" : "people"}`}
                action={
                  <Link href={`/sites/${site.id}`} className="text-xs font-medium text-brand-700">
                    Site page →
                  </Link>
                }
              />

              {team.length === 0 ? (
                <p className="px-5 py-3 text-sm text-slate-500">No managers or techs assigned yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {team.map((u) => (
                    <li key={u.id} className={clsx("flex flex-wrap items-center gap-3 px-5 py-2.5", !u.active && "opacity-60")}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {personName(u)} {u.id === meId && <span className="text-xs text-slate-400">(you)</span>}
                        </p>
                        <p className="text-xs text-slate-500">
                          {u.email}
                          {u.phone && ` · ${u.phone}`}
                        </p>
                      </div>
                      <Badge tone="neutral" dot={false}>
                        {ROLE_LABEL[u.role]}
                      </Badge>
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
                    <Field label="Add an existing user">
                      <Select name="user_id" defaultValue="" required disabled={!candidates.length}>
                        <option value="">{candidates.length ? "Choose a manager or tech…" : "Everyone is already here"}</option>
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
                      <p className="text-xs text-slate-500 sm:col-span-2">
                        If they already have a login, they’re just added to this location.
                      </p>
                    </form>
                  )}
                </details>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

