import "server-only";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "./supabase/admin";

export type LoginLinkResult = { ok: true } | { ok: false; error: string; rateLimited: boolean };

/**
 * Emails a one-tap sign-in link to someone who ALREADY has a login (it never creates users).
 *
 * Uses a cookie-less client on the implicit flow on purpose: the default (PKCE) flow saves a "code verifier"
 * in the browser of whoever asked for the link, so a link requested by an admin would fail for the person who
 * taps it. The email link lands on /auth/confirm, which signs them in from the token in the URL.
 */
export async function sendLoginLink(email: string): Promise<LoginLinkResult> {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin") || "").replace(/\/$/, "");
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm?next=/account` },
  });
  if (!error) return { ok: true };
  const msg = error.message || "Couldn’t send the email";
  const rateLimited = error.status === 429 || /rate limit|too many|only request this after|security purposes/i.test(msg);
  return {
    ok: false,
    rateLimited,
    error: rateLimited
      ? `Supabase says the email sending limit was reached (“${msg}”). Wait a few minutes and try again.`
      : `Couldn’t send the login link (${msg}).`,
  };
}

/** Ids of people who have never signed in. Admin pages only: reads auth data with the service role. */
export async function neverSignedInIds(): Promise<Set<string>> {
  const out = new Set<string>();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return out;
  try {
    const admin = createAdminClient();
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error || !data) break;
      for (const u of data.users) if (!u.last_sign_in_at) out.add(u.id);
      if (data.users.length < 1000) break;
    }
  } catch {
    /* badge is a nicety; never break the page */
  }
  return out;
}

/** True if this one person has never signed in (null if it can't be checked). */
export async function hasNeverSignedIn(userId: string): Promise<boolean | null> {
  try {
    const { data, error } = await createAdminClient().auth.admin.getUserById(userId);
    if (error || !data.user) return null;
    return !data.user.last_sign_in_at;
  } catch {
    return null;
  }
}
