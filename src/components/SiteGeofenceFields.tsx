"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { Field, Input } from "@/components/ui";

/** Site edit form: store coordinates and how close counts as "at the store". Admin-only form. */
export function SiteGeofenceFields({ lat, lng, radius }: { lat: number | null; lng: number | null; radius: number }) {
  const [la, setLa] = useState(lat != null ? String(lat) : "");
  const [ln, setLn] = useState(lng != null ? String(lng) : "");
  const [msg, setMsg] = useState("");
  const valid = la !== "" && ln !== "" && Number.isFinite(Number(la)) && Number.isFinite(Number(ln));

  const useMine = () => {
    setMsg("");
    if (!("geolocation" in navigator)) return setMsg("This device can't share its location.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLa(p.coords.latitude.toFixed(6));
        setLn(p.coords.longitude.toFixed(6));
        setMsg(`Filled in (accurate to about ${Math.round(p.coords.accuracy)} m). Stand at the store, then save.`);
      },
      () => setMsg("Couldn't get your location. Allow location for this site, or type the numbers."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Latitude">
        <Input name="latitude" inputMode="decimal" value={la} onChange={(e) => setLa(e.target.value)} placeholder="33.870000" />
      </Field>
      <Field label="Longitude">
        <Input name="longitude" inputMode="decimal" value={ln} onChange={(e) => setLn(e.target.value)} placeholder="-117.920000" />
      </Field>
      <Field label="Geofence radius (m)" hint="50–2000. How close counts as at the store.">
        <Input name="geofence_radius_m" inputMode="numeric" defaultValue={radius} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <button type="button" onClick={useMine} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
          <MapPin className="h-4 w-4" aria-hidden /> Use my current location
        </button>
        {valid && (
          <a href={`https://www.google.com/maps?q=${Number(la)},${Number(ln)}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-700 hover:underline">
            Check on Google Maps
          </a>
        )}
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}
