"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { str } from "@/lib/format";
import type { UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["admin", "manager", "tech", "vendor"];

/** Where to send the admin after an action. Only paths on the Users page are allowed. */
function backTo(fd: FormData) {
  const b = str(fd, "back");
  return b && b.startsWith("/admin/users") ? b : "/admin/users";
}

function withParam(url: string, key: string, value: string) {
  const [path, hash] = url.split("#");
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${encodeURIComponent(value)}${hash ? `#${hash}` : ""}`;
}

export async function inviteUser(fd: FormData) {
  await requireRole("admin");
  const back = backTo(fd);
  const email = str(fd, "email")?.toLowerCase();
  const role = (str(fd, "role") ?? "manager") as UserRole;
  const vendorId = role === "vendor" ? str(fd, "vendor_id") : null;
  const siteIds = role === "vendor" ? [] : (fd.getAll("site_ids") as string[]).filter(Boolean);
  if (!email || !ROLES.includes(role)) redirect(withParam(back, "error", "Email and role are required"));
  if (role === "vendor" && !vendorId) redirect(withParam(back, "error", "Pick the vendor company for a vendor login"));

  const admin = createAdminClient();

  // Already has an account? Just give them the selected sites instead of failing the invite.
  const { data: existing } = await admin.from("profiles").select("id,role").ilike("email", email).maybeSingle();
  if (existing) {
    if (existing.role === "vendor" && siteIds.length) {
      redirect(withParam(back, "error", `${email} is a vendor login. Change their role before adding them to a site.`));
    }
    if (siteIds.length) {
      await admin.from("site_members").upsert(
        siteIds.map((site_id) => ({ site_id, user_id: existing.id })),
        { onConflict: "site_id,user_id", ignoreDuplicates: true },
      );
    }
    revalidatePath("/admin/users");
    revalidatePath("/sites", "layout");
    redirect(withParam(back, "added", email));
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin") || "";
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: str(fd, "full_name"), role, vendor_id: vendorId },
    redirectTo: `${origin}/auth/callback?next=/account`,
  });
  if (error || !data.user) redirect(withParam(back, "error", error?.message ?? "Invite failed"));

  // The DB trigger creates the profile; make sure role/vendor are set even if metadata was ignored.
  await admin.from("profiles").update({ role, vendor_id: vendorId, full_name: str(fd, "full_name") }).eq("id", data.user.id);
  if (siteIds.length) {
    await admin.from("site_members").upsert(siteIds.map((site_id) => ({ site_id, user_id: data.user.id })));
  }
  revalidatePath("/admin/users");
  revalidatePath("/sites", "layout");
  redirect(withParam(back, "invited", email));
}

/** Add an existing user to one location. */
export async function addSiteMember(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const back = backTo(fd);
  const siteId = str(fd, "site_id");
  const userId = str(fd, "user_id");
  if (!siteId || !userId) redirect(withParam(back, "error", "Pick a person to add"));

  const { data: u } = await supabase.from("profiles").select("role,email,full_name").eq("id", userId).maybeSingle();
  if (!u) redirect(withParam(back, "error", "User not found"));
  if (u.role === "vendor") redirect(withParam(back, "error", "Vendor logins see their company’s jobs, not sites"));

  const { error } = await supabase
    .from("site_members")
    .upsert({ site_id: siteId, user_id: userId }, { onConflict: "site_id,user_id", ignoreDuplicates: true });
  if (error) redirect(withParam(back, "error", error.message));
  revalidatePath("/admin/users");
  revalidatePath(`/sites/${siteId}`);
  redirect(withParam(back, "added", u.full_name || u.email || "User"));
}

/** Remove a user from one location (their other sites are untouched). */
export async function removeSiteMember(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const back = backTo(fd);
  const siteId = str(fd, "site_id");
  const userId = str(fd, "user_id");
  if (!siteId || !userId) redirect(back);
  const { error } = await supabase.from("site_members").delete().eq("site_id", siteId).eq("user_id", userId);
  if (error) redirect(withParam(back, "error", error.message));
  revalidatePath("/admin/users");
  revalidatePath(`/sites/${siteId}`);
  redirect(withParam(back, "removed", "1"));
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
