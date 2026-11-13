"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, requireSuper } from "@/lib/auth";
import { COMPANY_COOKIE } from "@/lib/company";
import { str } from "@/lib/format";

async function rememberCompany(id: string) {
  (await cookies()).set(COMPANY_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
}

/** Switch the active company ("all" = every company). Nothing in the database changes. */
export async function setCompany(id: string) {
  const { supabase } = await getSession();
  if (id !== "all") {
    const { data } = await supabase.from("companies").select("id").eq("id", id).maybeSingle();
    if (!data) id = "all";
  }
  await rememberCompany(id);
  revalidatePath("/", "layout");
}

export async function saveCompany(fd: FormData) {
  const { supabase } = await requireSuper();
  const id = str(fd, "id");
  const name = str(fd, "name");
  if (!name) redirect(`/companies?error=${encodeURIComponent("Company name is required")}`);
  const row = { name, legal_name: str(fd, "legal_name"), notes: str(fd, "notes"), active: id ? fd.get("active") === "on" : true };

  const res = id
    ? await supabase.from("companies").update(row).eq("id", id).select("id").single()
    : await supabase.from("companies").insert(row).select("id").single();
  if (res.error || !res.data) {
    const msg = res.error?.code === "23505" ? `A company named “${name}” already exists` : res.error?.message ?? "Save failed";
    redirect(`/companies?error=${encodeURIComponent(msg)}`);
  }
  // A brand-new company becomes the active one so you can start adding its locations.
  if (!id) await rememberCompany(res.data.id);
  revalidatePath("/", "layout");
  redirect(id ? "/companies?saved=1" : `/companies?created=${encodeURIComponent(name)}`);
}
