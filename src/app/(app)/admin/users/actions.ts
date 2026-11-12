"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { str } from "@/lib/format";
import type { UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["admin", "manager", "tech", "vendor"];

export async function inviteUser(fd: FormData) {
  await requireRole("admin");
  const email = str(fd, "email")?.toLowerCase();
  const role = (str(fd, "role") ?? "manager") as UserRole;
  const vendorId = role === "vendor" ? str(fd, "vendor_id") : null;
  const siteIds = role === "vendor" ? [] : (fd.getAll("site_ids") as string[]);
  if (!email || !ROLES.includes(role)) redirect("/admin/users?error=Email+and+role+are+required");
  if (role === "vendor" && !vendorId) redirect("/admin/users?error=Pick+the+vendor+company+for+a+vendor+login");

  const admin = createAdminClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin") || "";
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: str(fd, "full_name"), role, vendor_id: vendorId },
    redirectTo: `${origin}/auth/callback?next=/account`,
  });
  if (error || !data.user) redirect(`/admin/users?error=${encodeURIComponent(error?.message ?? "Invite failed")}`);

  // The DB trigger creates the profile; make sure role/vendor are set even if metadata was ignored.
  await admin.from("profiles").update({ role, vendor_id: vendorId, full_name: str(fd, "full_name") }).eq("id", data.user.id);
  if (siteIds.length) {
    await admin.from("site_members").upsert(siteIds.map((site_id) => ({ site_id, user_id: data.user.id })));
  }
  revalidatePath("/admin/users");
  redirect(`/admin/users?invited=${encodeURIComponent(email)}`);
}

export async function updateUser(fd: FormData) {
  const { supabase, profile } = await requireRole("admin");
  const id = str(fd, "id")!;
  const role = (str(fd, "role") ?? "manager") as UserRole;
  const active = fd.get("active") === "on";
  if (id === profile.id && (role !== "admin" || !active)) {
    redirect("/admin/users?error=You+can’t+remove+your+own+admin+access");
  }
  const vendorId = role === "vendor" ? str(fd, "vendor_id") : null;
  const { error } = await supabase
    .from("profiles")
    .update({ role, vendor_id: vendorId, active, full_name: str(fd, "full_name"), phone: str(fd, "phone") })
    .eq("id", id);
  if (error) redirect(`/admin/users?error=${encodeURIComponent(error.message)}`);

  // Replace site memberships
  const siteIds = role === "vendor" ? [] : (fd.getAll("site_ids") as string[]);
  await supabase.from("site_members").delete().eq("user_id", id);
  if (siteIds.length) {
    const { error: mErr } = await supabase.from("site_members").insert(siteIds.map((site_id) => ({ site_id, user_id: id })));
    if (mErr) redirect(`/admin/users?error=${encodeURIComponent(mErr.message)}`);
  }
  revalidatePath("/admin/users");
  redirect("/admin/users?saved=1");
}
