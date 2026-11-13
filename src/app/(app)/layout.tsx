import { Sidebar } from "@/components/Sidebar";
import { OnboardingTour } from "@/components/OnboardingTour";
import { getSession, isSuper, roleLabelOf } from "@/lib/auth";
import { getApprovalsWaiting, getCompanyScope, getReceiptsToReview } from "@/lib/company";
import { ROLE_LABEL } from "@/lib/constants";
import { personName } from "@/lib/format";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await getSession();
  const scope = await getCompanyScope();
  const [receiptsToReview, approvalsWaiting] = await Promise.all([getReceiptsToReview(), getApprovalsWaiting()]);
  // Admins always get the switcher (to add companies); others only when they span more than one company.
  const showPicker = scope.enabled && profile.role !== "vendor" && (profile.role === "admin" || scope.companies.length > 1);
  return (
    <div className="min-h-screen">
      <Sidebar role={profile.role} name={personName(profile)} roleLabel={roleLabelOf(profile, ROLE_LABEL)}
        isSuper={isSuper(profile)}
        companyPicker={showPicker ? { companies: scope.companies, value: scope.companyId } : null}
        receiptsToReview={receiptsToReview}
        approvalsWaiting={approvalsWaiting}
      />
      {profile.role !== "vendor" && (
        <OnboardingTour role={profile.role} firstName={(profile.full_name ?? "").split(" ")[0] || null} autoStart={!profile.tour_completed_at} />
      )}
      <main className="lg:pl-60">
        <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
