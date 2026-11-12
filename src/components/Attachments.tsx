import { FileText, Paperclip } from "lucide-react";
import { Card, CardHeader } from "./ui";
import { SubmitButton } from "./SubmitButton";
import { PhotoInput } from "./PhotoInput";
import type { AttachmentWithUrl } from "@/lib/attachments";
import { fmtDate } from "@/lib/format";

export function Attachments({
  items,
  action,
  hidden,
  title = "Photos & files",
  allowInternal = false,
  categories = false,
}: {
  items: AttachmentWithUrl[];
  action?: (fd: FormData) => Promise<void>;
  hidden?: Record<string, string>;
  title?: string;
  allowInternal?: boolean;
  categories?: boolean;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={`${items.length} file${items.length === 1 ? "" : "s"}`} />
      <div className="p-5">
        {items.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {items.map((a) => (
              <li key={a.id}>
                <a href={a.url ?? "#"} target="_blank" rel="noreferrer" className="group block">
                  {a.content_type?.startsWith("image/") && a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.file_name} className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-200 group-hover:opacity-90" />
                  ) : (
                    <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg bg-slate-50 ring-1 ring-slate-200 group-hover:bg-slate-100">
                      <FileText className="h-6 w-6 text-slate-400" aria-hidden />
                    </div>
                  )}
                  <p className="mt-1 truncate text-xs text-slate-700">{a.file_name}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {a.category && a.category !== "photo" && <span className="mr-1 font-medium capitalize text-slate-600">{a.category}</span>}
                    {a.visibility === "internal" && <span className="mr-1 font-medium text-amber-700">Internal</span>}
                    {a.uploaded_by_label ? `${a.uploaded_by_label} · ` : ""}
                    {fmtDate(a.created_at)}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No files yet.</p>
        )}
        {action && (
          <form action={action} className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label className="flex flex-1 items-center gap-2 text-sm text-slate-600">
              <Paperclip className="h-4 w-4 text-slate-400" aria-hidden />
              <PhotoInput name="files" />
            </label>
            {categories && (
              <select name="category" defaultValue="photo" className="rounded-md border-0 py-1 pl-2 pr-7 text-xs ring-1 ring-slate-300" aria-label="File type">
                <option value="photo">Photo</option>
                <option value="certificate">Certificate</option>
                <option value="document">Document</option>
                <option value="invoice">Invoice</option>
              </select>
            )}
            {allowInternal && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600" title="Hidden from outside vendors">
                <input type="checkbox" name="internal" className="rounded border-slate-300" /> Internal only
              </label>
            )}
            <SubmitButton size="sm" variant="secondary" pendingText="Uploading…">Upload</SubmitButton>
          </form>
        )}
      </div>
    </Card>
  );
}
