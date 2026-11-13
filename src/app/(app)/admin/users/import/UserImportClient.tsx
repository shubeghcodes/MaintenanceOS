"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Badge, Card, CardHeader, Table, Td, Th, btnClass } from "@/components/ui";
import { importUsers, type UserImportState } from "./actions";

const ROLE = { manager: "Manager", tech: "Tech", admin: "Admin" } as const;

export function UserImportClient() {
  const [state, action, pending] = useActionState<UserImportState, FormData>(importUsers, { stage: "idle" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [intent, setIntent] = useState<"preview" | "import">("preview");
  const formRef = useRef<HTMLFormElement>(null);
  // The browser clears the file box after each submit, so keep the chosen file and resend it on Import.
  const fileRef = useRef<File | null>(null);

  const submit = (fd: FormData) => {
    const f = fd.get("file");
    if ((!(f instanceof File) || f.size === 0) && fileRef.current) fd.set("file", fileRef.current);
    action(fd);
  };
  const reset = () => {
    formRef.current?.reset();
    fileRef.current = null;
    setFileName(null);
  };
  const ready = state.stage === "preview" ? state.counts.invite + state.counts.update : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Fill in the template"
          subtitle="One person per row: Email, Name, Role and their Store #(s)."
          action={
            <a href="/admin/users/import/template" className={btnClass("secondary", "sm")}>
              <Download className="h-4 w-4" aria-hidden /> Download template
            </a>
          }
        />
        <ul className="list-disc space-y-1 py-4 pl-10 pr-5 text-sm text-slate-600">
          <li>
            <b>Store #</b> connects the person to those locations. Several? Separate with commas (DT-1450, DT-1451). The template&apos;s <b>Stores</b> sheet lists every
            code. <b>ALL</b> gives every location, or every location in the <b>Company</b> column if you fill it in.
          </li>
          <li>
            <b>Role</b>: Manager (default), Tech or Admin. Admins see every location. Optional <b>Hourly Rate</b> sets a tech&apos;s labor rate from today.
          </li>
          <li>New emails get an invite to set a password. People already in MaintenanceOS are updated instead: blank cells never erase anything, and stores are only added.</li>
          <li>Already have a list? Upload it as is. Columns like “GM Email”, “Employee Name”, “Position” and “Store Number” are recognised.</li>
        </ul>
      </Card>

      <form ref={formRef} action={submit}>
        <Card>
          <CardHeader title="2. Upload and check" subtitle="Excel (.xlsx) or CSV. Nobody is invited until you click Import." />
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
                  if (!f) return;
                  fileRef.current = f;
                  setFileName(f.name);
                  setIntent("preview");
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
                `${state.counts.invite} to invite`,
                `${state.counts.update} already in MaintenanceOS`,
                `${state.counts.assignments} location assignment${state.counts.assignments === 1 ? "" : "s"}`,
                state.counts.skip ? `${state.counts.skip} with problems (will be skipped)` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              action={
                <button type="submit" name="intent" value="import" onClick={() => setIntent("import")} className={btnClass("primary")} disabled={pending || ready === 0}>
                  <Upload className="h-4 w-4" aria-hidden />
                  {pending && intent === "import" ? "Importing…" : `Import ${ready} ${ready === 1 ? "person" : "people"}`}
                </button>
              }
            />
            {state.unknownHeaders.length > 0 && <p className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500">Ignored columns: {state.unknownHeaders.join(", ")}</p>}
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Row</Th>
                  <Th></Th>
                  <Th>Email</Th>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Locations</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.rows.map((r) => (
                  <tr key={r.line} className={r.action === "skip" ? "bg-red-50/50" : ""}>
                    <Td className="tabular-nums text-slate-400">{r.line}</Td>
                    <Td>
                      {r.action === "invite" && <Badge tone="good">Invite</Badge>}
                      {r.action === "update" && <Badge tone="info">Update</Badge>}
                      {r.action === "skip" && <Badge tone="critical">Skip</Badge>}
                    </Td>
                    <Td className="text-xs">{r.email ?? "—"}</Td>
                    <Td className="font-medium text-slate-900">{r.name ?? "—"}</Td>
                    <Td>
                      {ROLE[r.role]}
                      {r.hourly_rate != null && <div className="text-xs text-slate-500">${r.hourly_rate.toFixed(2)}/hr</div>}
                    </Td>
                    <Td className="max-w-[16rem] text-xs">{r.storesLabel}</Td>
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
                      {r.notes.map((n) => (
                        <div key={n} className="text-slate-600">
                          {n}
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
              <b>{state.invited.length + state.createdNoEmail.length}</b> new {state.invited.length + state.createdNoEmail.length === 1 ? "person" : "people"}, <b>{state.updated}</b>{" "}
              updated, <b>{state.assigned}</b> location assignment{state.assigned === 1 ? "" : "s"}
              {state.rates ? (
                <>
                  , <b>{state.rates}</b> labor rate{state.rates === 1 ? "" : "s"} set
                </>
              ) : null}
              .
            </p>
            {state.invited.length > 0 && <p className="text-emerald-800">Invite emails sent to: {state.invited.join(", ")}</p>}
            {state.createdNoEmail.length > 0 && (
              <Alert tone="warning">
                Logins created and locations set, but the invite email couldn’t be sent (usually the email sending limit) for: {state.createdNoEmail.join(", ")}. Resend
                their invites later from Users → By location → Invite (same email), or they can use “Email me a link” on the sign-in page.
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
              <Link href="/admin/users" className={btnClass("primary")}>
                View users
              </Link>
              <Link href="/admin/users?view=sites" className={btnClass("secondary")}>
                See people by location
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
