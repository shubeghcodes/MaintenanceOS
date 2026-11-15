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

  if (!id) {
    // New schedules: one per picked location.
    const siteIds = [...new Set([...(fd.getAll("site_ids") as string[]), row.site_id ?? ""].filter(Boolean))];
    if (!row.title || !siteIds.length || !row.next_due_on) redirect(`${back}?error=Title,+at+least+one+location+and+next+due+date+are+required`);
    // An asset belongs to one location, so it only applies when exactly one location is picked.
    const assetId = siteIds.length === 1 ? row.asset_id : null;
    const rows = siteIds.map((site_id) => ({ ...row, site_id, asset_id: assetId }));
    const { data, error } = await supabase.from("pm_schedules").insert(rows).select("id");
    if (error || !data?.length) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Save failed")}`);
    revalidatePath("/pm");
    if (data.length === 1) redirect(`/pm/${data[0].id}?saved=1`);
    redirect(`/pm?created=${data.length}`);
  }

  if (!row.title || !row.site_id || !row.next_due_on) redirect(`${back}?error=Title,+site+and+next+due+date+are+required`);
  const res = await supabase.from("pm_schedules").update(row).eq("id", id).select("id").single();
  if (res.error || !res.data) redirect(`${back}?error=${encodeURIComponent(res.error?.message ?? "Save failed")}`);
  revalidatePath("/pm");
  redirect(`/pm/${res.data.id}?saved=1`);
}

/** Copies an existing schedule to other locations (site-wide, since assets belong to one location). */
export async function copyPm(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "id")!;
  const back = `/pm/${id}`;
  const { data: src, error: srcErr } = await supabase.from("pm_schedules").select("*").eq("id", id).single();
  if (srcErr || !src) redirect(`${back}?error=${encodeURIComponent(srcErr?.message ?? "Schedule not found")}`);

  const siteIds = [...new Set((fd.getAll("site_ids") as string[]).filter((s) => s && s !== src.site_id))];
  if (!siteIds.length) redirect(`${back}?error=Pick+at+least+one+other+location`);
  const nextDue = str(fd, "next_due_on") ?? src.next_due_on;

  const rows = siteIds.map((site_id) => ({
    title: src.title,
    template_id: src.template_id,
    site_id,
    asset_id: null,
    category: src.category,
    instructions: src.instructions,
    checklist: src.checklist,
    frequency_interval: src.frequency_interval,
    frequency_unit: src.frequency_unit,
    next_due_on: nextDue,
    lead_days: src.lead_days,
    priority: src.priority,
    assigned_tech_id: src.assigned_tech_id,
    vendor_id: src.vendor_id,
    estimated_hours: src.estimated_hours,
    active: src.active,
  }));
  const { data, error } = await supabase.from("pm_schedules").insert(rows).select("id");
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/pm");
  redirect(`/pm?created=${data?.length ?? 0}`);
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
