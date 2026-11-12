import { getSession } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/constants";
import { Alert, Card, Field, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { updateAccount } from "./actions";

export const metadata = { title: "My account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { profile } = await getSession();
  return (
    <>
      <PageHeader title="My account" subtitle={`${profile.email} · ${ROLE_LABEL[profile.role]}`} />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.saved && <Alert tone="good">Saved.</Alert>}
      <form action={updateAccount} className="max-w-lg">
        <Card className="space-y-4 p-5">
          <Field label="Name">
            <Input name="full_name" defaultValue={profile.full_name ?? ""} required />
          </Field>
          <Field label="Mobile phone" hint="So techs and vendors can reach you about your requests.">
            <Input name="phone" defaultValue={profile.phone ?? ""} />
          </Field>
          <Field label="New password" hint="Set one so you can sign in without an email link. Leave blank to keep your current one.">
            <Input type="password" name="password" autoComplete="new-password" minLength={8} />
          </Field>
          <SubmitButton>Save</SubmitButton>
        </Card>
      </form>
    </>
  );
}
