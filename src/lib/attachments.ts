import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attachment } from "./types";

const BUCKET = "attachments";
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED = /^(image\/|application\/pdf$)/;

/** Upload files from a form and record them. Returns the ids of saved attachments (failed files are skipped). */
export async function saveAttachments(
  supabase: SupabaseClient,
  entityType: Attachment["entity_type"],
  entityId: string,
  userId: string | null,
  files: FormDataEntryValue[],
  opts: { category?: string; visibility?: "shared" | "internal"; dispatchId?: string; label?: string } = {},
) {
  const saved: string[] = [];
  for (const f of files) {
    if (!(f instanceof File) || f.size === 0 || f.size > MAX_BYTES) continue;
    if (f.type && !ALLOWED.test(f.type)) continue;
    const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `${entityType}/${entityId}/${opts.dispatchId ? `vendor-${opts.dispatchId.slice(0, 8)}/` : ""}${crypto.randomUUID()}-${safe}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined });
    if (upErr) continue;
    const { data, error } = await supabase
      .from("attachments")
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        storage_path: path,
        file_name: f.name,
        content_type: f.type || null,
        size_bytes: f.size,
        uploaded_by: userId,
        category: opts.category ?? "photo",
        visibility: opts.visibility ?? "shared",
        dispatch_id: opts.dispatchId ?? null,
        uploaded_by_label: opts.label ?? null,
      })
      .select("id")
      .single();
    if (error || !data) await supabase.storage.from(BUCKET).remove([path]);
    else saved.push(data.id as string);
  }
  return saved;
}

export function fileProblems(files: FormDataEntryValue[]) {
  const bad = files.filter((f): f is File => f instanceof File && f.size > 0 && (f.size > MAX_BYTES || (!!f.type && !ALLOWED.test(f.type))));
  return bad.length ? `${bad.map((f) => f.name).join(", ")}: only photos and PDFs up to 10 MB are accepted.` : null;
}

export type AttachmentWithUrl = Attachment & { url: string | null };

export async function listAttachments(
  supabase: SupabaseClient,
  entityType: Attachment["entity_type"],
  entityId: string,
  filter: (a: Attachment) => boolean = () => true,
): Promise<AttachmentWithUrl[]> {
  const { data } = await supabase
    .from("attachments")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  const rows = ((data ?? []) as Attachment[]).filter(filter);
  if (!rows.length) return [];
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(
    rows.map((r) => r.storage_path),
    60 * 60,
  );
  const urlFor = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({ ...r, url: urlFor.get(r.storage_path) ?? null }));
}
