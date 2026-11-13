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

  const reset = () => {
    formRef.current?.reset();
    setFileName(null);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Fill in the template"
          subtitle="One location per row. Store #, Name, Type, address, and the manager’s email."
          action={
            <a href="/sites/import/template" className={btnClass("secondary", "sm")}>
              <Download className="h-4 w-4" aria-hidden /> Download template
            </a>
          }
        />
        <ul className="list-disc space-y-1 py-4 pl-10 pr-5 text-sm text-slate-600">
          <li>Already have a list? Upload it as is. Columns like “Store #”, “Store Name”, “ZIP Code” and “GM Email” are recognised.</li>
          <li>
            <b>Manager Email</b> gives that person access to that location only. Several managers? Separate emails with commas. One manager over several stores? Use the same email on each row.
          </li>
          <li>Re-uploading updates matching sites (by Store #, or Name). Blank cells never erase existing data.</li>
        </ul>
      </Card>

      <form ref={formRef} action={action}>
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
                required
                onChange={(e) => {
                  setFileName(e.target.files?.[0]?.name ?? null);
                  setIntent("preview");
                  // Auto-preview as soon as a file is picked.
                  if (e.target.files?.[0]) setTimeout(() => formRef.current?.requestSubmit(), 0);
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
                state.counts.newManagers ? `${state.counts.newManagers} new manager${state.counts.newManagers === 1 ? "" : "s"} to invite` : null,
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
                  <Th>Store #</Th>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Address</Th>
                  <Th>Managers</Th>
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
                    <Td className="font-mono text-xs">{r.code ?? "—"}</Td>
                    <Td className="font-medium text-slate-900">{r.name ?? "—"}</Td>
                    <Td>{TYPE_LABEL[r.type]}</Td>
                    <Td className="text-xs">{[r.address, r.city, r.state, r.zip].filter(Boolean).join(", ") || "—"}</Td>
                    <Td className="text-xs">
                      {r.managerNotes.length ? r.managerNotes.map((n) => <div key={n}>{n}</div>) : <span className="text-slate-400">None</span>}
                    </Td>
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
              <b>{state.created}</b> site{state.created === 1 ? "" : "s"} added, <b>{state.updated}</b> updated, <b>{state.assigned}</b> manager assignment
              {state.assigned === 1 ? "" : "s"} made.
            </p>
            {state.invited.length > 0 && (
              <p className="text-emerald-800">Invite emails sent to: {state.invited.join(", ")}</p>
            )}
            {state.createdNoEmail.length > 0 && (
              <Alert tone="warning">
                Logins created but the invite email couldn’t be sent (usually the email limit) for: {state.createdNoEmail.join(", ")}. Their sites are assigned. They can
                sign in with “Email me a link” on the sign-in page once email is set up.
              </Alert>
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
              <Link href="/sites" className={btnClass("primary")}>
                View sites
              </Link>
              <Link href="/admin/users" className={btnClass("secondary")}>
                Review managers
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
