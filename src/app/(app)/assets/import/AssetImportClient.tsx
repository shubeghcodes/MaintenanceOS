"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Badge, Card, CardHeader, Select, Table, Td, Th, btnClass } from "@/components/ui";
import { importAssets, type AssetImportState } from "./actions";

const STATUS_LABEL = { operational: "Operational", needs_repair: "Needs repair", down: "Down", retired: "Retired" } as const;
const fmt = (iso: string | null) => (iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(2, 4)}` : null);

export function AssetImportClient({ sites, defaultSite }: { sites: { id: string; code: string | null; name: string }[]; defaultSite: string }) {
  const [state, action, pending] = useActionState<AssetImportState, FormData>(importAssets, { stage: "idle" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [intent, setIntent] = useState<"preview" | "import">("preview");
  const [filter, setFilter] = useState<"all" | "skip">("all");
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<File | null>(null);

  const submit = (fd: FormData) => {
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) {
      if (fileRef.current) fd.set("file", fileRef.current);
    }
    action(fd);
  };
  const reset = () => {
    formRef.current?.reset();
    fileRef.current = null;
    setFileName(null);
  };
  const recheck = () => fileRef.current && setTimeout(() => (setIntent("preview"), formRef.current?.requestSubmit()), 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Get your list ready"
          subtitle="One asset per row, with the location it belongs to."
          action={
            <a href="/assets/import/template" className={btnClass("secondary", "sm")}>
              <Download className="h-4 w-4" aria-hidden /> Download template
            </a>
          }
        />
        <ul className="list-disc space-y-1 py-4 pl-10 pr-5 text-sm text-slate-600">
          <li>
            <b>Already have a list</b> (from UpKeep or another system)? Upload it as is. Columns like “Site Name”, “Serial Number”, “Barcode”, “Area Located in Restaurant”,
            “Manufacturer Name”, “Parts Names” and “Warranty Expiration Date” are recognised; anything else is listed as ignored.
          </li>
          <li>
            <b>Location</b> puts each asset at the right store: the store # (e.g. 101) or the location name as on the Sites page. The template has a dropdown of your
            locations. A location that isn&apos;t found is flagged, never created.
          </li>
          <li>Re-uploading updates assets already at that location (matched by serial #, then barcode, then name). Blank cells never erase existing data.</li>
        </ul>
      </Card>

      <form ref={formRef} action={submit}>
        <Card>
          <CardHeader title="2. Upload and check" subtitle="Excel (.xlsx) or CSV. Nothing is saved until you click Import." />
          <div className="flex flex-wrap items-end gap-3 p-5">
            <label className={btnClass("secondary") + " cursor-pointer"}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              {fileName ?? "Choose file"}
              <input
                type="file"
                name="file"
                accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (!f) return;
                  fileRef.current = f;
                  setFileName(f.name);
                  recheck();
                }}
              />
            </label>
            <label className="min-w-[16rem] flex-1 sm:max-w-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Location for rows without one (optional)</span>
              <Select name="default_site" defaultValue={defaultSite} onChange={recheck}>
                <option value="">None: rows need a Location</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code ? `#${s.code} · ${s.name}` : s.name}
                  </option>
                ))}
              </Select>
            </label>
            <button type="submit" name="intent" value="preview" onClick={() => setIntent("preview")} className={btnClass("ghost")} disabled={pending || !fileName}>
              {pending && intent === "preview" ? "Checking…" : "Check file"}
            </button>
          </div>
        </Card>

        {state.stage === "error" && (
          <div className="mt-6">
            <Alert>{state.message}</Alert>
          </div>
        )}

        {state.stage === "preview" && (
          <Card className="mt-6">
            <CardHeader
              title={`3. Review ${state.fileName}`}
              subtitle={[`${state.counts.create} new`, `${state.counts.update} to update`, state.counts.skip ? `${state.counts.skip} with problems (will be skipped)` : null]
                .filter(Boolean)
                .join(" · ")}
              action={
                <button
                  type="submit"
                  name="intent"
                  value="import"
                  onClick={() => setIntent("import")}
                  className={btnClass("primary")}
                  disabled={pending || state.counts.create + state.counts.update === 0}
                >
                  <Upload className="h-4 w-4" aria-hidden />
                  {pending && intent === "import"
                    ? "Importing…"
                    : `Import ${state.counts.create + state.counts.update} asset${state.counts.create + state.counts.update === 1 ? "" : "s"}`}
                </button>
              }
            />
            {state.bySite.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-5 py-3">
                <span className="mr-1 self-center text-xs text-slate-500">By location:</span>
                {state.bySite.map((s) => (
                  <span key={s.label} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
                    {s.label} <b className="font-semibold">{s.count}</b>
                  </span>
                ))}
              </div>
            )}
            {state.unknownHeaders.length > 0 && <p className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500">Ignored columns: {state.unknownHeaders.join(", ")}</p>}
            {state.counts.skip > 0 && (
              <div className="flex gap-3 border-b border-slate-100 px-5 py-2 text-xs">
                <button type="button" onClick={() => setFilter("all")} className={filter === "all" ? "font-semibold text-slate-900" : "text-brand-700"}>
                  All rows
                </button>
                <button type="button" onClick={() => setFilter("skip")} className={filter === "skip" ? "font-semibold text-slate-900" : "text-brand-700"}>
                  Only problems ({state.counts.skip})
                </button>
              </div>
            )}
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Row</Th>
                  <Th></Th>
                  <Th>Location</Th>
                  <Th>Name</Th>
                  <Th>Category</Th>
                  <Th>Status</Th>
                  <Th>Make / model / serial</Th>
                  <Th>Dates</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.rows
                  .filter((r) => filter === "all" || r.action === "skip")
                  .map((r) => (
                    <tr key={r.line} className={r.action === "skip" ? "bg-red-50/50" : ""}>
                      <Td className="tabular-nums text-slate-400">{r.line}</Td>
                      <Td>
                        {r.action === "create" && <Badge tone="good">New</Badge>}
                        {r.action === "update" && <Badge tone="info">Update</Badge>}
                        {r.action === "skip" && <Badge tone="critical">Skip</Badge>}
                      </Td>
                      <Td className="text-xs">
                        {r.siteLabel ?? <span className="text-red-700">{r.site ?? "—"}</span>}
                        {!r.site && r.siteLabel && <div className="text-slate-400">from the picker</div>}
                      </Td>
                      <Td>
                        <span className="font-medium text-slate-900">{r.name ?? "—"}</span>
                        {(r.location_detail || r.tag) && <div className="text-xs text-slate-500">{[r.location_detail, r.tag && `Tag ${r.tag}`].filter(Boolean).join(" · ")}</div>}
                      </Td>
                      <Td className="text-xs">{r.category}</Td>
                      <Td className="text-xs">{STATUS_LABEL[r.status]}</Td>
                      <Td className="text-xs">{[r.manufacturer, r.model, r.serial_number && `SN ${r.serial_number}`].filter(Boolean).join(" · ") || "—"}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">
                        {r.purchase_date && <div>Bought {fmt(r.purchase_date)}</div>}
                        {r.service_date && <div>Service {fmt(r.service_date)}</div>}
                        {r.warranty_expires_on && <div>Warranty {fmt(r.warranty_expires_on)}</div>}
                      </Td>
                      <Td className="text-xs">
                        {r.matchNote && <div className="text-slate-500">{r.matchNote}</div>}
                        {r.errors.map((e) => (
                          <div key={e} className="text-red-700">
                            {e}
                          </div>
                        ))}
                        {r.warnings.map((w) => (
                          <div key={w} className="text-amber-700">
                            {w}
                          </div>
                        ))}
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </Card>
        )}
      </form>

      {state.stage === "done" && (
        <Card>
          <CardHeader title="Import finished" />
          <div className="space-y-3 p-5 text-sm">
            <p>
              <b>{state.created}</b> asset{state.created === 1 ? "" : "s"} added, <b>{state.updated}</b> updated.
            </p>
            {state.bySite.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {state.bySite.map((s) => (
                  <li key={s.label} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
                    {s.label} <b className="font-semibold">{s.count}</b>
                  </li>
                ))}
              </ul>
            )}
            {state.problems.length > 0 && (
              <Alert>
                <p className="mb-1 font-medium">Not imported:</p>
                <ul className="list-disc pl-5">
                  {state.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Link href="/assets" className={btnClass("primary")}>
                View assets
              </Link>
              <button type="button" onClick={reset} className={btnClass("ghost")}>
                Import another file
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
