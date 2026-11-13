"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, isSuper } from "@/lib/auth";
import { saveAttachments } from "@/lib/attachments";
import { num, str } from "@/lib/format";

function fields(fd: FormData) {
  return {
    site_id: str(fd, "site_id"),
    name: str(fd, "name"),
    tag: str(fd, "tag"),
    category: str(fd, "category") ?? "Other",
    location_detail: str(fd, "location_detail"),
    manufacturer: str(fd, "manufacturer"),
    model: str(fd, "model"),
    serial_number: str(fd, "serial_number"),
    install_date: str(fd, "install_date"),
    warranty_expires_on: str(fd, "warranty_expires_on"),
    purchase_cost: num(fd, "purchase_cost"),
    expected_life_years: num(fd, "expected_life_years"),
    status: str(fd, "status") ?? "operational",
    notes: str(fd, "notes"),
  };
}

export async function saveAsset(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id");
  const back = id ? `/assets/${id}/edit` : "/assets/new";
  if (!(profile.role === "admin" || profile.role === "tech")) redirect(`${back}?error=Not+allowed`);
  const row = fields(fd);
  if (!row.site_id || !row.name) redirect(`${back}?error=Site+and+name+are+required`);

  const res = id
    ? await supabase.from("assets").update(row).eq("id", id).select("id").single()
    : await supabase.from("assets").insert(row).select("id").single();
  if (res.error || !res.data) redirect(`${back}?error=${encodeURIComponent(res.error?.message ?? "Save failed")}`);

  revalidatePath("/assets");
  redirect(`/assets/${res.data.id}`);
}

export async function deleteAsset(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  if (!isSuper(profile)) redirect(`/assets/${id}?error=Only+a+super+admin+can+delete+assets`);
  const { error } = await supabase.from("assets").delete().eq("id", id);
  if (error) redirect(`/assets/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/assets");
  redirect("/assets");
}

export async function uploadAssetFiles(fd: FormData) {
  const { supabase, profile } = await getSession();
  const id = str(fd, "id")!;
  await saveAttachments(supabase, "asset", id, profile.id, fd.getAll("files"));
  revalidatePath(`/assets/${id}`);
}
