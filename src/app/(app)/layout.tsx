import { Sidebar } from "@/components/Sidebar";
import { OnboardingTour } from "@/components/OnboardingTour";
import { getSession, isSuper, roleLabelOf } from "@/lib/auth";
import { getApprovalsWaiting, getCompanyScope, getReceiptsToReview } from "@/lib/company";
import { ROLE_LABEL } from "@/lib/constants";
import { personName } from "@/lib/format";
import { getVapidPublicKey } from "@/lib/push";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { I18nProvider } from "@/lib/i18n/client";
import { asLocale, translate } from "@/lib/i18n";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await getSession();
  const scope = await getCompanyScope();
  const [receiptsToReview, approvalsWaiting, vapidKey] = await Promise.all([getReceiptsToReview(), getApprovalsWaiting(), getVapidPublicKey()]);
  // Admins always get the switcher (to add companies); others only when they span more than one company.
  const showPicker = scope.enabled && profile.role !== "vendor" && (profile.role === "admin" || scope.companies.length > 1);
  const locale = asLocale(profile.language);
  return (
    <I18nProvider locale={locale}>
    <div className="min-h-screen" lang={locale}>
      <Sidebar role={profile.role} name={personName(profile)} roleLabel={translate(locale, roleLabelOf(profile, ROLE_LABEL))}
        isSuper={isSuper(profile)}
        companyPicker={showPicker ? { companies: scope.companies, value: scope.companyId } : null}
        receiptsToReview={receiptsToReview}
        approvalsWaiting={approvalsWaiting}
      />
      {profile.role !== "vendor" && (
        <OnboardingTour role={profile.role} firstName={(profile.full_name ?? "").split(" ")[0] || null} autoStart={!profile.tour_completed_at} />
      )}
      {profile.role !== "vendor" && <InstallBanner vapidKey={vapidKey} />}
      <main className="lg:pl-60 print:!pl-0">
        <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">{children}</div>
      </main>
    </div>
    </I18nProvider>
  );
}
