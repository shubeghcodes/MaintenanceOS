import Link from "next/link";
import { notFound } from "next/navigation";
import { isSuper, requireRole } from "@/lib/auth";
import { fmtDate, fmtMoney, personName } from "@/lib/format";
import { Alert, Badge, Card, CardHeader, DefList, Field, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { LocationPicker } from "@/components/LocationPicker";
import { setLaborRate, updateUser } from "../actions";
import { loadUsersData, RoleBadge, roleOptions, ROLE_SHORT, roleKey, Section } from "../shared";
import { RoleFields } from "../RoleFields";
import { TIME_OFF_LABEL, WEEKDAYS, type TimeOffEntry } from "@/lib/time-off";
import { todayISO } from "@/lib/format";

export const metadata = { title: "Edit person" };

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile: me } = await requireRole("admin");
  const d = await loadUsersData(supabase);
  const u = d.users.find((x) => x.id === id);
  if (!u) notFound();

  const superMe = isSuper(me);
  const uSuper = isSuper(u);
  const canEdit = superMe || u.role !== "admin";
  const back = `/admin/users/${id}`;
  const userSites = d.sitesOf(id);
  const siteById = new Map(d.locations.map((l) => [l.id, l]));
  const rates = d.ratesOf(id);
  const current = d.currentRate(id);
  const showRate = superMe && (u.role === "tech" || u.role === "admin");
  const [{ data: wd }, { data: offData }] =
    u.role === "tech"
      ? await Promise.all([
          supabase.from("tech_work_days").select("days_off").eq("user_id", id).maybeSingle(),
          supabase.from("tech_time_off").select("id,user_id,start_date,end_date,kind,note").eq("user_id", id).gte("end_date", todayISO()).order("start_date").limit(5),
        ])
      : [{ data: null }, { data: null }];
  const regularOff = ((wd as { days_off: number[] } | null)?.days_off ?? []).map((i) => WEEKDAYS[i]);
  const upcomingOff = (offData ?? []) as TimeOffEntry[];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {personName(u)}
            <RoleBadge u={u} />
            {!u.active && <Badge tone="muted">Inactive</Badge>}
          </span>
        }
        subtitle={[u.email, u.phone].filter(Boolean).join(" · ")}
        back={{ href: "/admin/users", label: "Users" }}
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.saved && <Alert tone="good">Saved.</Alert>}
      {sp.rate && <Alert tone="good">Labor rate saved. Time already logged from that date was recalculated.</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {canEdit ? (
            <form action={updateUser}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="back" value={back} />
              <Card>
                <Section title="Profile">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name">
                      <Input name="full_name" defaultValue={u.full_name ?? ""} />
                    </Field>
                    <Field label="Mobile phone">
                      <Input name="phone" defaultValue={u.phone ?? ""} />
                    </Field>
                    <Field label="Email" hint="Used to sign in. Can't be changed here." className="sm:col-span-2">
                      <Input value={u.email ?? ""} disabled readOnly className="bg-slate-50 text-slate-500" />
                    </Field>
                  </div>
                </Section>
                <Section title="Role" help="What they can see and do.">
                  <RoleFields
                    options={roleOptions(superMe)}
                    defaultRole={uSuper ? "super_admin" : u.role}
                    vendors={d.lookups.vendors}
                    defaultVendor={u.vendor_id}
                    companies={d.scope.companies}
                    selectedCompanies={d.scopeOf(id)}
                    canScopeCompanies={superMe}
                  />
                </Section>
                <Section
                  title="Locations"
                  help={
                    u.role === "admin"
                      ? "Admins see every location in their companies, so this list only matters if their role changes."
                      : u.role === "vendor"
                        ? "Vendor logins see only jobs sent to their company, not locations."
                        : "GMs and techs only see the locations picked here."
                  }
                >
                  <LocationPicker sites={d.locations} companies={d.pickerCompanies} selected={userSites} />
                </Section>
                <Section title="Status" help="Inactive people can't sign in. Their history stays.">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="active" defaultChecked={u.active} className="rounded border-slate-300" disabled={u.id === me.id} />
                    Active (can sign in)
                  </label>
                  {u.id === me.id && (
                    <>
                      <input type="hidden" name="active" value="on" />
                      <p className="text-xs text-slate-500">You can&apos;t deactivate yourself.</p>
                    </>
                  )}
                </Section>
                <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
                  <Link href="/admin/users" className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                    Cancel
                  </Link>
                  <SubmitButton>Save changes</SubmitButton>
                </div>
              </Card>
            </form>
          ) : (
            <Card>
              <CardHeader title="Details" subtitle="Only a super admin can change admins and super admins." />
              <DefList
                items={[
                  ["Role", ROLE_SHORT[roleKey(u)]],
                  ["Companies", uSuper || !d.scopeOf(id).length ? "All companies" : d.scopeOf(id).map((c) => d.companyName.get(c) ?? "—").join(", ")],
                  ["Status", u.active ? "Active" : "Inactive"],
                ]}
              />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="At a glance" />
            <DefList
              items={[
                ["Role", ROLE_SHORT[roleKey(u)]],
                [
                  "Locations",
                  u.role === "admin"
                    ? "All in their companies"
                    : u.role === "vendor"
                      ? d.lookups.vendors.find((v) => v.id === u.vendor_id)?.name ?? "No vendor linked"
                      : userSites.length
                        ? userSites
                            .map((s) => siteById.get(s))
                            .filter(Boolean)
                            .map((s) => (s!.code ? `#${s!.code}` : s!.name))
                            .join(", ")
                        : "None",
                ],
                ...(showRate ? ([["Hourly rate", current ? `${fmtMoney(current.hourly_rate, 2)}/hr` : "Not set"]] as [string, React.ReactNode][]) : []),
              ]}
            />
          </Card>

          {u.role === "tech" && (
            <Card>
              <CardHeader
                title="Days off"
                action={
                  <Link href={`/schedule/time-off?tech=${id}`} className="text-xs font-medium text-brand-700">
                    Manage
                  </Link>
                }
              />
              <div className="space-y-2 px-5 py-4 text-sm">
                <p className="text-slate-700">
                  <span className="text-slate-500">Regular: </span>
                  {regularOff.length ? regularOff.join(", ") : "Works every day"}
                </p>
                {upcomingOff.length === 0 ? (
                  <p className="text-xs text-slate-500">No time off coming up.</p>
                ) : (
                  <ul className="space-y-1 text-xs text-slate-600">
                    {upcomingOff.map((e) => (
                      <li key={e.id}>
                        {TIME_OFF_LABEL[e.kind]} · {e.start_date === e.end_date ? fmtDate(e.start_date) : `${fmtDate(e.start_date)} – ${fmtDate(e.end_date)}`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          )}
          {showRate && (
            <Card>
              <CardHeader title="Labor rate" subtitle="Costs their timed work. Each visit uses the rate in effect that day. Only super admins see rates." />
              <form action={setLaborRate} className="space-y-3 px-5 py-4">
                <input type="hidden" name="user_id" value={id} />
                <input type="hidden" name="back" value={back} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Hourly rate ($)">
                    <Input name="hourly_rate" inputMode="decimal" required placeholder="25.00" />
                  </Field>
                  <Field label="Effective from">
                    <Input type="date" name="effective_from" required defaultValue={d.today} />
                  </Field>
                </div>
                <Field label="Note (optional)">
                  <Input name="note" placeholder="Annual raise" />
                </Field>
                <SubmitButton variant="secondary" pendingText="Saving…">
                  Save rate
                </SubmitButton>
              </form>
              {rates.length > 0 && (
                <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
                  {rates.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                      <span className="w-24 font-medium tabular-nums">{fmtMoney(r.hourly_rate, 2)}/hr</span>
                      <span className="text-xs text-slate-500">from {fmtDate(r.effective_from)}</span>
                      {r.effective_from > d.today && <Badge tone="info" dot={false}>Upcoming</Badge>}
                      {current?.id === r.id && <Badge tone="good" dot={false}>Current</Badge>}
                      {r.note && <span className="w-full text-xs text-slate-500">{r.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
