"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { num, str } from "@/lib/format";

export async function saveSite(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "id");
  const back = id ? `/sites/${id}/edit` : "/sites/new";
  const row = {
    code: str(fd, "code"),
    name: str(fd, "name"),
    type: str(fd, "type") ?? "qsr",
    brand: str(fd, "brand"),
    address: str(fd, "address"),
    city: str(fd, "city"),
    state: str(fd, "state"),
    zip: str(fd, "zip"),
    phone: str(fd, "phone"),
    sq_ft: num(fd, "sq_ft"),
    notes: str(fd, "notes"),
    active: fd.get("active") === "on",
    ...(str(fd, "company_id") ? { company_id: str(fd, "company_id") } : {}),
  };
  if (!row.name) redirect(`${back}?error=Name+is+required`);
  const lat = num(fd, "latitude");
  const lng = num(fd, "longitude");
  const radius = num(fd, "geofence_radius_m") ?? 150;
  if ((lat == null) !== (lng == null)) redirect(`${back}?error=Enter+both+latitude+and+longitude,+or+leave+both+blank`);
  if ((lat != null && (lat < -90 || lat > 90)) || (lng != null && (lng < -180 || lng > 180))) redirect(`${back}?error=Latitude+or+longitude+is+out+of+range`);
  if (!Number.isInteger(radius) || radius < 50 || radius > 2000) redirect(`${back}?error=Geofence+radius+must+be+a+whole+number+from+50+to+2000+metres`);
  Object.assign(row, { latitude: lat, longitude: lng, geofence_radius_m: radius });
  const res = id
    ? await supabase.from("sites").update(row).eq("id", id).select("id").single()
    : await supabase.from("sites").insert(row).select("id").single();
  if (res.error || !res.data) redirect(`${back}?error=${encodeURIComponent(res.error?.message ?? "Save failed")}`);
  revalidatePath("/sites");
  redirect(`/sites/${res.data.id}?saved=1`);
}
