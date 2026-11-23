import { getSession } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/constants";
import { LOCALES } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { Alert, Card, CardHeader, Field, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { updateAccount } from "./actions";
import { getVapidPublicKey } from "@/lib/push";
import { LocationConsentToggle } from "@/components/LocationConsentToggle";
import { StoreVisits } from "@/components/StoreVisits";
import { PushToggle } from "@/components/pwa/PushToggle";

export const metadata = { title: "My account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  const t = await getT();
  const vapidKey = await getVapidPublicKey();
  return (
    <>
      <PageHeader title={t("My account")} subtitle={`${profile.email} · ${t(ROLE_LABEL[profile.role])}`} />
      {sp.error && <Alert>{t(sp.error)}</Alert>}
      {sp.saved && <Alert tone="good">{t("Saved.")}</Alert>}
      <form action={updateAccount} className="max-w-lg">
        <Card className="space-y-4 p-5">
          <Field label={t("Language")} hint={t("Buttons, menus, checklists and your emails and notifications.")}>
            <Select name="language" defaultValue={profile.language ?? "en"}>
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Name")}>
            <Input name="full_name" defaultValue={profile.full_name ?? ""} required />
          </Field>
          <Field label={t("Mobile phone")} hint={t("So techs and vendors can reach you about your requests.")}>
            <Input name="phone" defaultValue={profile.phone ?? ""} />
          </Field>
          <Field label={t("New password")} hint={t("Set one so you can sign in without an email link. Leave blank to keep your current one.")}>
            <Input type="password" name="password" autoComplete="new-password" minLength={8} />
          </Field>
          <SubmitButton>{t("Save")}</SubmitButton>
        </Card>
      </form>
      {profile.role !== "vendor" && (
        <Card className="mt-6 max-w-lg">
          <CardHeader title={t("Notifications on this device")} subtitle={t("Work order alerts as phone notifications, in addition to email.")} />
          <div className="p-5">
            <PushToggle vapidKey={vapidKey} />
          </div>
        </Card>
      )}
    {profile.role === "tech" && (
        <>
          <Card className="mt-6 max-w-lg">
            <CardHeader title={t("Location checks")} subtitle={t("Only while you are clocked in and the app is open.")} />
            <div className="p-5">
              <LocationConsentToggle consented={!!profile.location_consent_at} />
            </div>
          </Card>
          <div className="mt-6 max-w-lg">
            <StoreVisits supabase={supabase} userId={profile.id} lang={profile.language} />
          </div>
        </>
      )}
    </>
  );
}
