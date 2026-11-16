import { Download, FileText } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAttachments } from "@/lib/attachments";
import { VENDOR_DOC_TYPES } from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import { Badge, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { PhotoInput } from "@/components/PhotoInput";
import { deleteVendorDoc, uploadVendorDocs } from "../actions";

/** Certificates of insurance and other paperwork for a vendor: view, download, upload (admins). */
export async function VendorDocuments({ supabase, vendorId, isAdmin, coiExpires }: { supabase: SupabaseClient; vendorId: string; isAdmin: boolean; coiExpires: string | null }) {
  const docs = await listAttachments(supabase, "vendor", vendorId);
  const latestCoi = docs.find((d) => d.category === "coi");
  const dl = (url: string, name: string) => `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;

  return (
    <Card id="documents" className="scroll-mt-6">
      <CardHeader
        title="Documents"
        subtitle={latestCoi ? `Latest COI uploaded ${fmtDate(latestCoi.created_at)}` : "No certificate of insurance on file yet"}
      />
      {docs.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {docs.map((d) => {
            const isImg = d.content_type?.startsWith("image/");
            return (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <a href={d.url ?? "#"} target="_blank" rel="noreferrer" className="shrink-0" title="Open">
                  {isImg && d.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.url} alt="" className="h-12 w-12 rounded-md object-cover ring-1 ring-slate-200" />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-50 ring-1 ring-slate-200">
                      <FileText className="h-5 w-5 text-slate-400" aria-hidden />
                    </span>
                  )}
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={d.url ?? "#"} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-slate-900 hover:text-brand-700">
                      {d.file_name}
                    </a>
                    <Badge tone={d.category === "coi" ? "info" : "neutral"} dot={false}>
                      {VENDOR_DOC_TYPES[d.category ?? "other"] ?? "Other"}
                    </Badge>
                    {d.id === latestCoi?.id && coiExpires && <span className="text-xs text-slate-500">expires {fmtDate(coiExpires)}</span>}
                  </div>
                  <p className="text-xs text-slate-400">
                    {d.uploaded_by_label ? `${d.uploaded_by_label} · ` : ""}
                    {fmtDate(d.created_at)}
                  </p>
                </div>
                {d.url && (
                  <a
                    href={dl(d.url, d.file_name)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                  >
                    <Download className="h-4 w-4" aria-hidden /> Download
                  </a>
                )}
                {isAdmin && (
                  <form action={deleteVendorDoc}>
                    <input type="hidden" name="vendor_id" value={vendorId} />
                    <input type="hidden" name="doc_id" value={d.id} />
                    <SubmitButton size="sm" variant="ghost" confirm={`Delete ${d.file_name}? This can't be undone.`}>
                      Delete
                    </SubmitButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {isAdmin && (
        <form action={uploadVendorDocs} className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-3">
          <input type="hidden" name="vendor_id" value={vendorId} />
          <Field label="Document">
            <Select name="doc_type" defaultValue="coi">
              {Object.entries(VENDOR_DOC_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="COI expires" hint="Updates the vendor's COI date (COI only)">
            <Input type="date" name="coi_expires_on" />
          </Field>
          <Field label="Photo or PDF">
            <PhotoInput name="files" accept="image/*,application/pdf" />
          </Field>
          <div className="sm:col-span-3">
            <SubmitButton size="sm" pendingText="Uploading…">
              Upload
            </SubmitButton>
          </div>
        </form>
      )}
      {!isAdmin && docs.length === 0 && <p className="px-5 pb-5 text-sm text-slate-500">No documents yet.</p>}
    </Card>
  );
}
