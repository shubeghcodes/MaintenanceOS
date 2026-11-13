"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Badge, Card, CardHeader, Table, Td, Th, btnClass } from "@/components/ui";
import { importSites, type ImportState } from "./actions";

const TYPE_LABEL = { qsr: "QSR", dine_in: "Dine-in", cre: "CRE" } as const;

export function ImportClient() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importSites, { stage: "idle" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [intent, setIntent] = useState<"preview" | "import">("preview");
  const formRef = useRef<HTMLFormElement>(null);
  // The browser clears the file box after each submit, so keep the chosen file and resend it on Import.
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Fill in the template"
          subtitle="One location per row: Company, Store #, Name, Type and address."
          action={
            <a href="/sites/import/template" className={btnClass("secondary", "sm")}>
              <Download className="h-4 w-4" aria-hidden /> Download template
            </a>
          }
        />
        <ul className="list-disc space-y-1 py-4 pl-10 pr-5 text-sm text-slate-600">
          <li>Already have a list? Upload it as is. Columns like “Store #”, “Store Name” and “ZIP Code” are recognised; others are ignored.</li>
          <li>
            Managers and techs are invited on the <Link href="/admin/users" className="font-medium text-brand-700">Users</Link> page, where you pick their locations.
          </li>
          <li>
            <b>Company</b> puts each location in the right corporation. Use the names on the template&apos;s Companies sheet (or the Companies page). Leave it blank to use
            the company selected in the dropdown. A company that isn&apos;t found is flagged, never created.
          </li>
          <li>Re-uploading updates matching sites (by Store #, or Name). Blank cells never erase existing data. A different Company moves the site, with its work orders and history.</li>
        </ul>
      </Card>

      <form ref={formRef} action={submit}>
        <Card>
          <CardHeader title="2. Upload and check" subtitle="Excel (.xlsx) or CSV. Nothing is saved until you click Import." />
          <div className="flex flex-wrap items-center gap-3 p-5">
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
                  if (!f) return; // cancelled the picker: keep the file already chosen
                  fileRef.current = f;
                  setFileName(f.name);
                  setIntent("preview");
                  // Auto-preview as soon as a file is picked.
                  setTimeout(() => formRef.current?.requestSubmit(), 0);
                }}
              />
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
              subtitle={[
                `${state.counts.create} new`,
                `${state.counts.update} to update`,
                state.counts.skip ? `${state.counts.skip} with problems (will be skipped)` : null,
                state.counts.moves ? `${state.counts.moves} moving to another company` : null,
              ]
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
                  {pending && intent === "import" ? "Importing…" : `Import ${state.counts.create + state.counts.update} site${state.counts.create + state.counts.update === 1 ? "" : "s"}`}
                </button>
              }
            />
            {state.unknownHeaders.length > 0 && (
              <p className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500">Ignored columns: {state.unknownHeaders.join(", ")}</p>
            )}
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Row</Th>
                  <Th></Th>
                  <Th>Company</Th>
                  <Th>Store #</Th>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Address</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.rows.map((r) => (
                  <tr key={r.line} className={r.action === "skip" ? "bg-red-50/50" : ""}>
                    <Td className="tabular-nums text-slate-400">{r.line}</Td>
                    <Td>
                      {r.action === "create" && <Badge tone="good">New</Badge>}
                      {r.action === "update" && <Badge tone="info">Update</Badge>}
                      {r.action === "skip" && <Badge tone="critical">Skip</Badge>}
                    </Td>
                    <Td className="text-xs">
                      {r.companyLabel ?? (r.company ? <span className="text-red-700">{r.company}</span> : <span className="text-slate-400">—</span>)}
                      {r.companyNote && <div className={r.companyNote.startsWith("Moves") ? "font-medium text-amber-700" : "text-slate-500"}>{r.companyNote}</div>}
                      {!r.company && r.companyLabel && <div className="text-slate-400">{r.action === "update" ? "unchanged" : "selected company"}</div>}
                    </Td>
                    <Td className="font-mono text-xs">{r.code ?? "—"}</Td>
                    <Td className="font-medium text-slate-900">{r.name ?? "—"}</Td>
                    <Td>{TYPE_LABEL[r.type]}</Td>
                    <Td className="text-xs">{[r.address, r.city, r.state, r.zip].filter(Boolean).join(", ") || "—"}</Td>
                    <Td className="text-xs">
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
              <b>{state.created}</b> site{state.created === 1 ? "" : "s"} added, <b>{state.updated}</b> updated.
            </p>
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
              <Link href="/sites" className={btnClass("primary")}>
                View sites
              </Link>
              <Link href="/admin/users" className={btnClass("secondary")}>
                Invite managers &amp; techs
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
