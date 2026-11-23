"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { personName } from "@/lib/format";
import { notifyPresence, recordPing } from "@/lib/presence";
import type { PingEvent } from "@/lib/types";

/** Agree to (or withdraw from) location checks while clocked in. */
export async function setLocationConsent(consent: boolean) {
  const { supabase, profile } = await getSession();
  const { data, error } = await supabase.rpc("set_location_consent", { p_consent: consent });
  revalidatePath("/account");
  // Withdrawing while at a store closes the visit; tell the admins they left.
  const events = !error && !consent && Array.isArray(data) ? (data as PingEvent[]) : [];
  if (events.length) after(() => notifyPresence(events, personName(profile), profile.id));
  return { ok: !error };
}

/** One reading from the tracker. Returns nothing the phone needs; admins get pushed for each arrive/leave. */
export async function pingLocation(lat: number, lng: number, accuracy: number) {
  const { supabase, profile } = await getSession();
  if (profile.role !== "tech" || ![lat, lng, accuracy].every(Number.isFinite)) return;
  const events = await recordPing(supabase, lat, lng, accuracy, "ping");
  if (events.length) after(() => notifyPresence(events, personName(profile), profile.id));
}
