import { requireRole } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { ROLE_LABEL } from "@/lib/constants";
import { personName } from "@/lib/format";
import type { Profile, UserRole } from "@/lib/types";
import { Alert, Badge, Card, CardHeader, Field, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { inviteUser, updateUser } from "./actions";

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
    getLookups(supabase),
  ]);
  const users = (pData ?? []) as Profile[];
  const members = (mData ?? []) as { site_id: string; user_id: string }[];
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  return (
    <>
      <PageHeader title="Users" subtitle="Invite people, set their role, and choose which sites they can see." />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.invited && <Alert tone="good">Invite sent to {sp.invited}.</Alert>}
      {sp.saved && <Alert tone="good">User updated.</Alert>}

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
              <legend className="mb-1 text-sm font-medium text-slate-700">Sites (managers & techs)</legend>
              <SiteChecks sites={lookups.sites} selected={[]} />
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
                    <legend className="mb-1 text-sm font-medium text-slate-700">Sites</legend>
                    <SiteChecks sites={lookups.sites} selected={userSites} />
                  </fieldset>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked={u.active} className="rounded border-slate-300" />
                    Active (can sign in)
                  </label>
                  <div className="md:col-span-3 md:text-right">
                    <SubmitButton size="sm">Save user</SubmitButton>
                  </div>
                </form>
              </details>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function SiteChecks({ sites, selected }: { sites: { id: string; name: string; code: string | null }[]; selected: string[] }) {
  if (!sites.length) return <p className="text-sm text-slate-500">No sites yet.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {sites.map((s) => (
        <label key={s.id} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-slate-200 has-[:checked]:bg-brand-50 has-[:checked]:ring-brand-500">
          <input type="checkbox" name="site_ids" value={s.id} defaultChecked={selected.includes(s.id)} className="rounded border-slate-300" />
          {s.code ?? s.name}
        </label>
      ))}
    </div>
  );
}
