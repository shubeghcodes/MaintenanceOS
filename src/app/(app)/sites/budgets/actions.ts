"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuper } from "@/lib/auth";
import { str } from "@/lib/format";
import { parseAmount, parseMonth } from "@/lib/budgets";
import { parseBudgetFile } from "@/lib/budget-import";

const back = (fd: FormData, fallback: string) => {
  const b = str(fd, "back");
  return b && b.startsWith("/") && !b.startsWith("//") ? b : fallback;
};
const withParam = (url: string, k: string, v: string) => {
  const [path, hash] = url.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}${hash ? `#${hash}` : ""}`;
};

function refresh() {
  revalidatePath("/sites", "layout");
  revalidatePath("/");
}

/** Default monthly budget for one location. Blank removes the budget. */
export async function saveSiteBudget(fd: FormData) {
  const { supabase, profile } = await requireSuper();
  const siteId = str(fd, "site_id")!;
  const to = back(fd, `/sites/${siteId}`);
  const amount = parseAmount(str(fd, "monthly_amount"));
  if (Number.isNaN(amount)) redirect(withParam(to, "error", "Enter the budget as a dollar amount"));
  const { error } =
    amount == null
      ? await supabase.from("site_budgets").delete().eq("site_id", siteId)
      : await supabase.from("site_budgets").upsert({
          site_id: siteId,
          monthly_amount: amount,
          updated_at: new Date().toISOString(),
          updated_by: profile.id,
        });
  if (error) redirect(withParam(to, "error", error.message));
  refresh();
  redirect(withParam(to, "saved", "budget"));
}

/** Bulk edit from the Budgets page: one `amt_<siteId>` field per location listed in `site_ids`. */
export async function saveBudgets(fd: FormData) {
  const { supabase, profile } = await requireSuper();
  const to = back(fd, "/sites/budgets");
  const ids = (fd.getAll("site_ids") as string[]).filter(Boolean);
  const upserts: {
    site_id: string;
    monthly_amount: number;
    updated_at: string;
    updated_by: string;
  }[] = [];
  const removes: string[] = [];
  const bad: string[] = [];
  for (const id of ids) {
    const raw = str(fd, `amt_${id}`);
    const prev = str(fd, `prev_${id}`);
    if ((raw ?? "") === (prev ?? "")) continue; // unchanged
    const v = parseAmount(raw);
    if (Number.isNaN(v)) bad.push(raw ?? "");
    else if (v == null) removes.push(id);
    else
      upserts.push({
        site_id: id,
        monthly_amount: v,
        updated_at: new Date().toISOString(),
        updated_by: profile.id,
      });
  }
  if (bad.length) redirect(withParam(to, "error", `Not an amount: ${bad.slice(0, 3).join(", ")}`));
  if (upserts.length) {
    const { error } = await supabase.from("site_budgets").upsert(upserts);
    if (error) redirect(withParam(to, "error", error.message));
  }
  if (removes.length) await supabase.from("site_budgets").delete().in("site_id", removes);
  refresh();
  redirect(withParam(to, "saved", String(upserts.length + removes.length)));
}

/** A different amount for one month at one location. */
export async function saveBudgetMonth(fd: FormData) {
  const { supabase, profile } = await requireSuper();
  const siteId = str(fd, "site_id")!;
  const to = back(fd, `/sites/${siteId}`);
  const month = parseMonth(str(fd, "month"));
  const amount = parseAmount(str(fd, "amount"));
  if (!month) redirect(withParam(to, "error", "Pick a month"));
  if (amount == null || Number.isNaN(amount)) redirect(withParam(to, "error", "Enter the month's budget as a dollar amount"));
  const { error } = await supabase.from("site_budget_months").upsert({
    site_id: siteId,
    month,
    amount,
    note: str(fd, "note"),
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  });
  if (error) redirect(withParam(to, "error", error.message));
  refresh();
  redirect(withParam(to, "saved", "budget"));
}

export async function deleteBudgetMonth(fd: FormData) {
  const { supabase } = await requireSuper();
  const siteId = str(fd, "site_id")!;
  const to = back(fd, `/sites/${siteId}`);
  const month = parseMonth(str(fd, "month"));
  if (month) await supabase.from("site_budget_months").delete().eq("site_id", siteId).eq("month", month);
  refresh();
  redirect(withParam(to, "saved", "budget"));
}

export type BudgetImportState =
  | { stage: "idle" }
  | { stage: "error"; message: string }
  | {
      stage: "done";
      locations: number;
      defaults: number;
      monthsSet: number;
      monthsCleared: number;
      problems: string[];
    };

export async function importBudgets(_prev: BudgetImportState, fd: FormData): Promise<BudgetImportState> {
  const { supabase, profile } = await requireSuper();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { stage: "error", message: "Choose a file to upload." };
  if (file.size > 5 * 1024 * 1024)
    return {
      stage: "error",
      message: "That file is over 5 MB. Save it as .xlsx with only the Budgets sheet.",
    };

  let parsed: Awaited<ReturnType<typeof parseBudgetFile>>;
  try {
    parsed = await parseBudgetFile(file);
  } catch (e) {
    return {
      stage: "error",
      message: e instanceof Error ? e.message : "Couldn't read that file.",
    };
  }

  const { data: s } = await supabase.from("sites").select("id,code,name");
  const sites = (s ?? []) as {
    id: string;
    code: string | null;
    name: string;
  }[];
  const byCode = new Map(sites.filter((x) => x.code).map((x) => [x.code!.toLowerCase(), x]));
  const byName = new Map<string, (typeof sites)[number] | "dup">();
  for (const x of sites) byName.set(x.name.toLowerCase(), byName.has(x.name.toLowerCase()) ? "dup" : x);

  const problems: string[] = [];
  const now = new Date().toISOString();
  const defaults: {
    site_id: string;
    monthly_amount: number;
    updated_at: string;
    updated_by: string;
  }[] = [];
  const monthSets: {
    site_id: string;
    month: string;
    amount: number;
    updated_at: string;
    updated_by: string;
  }[] = [];
  const clears: { site_id: string; month: string }[] = [];
  const seen = new Set<string>();

  for (const r of parsed.rows) {
    const label = `Row ${r.line}${r.code || r.name ? ` (${r.code ?? r.name})` : ""}`;
    if (r.errors.length) {
      problems.push(`${label}: ${r.errors.join("; ")}. Row skipped.`);
      continue;
    }
    const byN = r.name ? byName.get(r.name.toLowerCase()) : undefined;
    const site = r.code ? byCode.get(r.code.toLowerCase()) : byN === "dup" ? undefined : byN;
    if (!site) {
      problems.push(`${label}: no matching location${!r.code && byN === "dup" ? " (several share that name; add the Store #)" : ""}. Row skipped.`);
      continue;
    }
    if (seen.has(site.id)) {
      problems.push(`${label}: ${site.name} appears more than once; only the first row was used.`);
      continue;
    }
    seen.add(site.id);
    if (r.monthly != null)
      defaults.push({
        site_id: site.id,
        monthly_amount: r.monthly,
        updated_at: now,
        updated_by: profile.id,
      });
    for (const m of r.months) {
      if (m.amount == null) clears.push({ site_id: site.id, month: m.month });
      else
        monthSets.push({
          site_id: site.id,
          month: m.month,
          amount: m.amount,
          updated_at: now,
          updated_by: profile.id,
        });
    }
  }

  for (let i = 0; i < defaults.length; i += 500) {
    const { error } = await supabase.from("site_budgets").upsert(defaults.slice(i, i + 500));
    if (error)
      return {
        stage: "error",
        message: `Saving budgets failed: ${error.message}`,
      };
  }
  for (let i = 0; i < monthSets.length; i += 500) {
    const { error } = await supabase.from("site_budget_months").upsert(monthSets.slice(i, i + 500));
    if (error)
      return {
        stage: "error",
        message: `Saving month budgets failed: ${error.message}`,
      };
  }
  // Blank month cells mean "use the monthly budget": remove any earlier amount for that month.
  const clearedBefore = new Set<string>();
  if (clears.length) {
    const siteIds = [...new Set(clears.map((c) => c.site_id))];
    for (let i = 0; i < siteIds.length; i += 200) {
      const { data } = await supabase
        .from("site_budget_months")
        .select("site_id,month")
        .in("site_id", siteIds.slice(i, i + 200))
        .in("month", parsed.months);
      for (const x of (data ?? []) as { site_id: string; month: string }[]) clearedBefore.add(`${x.site_id}|${x.month}`);
    }
    for (const c of clears.filter((c) => clearedBefore.has(`${c.site_id}|${c.month}`))) {
      await supabase.from("site_budget_months").delete().eq("site_id", c.site_id).eq("month", c.month);
    }
  }
  const monthsCleared = clears.filter((c) => clearedBefore.has(`${c.site_id}|${c.month}`)).length;
  if (!seen.size && !problems.length) problems.push("No location rows found under the header.");
  refresh();
  return {
    stage: "done",
    locations: seen.size,
    defaults: defaults.length,
    monthsSet: monthSets.length,
    monthsCleared,
    problems: problems.slice(0, 50).concat(problems.length > 50 ? [`…and ${problems.length - 50} more`] : []),
  };
}
