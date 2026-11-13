import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Profile, UserRole } from "./types";

/** Current session + profile. Redirects to /login when signed out. Cached per request. */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single<Profile>();
  if (!profile || !profile.active) redirect("/login?error=inactive");

  return { supabase, user, profile };
});

/** Like getSession, but sends users without one of the given roles back to the dashboard. */
export async function requireRole(...roles: UserRole[]) {
  const session = await getSession();
  if (!roles.includes(session.profile.role)) redirect("/");
  return session;
}

/** Super admin: the owner level (companies, admins, labor rates, deletes, paying invoices). */
export const isSuper = (p: Pick<Profile, "role" | "is_super"> | null | undefined) => !!p && p.role === "admin" && !!p.is_super;

export async function requireSuper() {
  const session = await getSession();
  if (!isSuper(session.profile)) redirect("/");
  return session;
}

/** Display label for a person's role, with Super admin for super admins. */
export function roleLabelOf(p: Pick<Profile, "role" | "is_super">, labels: Record<UserRole, string>) {
  return isSuper(p) ? "Super admin" : labels[p.role];
}

export const can = {
  manageSetup: (p: Profile) => p.role === "admin",
  createWorkOrder: (p: Profile) => p.role !== "vendor",
  assign: (p: Profile) => p.role === "admin" || p.role === "tech",
  editAssets: (p: Profile) => p.role === "admin" || p.role === "tech",
  workTickets: (p: Profile) => p.role !== "manager",
};
