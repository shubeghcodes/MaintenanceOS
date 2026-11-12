"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { str } from "@/lib/format";

export async function updateAccount(fd: FormData) {
  const { supabase, profile } = await getSession();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: str(fd, "full_name"), phone: str(fd, "phone") })
    .eq("id", profile.id);
  if (error) redirect(`/account?error=${encodeURIComponent(error.message)}`);

  const password = str(fd, "password");
  if (password) {
    if (password.length < 8) redirect("/account?error=Password+must+be+at+least+8+characters");
    const { error: pErr } = await supabase.auth.updateUser({ password });
    if (pErr) redirect(`/account?error=${encodeURIComponent(pErr.message)}`);
  }
  redirect("/account?saved=1");
}
