import { Sidebar } from "@/components/Sidebar";
import { getSession } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/constants";
import { personName } from "@/lib/format";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await getSession();
  return (
    <div className="min-h-screen">
      <Sidebar role={profile.role} name={personName(profile)} roleLabel={ROLE_LABEL[profile.role]} />
      <main className="lg:pl-60">
        <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
