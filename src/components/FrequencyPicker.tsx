"use client";

import { useState } from "react";
import { FREQ_UNIT_LABEL } from "@/lib/constants";
import type { FreqUnit } from "@/lib/types";
import { Field, Input, Select } from "./ui";

const PRESETS: { label: string; n: number; unit: FreqUnit }[] = [
  { label: "Weekly", n: 1, unit: "week" },
  { label: "Every 2 weeks", n: 2, unit: "week" },
  { label: "Every 28 days", n: 28, unit: "day" },
  { label: "Monthly", n: 1, unit: "month" },
  { label: "Quarterly", n: 3, unit: "month" },
  { label: "Every 6 months", n: 6, unit: "month" },
  { label: "Yearly", n: 1, unit: "year" },
];

/** How often a PM repeats: quick picks (incl. every 28 days) or any number of days/weeks/months/years. */
export function FrequencyPicker({ interval, unit }: { interval?: number; unit?: FreqUnit }) {
  const [n, setN] = useState(String(interval ?? 1));
  const [u, setU] = useState<FreqUnit>(unit ?? "month");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const on = Number(n) === p.n && u === p.unit;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setN(String(p.n));
                setU(p.unit);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                on ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Every">
          <Input type="number" min={1} name="frequency_interval" required value={n} onChange={(e) => setN(e.target.value)} />
        </Field>
        <Field label="Unit">
          <Select name="frequency_unit" value={u} onChange={(e) => setU(e.target.value as FreqUnit)}>
            {Object.entries(FREQ_UNIT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}(s)
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}
