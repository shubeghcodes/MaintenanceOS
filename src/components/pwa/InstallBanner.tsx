"use client";

import { useEffect, useState } from "react";
import { Bell, Download, Share, SquarePlus, X } from "lucide-react";
import { currentSubscription, enablePush, isIos, isStandalone, pushSupported, remember, remembered } from "./push-client";

type BeforeInstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * One small banner at the bottom of the screen, in this order:
 *  1. Install the app (Android/desktop Chrome: one tap; iPhone: Share → Add to Home Screen instructions)
 *  2. Once installed (or on a browser that supports it), turn on notifications
 * Each can be dismissed; it comes back after two weeks.
 */
export function InstallBanner({ vapidKey }: { vapidKey: string | null }) {
  const [mode, setMode] = useState<"install" | "ios" | "push" | null>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const standalone = isStandalone();
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPrompt);
      if (!remembered("mos-install-dismissed")) setMode("install");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    (async () => {
      if (!standalone && isIos() && !remembered("mos-install-dismissed")) return setMode("ios");
      const canPush = !!vapidKey && pushSupported() && Notification.permission === "default" && !remembered("mos-push-dismissed");
      // Ask for notifications once the app is installed (or on Android/desktop where the browser supports it).
      if (canPush && !(await currentSubscription()) && (standalone || !isIos())) setMode((m) => m ?? "push");
    })();
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [vapidKey]);

  if (!mode) return null;

  const close = () => {
    remember(mode === "push" ? "mos-push-dismissed" : "mos-install-dismissed", 14);
    setMode(null);
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl bg-white p-4 shadow-lg ring-1 ring-slate-200 lg:left-auto lg:right-6 lg:mx-0" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
      <button type="button" onClick={close} aria-label="Dismiss" className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:text-slate-600">
        <X className="h-4 w-4" />
      </button>
      <div className="flex gap-3 pr-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 text-sm">
          {mode === "install" && (
            <>
              <p className="font-semibold text-slate-900">Install MaintenanceOS</p>
              <p className="mt-0.5 text-slate-600">Open it from your home screen like an app, full-screen and one tap away.</p>
              <button
                type="button"
                onClick={async () => {
                  if (!deferred) return;
                  await deferred.prompt();
                  const { outcome } = await deferred.userChoice;
                  setDeferred(null);
                  setMode(outcome === "accepted" && vapidKey && pushSupported() ? "push" : null);
                }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
              >
                <Download className="h-4 w-4" /> Install
              </button>
            </>
          )}
          {mode === "ios" && (
            <>
              <p className="font-semibold text-slate-900">Add MaintenanceOS to your Home Screen</p>
              <p className="mt-1 text-slate-600">
                Tap <Share className="inline h-4 w-4 align-text-bottom text-brand-600" aria-label="Share" /> <b>Share</b> in Safari, then{" "}
                <SquarePlus className="inline h-4 w-4 align-text-bottom text-brand-600" aria-label="Add" /> <b>Add to Home Screen</b>. Open it from there to get
                job notifications.
              </p>
            </>
          )}
          {mode === "push" && vapidKey && (
            <>
              <p className="font-semibold text-slate-900">Turn on notifications</p>
              <p className="mt-0.5 text-slate-600">Get new jobs, approvals and sign-offs on this device right away.</p>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const err = await enablePush(vapidKey);
                  setBusy(false);
                  if (err) return setMsg(err);
                  setMode(null);
                }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              >
                <Bell className="h-4 w-4" /> {busy ? "Turning on…" : "Turn on"}
              </button>
              {msg && <p className="mt-2 text-xs text-red-600">{msg}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
