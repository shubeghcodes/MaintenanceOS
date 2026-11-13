"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { num, str } from "@/lib/format";

export async function saveSite(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "id");
  const back = id ? `/sites/${id}` : "/sites/new";
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
  const res = id
    ? await supabase.from("sites").update(row).eq("id", id).select("id").single()
    : await supabase.from("sites").insert(row).select("id").single();
  if (res.error || !res.data) redirect(`${back}?error=${encodeURIComponent(res.error?.message ?? "Save failed")}`);
  revalidatePath("/sites");
  redirect(`/sites/${res.data.id}?saved=1`);
}
