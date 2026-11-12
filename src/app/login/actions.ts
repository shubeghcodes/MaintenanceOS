"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { str } from "@/lib/format";

export async function sendMagicLink(formData: FormData) {
  return signIn(formData, "magic");
}

export async function signIn(formData: FormData, mode: "password" | "magic" = "password") {
  const email = str(formData, "email");
  const password = str(formData, "password");
  const next = str(formData, "next") || "/";
  const supabase = await createClient();

  if (!email) redirect("/login?error=email");

  if (mode === "magic" || !password) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin") || "";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
    redirect("/login?sent=1");
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`);
  redirect(next.startsWith("/") ? next : "/");
}
