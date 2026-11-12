"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { num, str } from "@/lib/format";

export async function saveVendor(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "id");
  const back = id ? `/vendors/${id}` : "/vendors/new";
  const row = {
    name: str(fd, "name"),
    trades: (str(fd, "trades") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    contact_name: str(fd, "contact_name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    after_hours_phone: str(fd, "after_hours_phone"),
    license_number: str(fd, "license_number"),
    coi_expires_on: str(fd, "coi_expires_on"),
    hourly_rate: num(fd, "hourly_rate"),
    rating: num(fd, "rating"),
    notes: str(fd, "notes"),
    active: fd.get("active") === "on",
  };
  if (!row.name) redirect(`${back}?error=Name+is+required`);
  const res = id
    ? await supabase.from("vendors").update(row).eq("id", id).select("id").single()
    : await supabase.from("vendors").insert(row).select("id").single();
  if (res.error || !res.data) redirect(`${back}?error=${encodeURIComponent(res.error?.message ?? "Save failed")}`);
  revalidatePath("/vendors");
  redirect(`/vendors/${res.data.id}?saved=1`);
}
