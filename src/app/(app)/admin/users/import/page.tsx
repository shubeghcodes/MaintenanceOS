import { requireRole } from "@/lib/auth";
import { Alert, PageHeader } from "@/components/ui";
import { UserImportClient } from "./UserImportClient";

export const metadata = { title: "Import users" };

export default async function ImportUsersPage() {
  await requireRole("admin");
  return (
    <>
      <PageHeader
        title="Import users from Excel"
        subtitle="Invite managers, techs and admins in one go and connect each person to their locations."
        back={{ href: "/admin/users", label: "Users" }}
      />
      {!process.env.SUPABASE_SERVICE_ROLE_KEY && <Alert>Set SUPABASE_SERVICE_ROLE_KEY to send invites.</Alert>}
      <UserImportClient />
    </>
  );
}
