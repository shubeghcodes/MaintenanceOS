import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./supabase/admin";
import { pushToUsers } from "./push";
import type { PingEvent } from "./types";

/**
 * Sends a location reading to record_location_ping() and returns the arrive/leave events it created.
 * Never throws: location must not break whatever the tech was doing.
 */
export async function recordPing(
  supabase: SupabaseClient,
  lat: number | null,
  lng: number | null,
  accuracy: number | null,
  source: "ping" | "clock_in" | "clock_out",
): Promise<PingEvent[]> {
  try {
    const { data, error } = await supabase.rpc("record_location_ping", { p_lat: lat, p_lng: lng, p_accuracy_m: accuracy, p_source: source });
    if (error || !Array.isArray(data)) return [];
    return data as PingEvent[];
  } catch {
    return [];
  }
}

/**
 * Push every active admin who can see the store (super admins and unrestricted admins see all stores;
 * company-limited admins only the companies they manage), one push per arrive/leave.
 */
export async function notifyPresence(events: PingEvent[], techName: string, techId: string) {
  if (!events.length) return;
  try {
    const db = createAdminClient();
    const [{ data: admins }, { data: limits }, { data: sites }] = await Promise.all([
      db.from("profiles").select("id").eq("role", "admin").eq("active", true),
      db.from("admin_companies").select("user_id,company_id"),
      db.from("sites").select("id,company_id").in("id", [...new Set(events.map((e) => e.site_id))]),
    ]);
    const companyOf = new Map((sites ?? []).map((s) => [s.id as string, s.company_id as string | null]));
    const limited = new Map<string, Set<string>>();
    for (const l of limits ?? []) limited.set(l.user_id, (limited.get(l.user_id) ?? new Set()).add(l.company_id));
    for (const e of events) {
      const co = companyOf.get(e.site_id);
      const ids = (admins ?? [])
        .map((a) => a.id as string)
        .filter((id) => !limited.has(id) || (!!co && limited.get(id)!.has(co)));
      await pushToUsers(ids, {
        title: `${techName} ${e.kind === "enter" ? "arrived at" : "left"} ${e.site_name}`,
        url: `/admin/users/${techId}`,
        tag: `presence-${techId}-${e.site_id}`,
      }).catch(() => undefined);
    }
  } catch {
    /* push is best-effort */
  }
}
