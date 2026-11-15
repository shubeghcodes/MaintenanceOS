import { isSuper, requireRole } from "@/lib/auth";
import { Alert, Card, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { LocationPicker } from "@/components/LocationPicker";
import { inviteUser } from "../actions";
import { loadUsersData, roleOptions, Section } from "../shared";
import { RoleFields } from "../RoleFields";

export const metadata = { title: "Invite person" };

export default async function InvitePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile: me } = await requireRole("admin");
  const d = await loadUsersData(supabase);
  const superMe = isSuper(me);
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  return (
    <>
      <PageHeader title="Invite person" subtitle="They get an email link to sign in and set a password." back={{ href: "/admin/users", label: "Users" }} />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.invited && <Alert tone="good">Invite sent to {sp.invited}. Fill in the form again to invite someone else.</Alert>}
      {sp.added && <Alert tone="good">{sp.added} already had a login and now has the locations you picked.</Alert>}
      {!hasServiceKey ? (
        <Card className="p-5 text-sm text-slate-600">
          Set <code className="rounded bg-slate-100 px-1">SUPABASE_SERVICE_ROLE_KEY</code> to send invites from here, or invite people from the Supabase
          dashboard (Authentication → Users) and set their role on the Users page.
        </Card>
      ) : (
        <form action={inviteUser}>
          <input type="hidden" name="back" value="/admin/users/invite" />
          <Card>
            <Section title="Person" help="If this email already has a login, they're added to the locations you pick instead.">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
                  <Input type="email" name="email" required autoComplete="off" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Name</span>
                  <Input name="full_name" />
                </label>
              </div>
            </Section>
            <Section title="Role" help="What they can see and do.">
              <RoleFields
                options={roleOptions(superMe)}
                defaultRole="manager"
                vendors={d.lookups.vendors}
                companies={d.scope.companies}
                canScopeCompanies={superMe}
              />
            </Section>
            <Section title="Locations" help="GMs and techs only see the locations you pick. Admins see every location; vendor logins see only their jobs.">
              <LocationPicker sites={d.locations} companies={d.pickerCompanies} />
            </Section>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
              <SubmitButton pendingText="Sending…">Send invite</SubmitButton>
            </div>
          </Card>
        </form>
      )}
    </>
  );
}
