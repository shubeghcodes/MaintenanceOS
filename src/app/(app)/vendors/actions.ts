"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { num, str } from "@/lib/format";
import { fileProblems, saveAttachments } from "@/lib/attachments";
import { VENDOR_DOC_TYPES } from "@/lib/constants";

export async function saveVendor(fd: FormData) {
  const { supabase, profile } = await requireRole("admin");
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
  const coi = fd.get("coi_file");
  const hasCoi = coi instanceof File && coi.size > 0;
  if (hasCoi) {
    const bad = fileProblems([coi]);
    if (bad) redirect(`${back}?error=${encodeURIComponent(bad)}`);
  }
  const res = id
    ? await supabase.from("vendors").update(row).eq("id", id).select("id").single()
    : await supabase.from("vendors").insert(row).select("id").single();
  if (res.error || !res.data) redirect(`${back}?error=${encodeURIComponent(res.error?.message ?? "Save failed")}`);
  if (hasCoi) await saveAttachments(supabase, "vendor", res.data.id, profile.id, [coi], { category: "coi", visibility: "internal", label: profile.full_name ?? undefined });
  revalidatePath("/vendors");
  redirect(`/vendors/${res.data.id}?saved=1`);
}

/** Add documents (COI, W-9, license, contract) to a vendor. Uploading a COI can also update its expiration date. */
export async function uploadVendorDocs(fd: FormData) {
  const { supabase, profile } = await requireRole("admin");
  const id = str(fd, "vendor_id")!;
  const back = `/vendors/${id}`;
  const files = fd.getAll("files").filter((f) => f instanceof File && f.size > 0);
  if (!files.length) redirect(`${back}?error=${encodeURIComponent("Choose a photo or PDF to upload")}#documents`);
  const bad = fileProblems(files);
  if (bad) redirect(`${back}?error=${encodeURIComponent(bad)}#documents`);
  const type = str(fd, "doc_type") ?? "coi";
  const category = type in VENDOR_DOC_TYPES ? type : "other";
  const saved = await saveAttachments(supabase, "vendor", id, profile.id, files, { category, visibility: "internal", label: profile.full_name ?? undefined });
  if (!saved.length) redirect(`${back}?error=${encodeURIComponent("Upload failed. Try again.")}#documents`);
  const expires = str(fd, "coi_expires_on");
  if (category === "coi" && expires) await supabase.from("vendors").update({ coi_expires_on: expires }).eq("id", id);
  revalidatePath(back);
  revalidatePath("/vendors");
  redirect(`${back}?doc=added#documents`);
}

/** Remove a vendor document (admins). */
export async function deleteVendorDoc(fd: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(fd, "vendor_id")!;
  const docId = str(fd, "doc_id")!;
  const { data: doc } = await supabase.from("attachments").select("storage_path").eq("id", docId).eq("entity_type", "vendor").eq("entity_id", id).maybeSingle();
  if (doc) {
    await supabase.from("attachments").delete().eq("id", docId);
    await supabase.storage.from("attachments").remove([(doc as { storage_path: string }).storage_path]);
  }
  revalidatePath(`/vendors/${id}`);
  redirect(`/vendors/${id}?doc=removed#documents`);
}
