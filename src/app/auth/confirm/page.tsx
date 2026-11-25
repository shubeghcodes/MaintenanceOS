"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const FAIL = "That sign-in link didn’t work or has expired. Use “Email me a link” below to get a new one.";

/**
 * Landing page for login links an admin sent (see src/lib/login-link.ts). The link carries the session in the
 * URL fragment, which only the browser can read: set the session, wipe the fragment, then go to /account.
 * It always goes to /account and ignores any "next" in the address, so it can never redirect somewhere else.
 */
export default function ConfirmPage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const go = (path: string) => window.location.replace(path);
    const fail = () => {
      setFailed(true);
      go(`/login?error=${encodeURIComponent(FAIL)}`);
    };
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const access = params.get("access_token");
    const refresh = params.get("refresh_token");
    // Remove the tokens from the address bar and history right away, whatever happens next.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (params.get("error") || !access || !refresh) return fail();
    createClient()
      .auth.setSession({ access_token: access, refresh_token: refresh })
      .then(({ error }) => (error ? fail() : go("/account")))
      .catch(fail);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-sm text-slate-600">
      {failed ? "Taking you to sign in…" : "Signing you in…"}
    </div>
  );
}
