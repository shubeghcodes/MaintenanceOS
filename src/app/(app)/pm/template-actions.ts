"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { addDaysISO, num, str } from "@/lib/format";

const PHOTO_RULES = ["before_after", "single", "none"];

/** Create or update a PM template. Optionally pushes the changes to every schedule made from it. */
export async function saveTemplate(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "id");
  const back = id ? `/pm/templates/${id}` : "/pm/templates/new";
  const row = {
    name: str(fd, "name"),
    category: str(fd, "category") ?? "Other",
    instructions: str(fd, "instructions"),
    frequency_interval: num(fd, "frequency_interval") ?? 3,
    frequency_unit: str(fd, "frequency_unit") ?? "month",
    priority: str(fd, "priority") ?? "medium",
    lead_days: num(fd, "lead_days") ?? 7,
    estimated_hours: num(fd, "estimated_hours"),
    active: fd.get("active") === "on",
  };
  if (!row.name) redirect(`${back}?error=Name+is+required`);

  const res = id
    ? await supabase.from("pm_templates").update(row).eq("id", id).select("id").single()
    : await supabase.from("pm_templates").insert(row).select("id").single();
  if (res.error || !res.data) redirect(`${back}?error=${encodeURIComponent(res.error?.message ?? "Save failed")}`);

  let synced = 0;
  if (id && fd.get("sync") === "on") {
    const { data } = await supabase
      .from("pm_schedules")
      .update({
        title: row.name,
        category: row.category,
        instructions: row.instructions,
        frequency_interval: row.frequency_interval,
        frequency_unit: row.frequency_unit,
        priority: row.priority,
        lead_days: row.lead_days,
        estimated_hours: row.estimated_hours,
      })
      .eq("template_id", id)
      .select("id");
    synced = data?.length ?? 0;
  }
  revalidatePath("/pm");
  revalidatePath("/pm/templates");
  redirect(`/pm/templates/${res.data.id}?saved=1${synced ? `&synced=${synced}` : ""}`);
}

export async function saveTemplateItem(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const templateId = str(fd, "template_id")!;
  const id = str(fd, "item_id");
  const back = `/pm/templates/${templateId}`;
  const photo = str(fd, "photo_rule") ?? "before_after";
  const row = {
    activity: str(fd, "activity"),
    description: str(fd, "description"),
    photo_rule: PHOTO_RULES.includes(photo) ? photo : "before_after",
  };
  if (!row.activity) redirect(`${back}?error=Activity+name+is+required`);
  if (id) {
    const { error } = await supabase.from("pm_template_items").update(row).eq("id", id);
    if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  } else {
    const { data: last } = await supabase
      .from("pm_template_items")
      .select("position")
      .eq("template_id", templateId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase.from("pm_template_items").insert({ ...row, template_id: templateId, position: (last?.position ?? 0) + 10 });
    if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(back);
  redirect(`${back}?item=1#items`);
}

export async function deleteTemplateItem(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const templateId = str(fd, "template_id")!;
  await supabase.from("pm_template_items").delete().eq("id", str(fd, "item_id")!);
  revalidatePath(`/pm/templates/${templateId}`);
  redirect(`/pm/templates/${templateId}#items`);
}

export async function moveTemplateItem(dir: "up" | "down", fd: FormData) {
  const { supabase } = await requireRole("admin");
  const templateId = str(fd, "template_id")!;
  const itemId = str(fd, "item_id")!;
  const { data } = await supabase.from("pm_template_items").select("id,position").eq("template_id", templateId).order("position");
  const list = data ?? [];
  const i = list.findIndex((x) => x.id === itemId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < list.length) {
    [list[i], list[j]] = [list[j], list[i]];
    // Renumber so positions stay clean (10, 20, 30…).
    await Promise.all(list.map((x, k) => supabase.from("pm_template_items").update({ position: (k + 1) * 10 }).eq("id", x.id)));
  }
  revalidatePath(`/pm/templates/${templateId}`);
  redirect(`/pm/templates/${templateId}#items`);
}

/**
 * Creates schedules from one or more templates at the picked locations. A store gets one schedule per template,
 * all due the same day (one trip). With "spread", stores' first due dates are spread evenly from the start date
 * over the chosen number of weeks, so they don't all come due at once. Stores that already have an active
 * schedule from a template are skipped for that template.
 */
export async function rolloutTemplates(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const back = "/pm/templates/rollout";
  const templateIds = [...new Set((fd.getAll("template_ids") as string[]).filter(Boolean))];
  const siteIds = [...new Set((fd.getAll("site_ids") as string[]).filter(Boolean))];
  const start = str(fd, "start_on");
  const spread = fd.get("spread") === "on";
  const weeks = Math.max(1, Math.min(52, num(fd, "spread_weeks") ?? 13));
  const techId = str(fd, "assigned_tech_id");
  const qs = templateIds.map((t) => `template=${t}`).join("&");
  if (!templateIds.length || !siteIds.length || !start) redirect(`${back}?${qs}&error=Pick+templates,+locations+and+a+start+date`);

  const [{ data: tpls }, { data: sites }, { data: existing }] = await Promise.all([
    supabase.from("pm_templates").select("*").in("id", templateIds),
    supabase.from("sites").select("id,code,name").in("id", siteIds).order("code", { nullsFirst: false }).order("name"),
    supabase.from("pm_schedules").select("site_id,template_id").in("template_id", templateIds).in("site_id", siteIds).eq("active", true),
  ]);
  const have = new Set((existing ?? []).map((e) => `${e.site_id}:${e.template_id}`));
  const storeList = sites ?? [];
  const span = weeks * 7;

  const rows = storeList.flatMap((s, i) => {
    const due = spread && storeList.length > 1 ? addDaysISO(start!, Math.floor((i * span) / storeList.length)) : start!;
    return (tpls ?? [])
      .filter((t) => !have.has(`${s.id}:${t.id}`))
      .map((t) => ({
        title: t.name,
        site_id: s.id,
        template_id: t.id,
        category: t.category,
        instructions: t.instructions,
        frequency_interval: t.frequency_interval,
        frequency_unit: t.frequency_unit,
        priority: t.priority,
        lead_days: t.lead_days,
        estimated_hours: t.estimated_hours,
        next_due_on: due,
        assigned_tech_id: techId,
        active: true,
      }));
  });
  const skipped = storeList.length * (tpls?.length ?? 0) - rows.length;
  if (!rows.length) redirect(`${back}?${qs}&error=Every+picked+store+already+has+these+templates`);
  const { data, error } = await supabase.from("pm_schedules").insert(rows).select("id");
  if (error) redirect(`${back}?${qs}&error=${encodeURIComponent(error.message)}`);
  revalidatePath("/pm");
  revalidatePath("/pm/templates");
  redirect(`/pm?created=${data?.length ?? 0}${skipped ? `&skipped=${skipped}` : ""}`);
}
