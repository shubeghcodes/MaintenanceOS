"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { pingLocation, setLocationConsent } from "@/app/(app)/my-day/location-actions";
import { useT } from "@/lib/i18n/client";

const EVERY_MS = 60_000; // at most one reading a minute…
const MOVED_M = 50; //      …or sooner if they moved this far
const MIN_GAP_MS = 10_000;

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Techs only, mounted once in the app layout. While a shift is open and the tech agreed, checks the phone's
 * location (only while the app is on screen) and sends it about once a minute. Asks for agreement the first time.
 * Location problems never block anything: a refusal or error just means no check.
 */
export function LocationTracker({ clockedIn, consented }: { clockedIn: boolean; consented: boolean }) {
  const t = useT();
  const router = useRouter();
  const [agreed, setAgreed] = useState(consented);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(true);
  const last = useRef<{ at: number; lat: number; lng: number } | null>(null);

  useEffect(() => setAgreed(consented), [consented]);
  useEffect(() => {
    try {
      if (sessionStorage.getItem("loc-consent-later")) setLater(true);
    } catch {}
    const onVis = () => setVisible(document.visibilityState === "visible");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const active = clockedIn && agreed && visible;
  useEffect(() => {
    if (!active || !("geolocation" in navigator)) return;
    last.current = null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const here = { lat: p.coords.latitude, lng: p.coords.longitude };
        const prev = last.current;
        const now = Date.now();
        if (prev) {
          const gap = now - prev.at;
          if (gap < MIN_GAP_MS || (gap < EVERY_MS && metres(prev, here) <= MOVED_M)) return;
        }
        last.current = { at: now, ...here };
        pingLocation(here.lat, here.lng, Math.round(p.coords.accuracy)).catch(() => undefined);
      },
      () => undefined, // denied or unavailable: carry on without
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);

  if (!clockedIn || agreed || later) return null;

  const agree = async () => {
    setBusy(true);
    const r = await setLocationConsent(true).catch(() => ({ ok: false }));
    setBusy(false);
    if (r.ok) {
      setAgreed(true);
      router.refresh();
    }
  };
  const notNow = () => {
    try {
      sessionStorage.setItem("loc-consent-later", "1");
    } catch {}
    setLater(true);
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-xl bg-white p-4 shadow-lg ring-1 ring-slate-300 lg:left-auto lg:right-6" role="dialog" aria-label={t("Location checks")}>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <MapPin className="h-4 w-4" aria-hidden /> {t("Let the app note when you reach a store?")}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {t("While you're clocked in and the app is open, MaintenanceOS checks whether you're at one of your stores and records when you arrive and leave. Your exact location is not saved. Admins and your store's GM can see your store visits.")}
      </p>
      <div className="mt-3 flex gap-2">
        <button onClick={agree} disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
          {t("Agree")}
        </button>
        <button onClick={notNow} className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
          {t("Not now")}
        </button>
      </div>
    </div>
  );
}
