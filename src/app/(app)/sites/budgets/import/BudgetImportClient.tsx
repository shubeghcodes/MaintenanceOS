"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Download, Upload } from "lucide-react";
import { Alert, Card, CardHeader, btnClass } from "@/components/ui";
import { importBudgets, type BudgetImportState } from "../actions";

export function BudgetImportClient() {
  const [state, action, pending] = useActionState<BudgetImportState, FormData>(importBudgets, { stage: "idle" });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Download your budgets"
          subtitle="A spreadsheet of your locations (for the company selected) with their current budgets."
          action={
            <a href="/sites/budgets/template" className={btnClass("secondary", "sm")}>
              <Download className="h-4 w-4" aria-hidden /> Download
            </a>
          }
        />
        <ul className="list-disc space-y-1 py-4 pl-10 pr-5 text-sm text-slate-600">
          <li>
            <b>Monthly budget</b> is each location&apos;s normal R&amp;M budget per month, labor included. Leave it blank to keep the current one.
          </li>
          <li>
            The <b>month columns</b> (next 12 months) are only for months that differ, like a bigger summer HVAC month. A blank month uses the monthly budget,
            and clears any amount set earlier for that month.
          </li>
          <li>Rows are matched by Store # (or Location name when there&apos;s no Store #), so leave those columns as they are.</li>
        </ul>
      </Card>

      <form action={action}>
        <Card>
          <CardHeader title="2. Upload" subtitle="Excel (.xlsx) or CSV. Budgets are saved as soon as you upload." />
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <input
              type="file"
              name="file"
              accept=".xlsx,.xlsm,.csv"
              className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
            />
            <button type="submit" disabled={pending} className={btnClass("primary")}>
              <Upload className="h-4 w-4" aria-hidden /> {pending ? "Importing…" : "Import budgets"}
            </button>
          </div>
        </Card>
      </form>

      {state.stage === "error" && <Alert>{state.message}</Alert>}
      {state.stage === "done" && (
        <Card>
          <CardHeader title="Done" />
          <div className="space-y-3 px-5 py-4 text-sm">
            <p>
              Updated <b>{state.locations}</b> location
              {state.locations === 1 ? "" : "s"}: {state.defaults} monthly budget{state.defaults === 1 ? "" : "s"} set, {state.monthsSet} month amount
              {state.monthsSet === 1 ? "" : "s"} set
              {state.monthsCleared ? `, ${state.monthsCleared} month amount${state.monthsCleared === 1 ? "" : "s"} cleared` : ""}.
            </p>
            {state.problems.length > 0 && (
              <div className="rounded-lg bg-amber-50 px-4 py-3 text-amber-900 ring-1 ring-inset ring-amber-200">
                <p className="font-medium">Some rows need attention:</p>
                <ul className="mt-1 list-disc pl-5">
                  {state.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            <Link href="/sites/budgets" className={btnClass("secondary", "sm")}>
              View budgets
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
