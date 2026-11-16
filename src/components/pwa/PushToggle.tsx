"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from "./push-client";

/** Account page: notifications on/off for this device, plus a test. */
export function PushToggle({ vapidKey }: { vapidKey: string | null }) {
  const t = useT();
  const [state, setState] = useState<"loading" | "on" | "off" | "blocked" | "unsupported" | "ios-install">("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    if (!pushSupported()) return setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
    if (Notification.permission === "denied") return setState("blocked");
    setState((await currentSubscription()) ? "on" : "off");
  }
  useEffect(() => {
    refresh();
  }, []);

  if (!vapidKey) return <p className="text-sm text-slate-500">{t("Notifications aren't set up on the server yet.")}</p>;

  return (
    <div className="space-y-2 text-sm">
      {state === "on" && (
        <p className="flex items-center gap-1.5 text-emerald-700">
          <Bell className="h-4 w-4" /> {t("Notifications are on for this device.")}
        </p>
      )}
      {state === "off" && <p className="text-slate-600">{t("Notifications are off for this device.")}</p>}
      {state === "blocked" && <p className="text-amber-700">{t("Notifications are blocked for this site. Allow them in your phone or browser settings, then reload.")}</p>}
      {state === "unsupported" && <p className="text-slate-500">{t("This browser doesn't support notifications.")}</p>}
      {state === "ios-install" && (
        <p className="text-slate-600">{t("On iPhone, add MaintenanceOS to your Home Screen (Share → Add to Home Screen), open it from there, and turn notifications on here.")}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {state === "off" && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg(await enablePush(vapidKey));
              setBusy(false);
              refresh();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white disabled:opacity-60"
          >
            <Bell className="h-4 w-4" /> {t("Turn on")}
          </button>
        )}
        {state === "on" && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await fetch("/api/push/test", { method: "POST" }).then((x) => x.json()).catch(() => null);
                setMsg(r?.ok ? t("Test sent. It should appear in a few seconds.") : t("Couldn't send a test. Try turning notifications off and on again."));
                setBusy(false);
              }}
              className="rounded-lg px-3 py-1.5 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-60"
            >
              {t("Send a test")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await disablePush();
                setBusy(false);
                setMsg(null);
                refresh();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-60"
            >
              <BellOff className="h-4 w-4" /> {t("Turn off")}
            </button>
          </>
        )}
      </div>
      {msg && <p className="text-xs text-slate-600">{t(msg)}</p>}
    </div>
  );
}
