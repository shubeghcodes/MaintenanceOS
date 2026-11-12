"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { num, str } from "@/lib/format";
import { autoDispatchCompliance } from "@/lib/compliance-dispatch";

export async function savePm(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "id");
  const back = id ? `/pm/${id}` : "/pm/new";
  const row = {
    title: str(fd, "title"),
    site_id: str(fd, "site_id"),
    asset_id: str(fd, "asset_id"),
    category: str(fd, "category") ?? "Other",
    instructions: str(fd, "instructions"),
    checklist: (str(fd, "checklist") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    frequency_interval: num(fd, "frequency_interval") ?? 1,
    frequency_unit: str(fd, "frequency_unit") ?? "month",
    next_due_on: str(fd, "next_due_on"),
    lead_days: num(fd, "lead_days") ?? 7,
    priority: str(fd, "priority") ?? "medium",
    assigned_tech_id: str(fd, "assigned_tech_id"),
    vendor_id: str(fd, "vendor_id"),
    estimated_hours: num(fd, "estimated_hours"),
    active: fd.get("active") === "on",
  };
  if (!row.title || !row.site_id || !row.next_due_on) redirect(`${back}?error=Title,+site+and+next+due+date+are+required`);

  const res = id
    ? await supabase.from("pm_schedules").update(row).eq("id", id).select("id").single()
    : await supabase.from("pm_schedules").insert(row).select("id").single();
  if (res.error || !res.data) redirect(`${back}?error=${encodeURIComponent(res.error?.message ?? "Save failed")}`);
  revalidatePath("/pm");
  redirect(`/pm/${res.data.id}?saved=1`);
}

export async function deletePm(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "id")!;
  const { error } = await supabase.from("pm_schedules").delete().eq("id", id);
  if (error) redirect(`/pm/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/pm");
  redirect("/pm");
}

/** Creates any PM / compliance work orders that have entered their lead window. */
export async function runScheduler(fd: FormData) {
  const { supabase, profile } = await requireRole("admin");
  const back = str(fd, "back") ?? "/pm";
  const { data, error } = await supabase.rpc("generate_due_work_orders");
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  await autoDispatchCompliance(supabase, profile.id);
  revalidatePath("/", "layout");
  redirect(`${back}?generated=${data ?? 0}`);
}
