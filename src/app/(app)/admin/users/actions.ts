"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isSuper, requireRole, requireSuper } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { str } from "@/lib/format";
import type { UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["admin", "manager", "tech", "vendor"];

/** Role field → role + super flag ("super_admin" is an admin with is_super). */
function readRole(fd: FormData): { role: UserRole; isSuper: boolean } {
  const raw = str(fd, "role") ?? "manager";
  return raw === "super_admin" ? { role: "admin", isSuper: true } : { role: raw as UserRole, isSuper: false };
}

/** Super admins only: which companies an admin manages (none = all). */
async function saveAdminCompanies(userId: string, fd: FormData) {
  const admin = createAdminClient();
  const ids = (fd.getAll("admin_company_ids") as string[]).filter(Boolean);
  await admin.from("admin_companies").delete().eq("user_id", userId);
  if (ids.length) await admin.from("admin_companies").insert(ids.map((company_id) => ({ user_id: userId, company_id })));
}

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
  const { supabase, profile: me } = await requireRole("admin");
  const back = backTo(fd);
  const email = str(fd, "email")?.toLowerCase();
  const { role, isSuper: makeSuper } = readRole(fd);
  const vendorId = role === "vendor" ? str(fd, "vendor_id") : null;
  let siteIds = role === "vendor" || role === "admin" ? [] : (fd.getAll("site_ids") as string[]).filter(Boolean);
  if (!email || !ROLES.includes(role)) redirect(withParam(back, "error", "Email and role are required"));
  if (role === "admin" && !isSuper(me)) redirect(withParam(back, "error", "Only a super admin can add admins"));
  // Only locations this admin can see (company-limited admins can't grant others).
  if (siteIds.length) {
    const { data: ok } = await supabase.from("sites").select("id").in("id", siteIds);
    siteIds = ((ok ?? []) as { id: string }[]).map((s) => s.id);
  }
  if (role === "vendor" && !vendorId) redirect(withParam(back, "error", "Pick the vendor company for a vendor login"));

  const admin = createAdminClient();

  // Already has an account? Just give them the selected sites instead of failing the invite.
  const { data: existing } = await admin.from("profiles").select("id,role").ilike("email", email).maybeSingle();
  if (existing) {
    if (existing.role === "admin" && !isSuper(me)) redirect(withParam(back, "error", `${email} is an admin; only a super admin can change admins`));
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
  await admin.from("profiles").update({ role, is_super: role === "admin" && makeSuper, vendor_id: vendorId, full_name: str(fd, "full_name") }).eq("id", data.user.id);
  if (role === "admin" && !makeSuper && isSuper(me)) await saveAdminCompanies(data.user.id, fd);
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
  const { supabase, profile: me } = await requireRole("admin");
  const superMe = isSuper(me);
  const id = str(fd, "id")!;
  const { role, isSuper: makeSuper } = readRole(fd);
  const active = fd.get("active") === "on";
  if (!ROLES.includes(role)) redirect("/admin/users?error=Pick+a+role");
  if (id === me.id && (role !== "admin" || !active || (me.is_super && !makeSuper))) {
    redirect("/admin/users?error=You+can’t+remove+your+own+admin+access");
  }
  const { data: target } = await supabase.from("profiles").select("id,role,is_super").eq("id", id).maybeSingle();
  if (!target) redirect("/admin/users?error=User+not+found");
  if (!superMe && (target.role === "admin" || role === "admin")) redirect("/admin/users?error=Only+a+super+admin+can+add+or+change+admins");

  const vendorId = role === "vendor" ? str(fd, "vendor_id") : null;
  const patch: Record<string, unknown> = { role, vendor_id: vendorId, active, full_name: str(fd, "full_name"), phone: str(fd, "phone") };
  if (superMe) patch.is_super = role === "admin" && makeSuper;
  const { error } = await supabase.from("profiles").update(patch).eq("id", id);
  if (error) redirect(`/admin/users?error=${encodeURIComponent(error.message)}`);
  if (superMe) {
    if (role === "admin" && !makeSuper) await saveAdminCompanies(id, fd);
    else await createAdminClient().from("admin_companies").delete().eq("user_id", id);
  }

  // Replace site memberships (row security limits a company-limited admin to their own locations).
  const siteIds = role === "vendor" ? [] : (fd.getAll("site_ids") as string[]);
  await supabase.from("site_members").delete().eq("user_id", id);
  if (siteIds.length) {
    const { error: mErr } = await supabase.from("site_members").insert(siteIds.map((site_id) => ({ site_id, user_id: id })));
    if (mErr) redirect(`/admin/users?error=${encodeURIComponent(mErr.message)}`);
  }
  revalidatePath("/admin/users");
  redirect("/admin/users?saved=1");
}

/** Set a technician's hourly labor rate from a date (keeps history; recosts their time from that date). */
export async function setLaborRate(fd: FormData) {
  const { supabase, profile } = await requireSuper();
  const userId = str(fd, "user_id");
  const rate = Number(String(fd.get("hourly_rate") ?? "").replace(/[$,\s]/g, ""));
  const from = str(fd, "effective_from");
  if (!userId || !from || !Number.isFinite(rate) || rate < 0) redirect("/admin/users?error=" + encodeURIComponent("Enter a valid hourly rate and date"));
  const { error } = await supabase
    .from("tech_rates")
    .upsert({ user_id: userId, hourly_rate: rate, effective_from: from, note: str(fd, "note"), created_by: profile.id }, { onConflict: "user_id,effective_from" });
  if (error) redirect("/admin/users?error=" + encodeURIComponent(error.message));
  revalidatePath("/admin/users");
  revalidatePath("/labor");
  revalidatePath("/rm");
  redirect("/admin/users?rate=1");
}
