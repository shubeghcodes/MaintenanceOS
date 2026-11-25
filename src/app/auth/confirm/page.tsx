"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const FAIL = "That sign-in link didn’t work or has expired. Use “Email me a link” below to get a new one.";

/** Only same-site paths: must start with "/" but not "//" or "/\" (no open redirect). */
function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/account";
}

/**
 * Landing page for login links an admin sent (see src/lib/login-link.ts). The link carries the session in the
 * URL fragment, which only the browser can read: set the session, wipe the fragment, then go to the app.
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
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    // Remove the tokens from the address bar and history right away, whatever happens next.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (params.get("error") || !access || !refresh) return fail();
    createClient()
      .auth.setSession({ access_token: access, refresh_token: refresh })
      .then(({ error }) => (error ? fail() : go(next)))
      .catch(fail);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-sm text-slate-600">
      {failed ? "Taking you to sign in…" : "Signing you in…"}
    </div>
  );
}
