"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setLocationConsent } from "@/app/(app)/my-day/location-actions";
import { useT } from "@/lib/i18n/client";

/** My account: turn store location checks on or off. */
export function LocationConsentToggle({ consented }: { consented: boolean }) {
  const t = useT();
  const router = useRouter();
  const [on, setOn] = useState(consented);
  const [busy, setBusy] = useState(false);
  const flip = async () => {
    setBusy(true);
    const r = await setLocationConsent(!on).catch(() => ({ ok: false }));
    setBusy(false);
    if (r.ok) {
      setOn(!on);
      router.refresh();
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">{on ? t("Location checks are on while you are clocked in.") : t("Location checks are off.")}</p>
      <button
        onClick={flip}
        disabled={busy}
        className={`rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm disabled:opacity-60 ${on ? "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
      >
        {on ? t("Withdraw my agreement") : t("Agree to location checks")}
      </button>
    </div>
  );
}
