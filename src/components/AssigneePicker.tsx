"use client";

import { useState } from "react";
import { Field, Select } from "./ui";
import { TechOptions } from "./TechOptions";
import { useT } from "@/lib/i18n/client";

type Person = { id: string; full_name: string | null; email: string | null; role?: string };

/**
 * Assign a job to a technician OR an outside vendor, never both. The choice not shown is sent as empty,
 * so switching from vendor to tech (or back) takes the job off the other one.
 */
export function AssigneePicker({
  techs,
  staff,
  vendors,
  defaultTechId,
  defaultVendorId,
  disabled,
  hint,
  noneLabel,
}: {
  techs: Person[];
  staff?: Person[];
  vendors: { id: string; name: string }[];
  defaultTechId?: string | null;
  defaultVendorId?: string | null;
  disabled?: boolean;
  hint?: string;
  /** Text for the empty option, e.g. "Unassigned". */
  noneLabel?: string;
}) {
  const t = useT();
  const [mode, setMode] = useState<"tech" | "vendor">(defaultVendorId && !defaultTechId ? "vendor" : "tech");
  const btn = (m: "tech" | "vendor", label: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        mode === m ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"
      } disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );

  return (
    <Field label={t("Assign to")} hint={hint ?? t("A technician or an outside vendor — one or the other.")}>
      <div className="mb-2 flex gap-1 rounded-lg bg-slate-100 p-1">
        {btn("tech", t("Technician"))}
        {btn("vendor", t("Vendor"))}
      </div>
      {mode === "tech" ? (
        <>
          <Select name="assigned_tech_id" defaultValue={defaultTechId ?? ""} disabled={disabled} key="tech">
            <option value="">— {noneLabel ?? t("Unassigned")} —</option>
            <TechOptions techs={techs} staff={staff} current={defaultTechId} />
          </Select>
          {!disabled && <input type="hidden" name="vendor_id" value="" />}
        </>
      ) : (
        <>
          <Select name="vendor_id" defaultValue={defaultVendorId ?? ""} disabled={disabled} key="vendor">
            <option value="">— {t("Pick a vendor")} —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          {!disabled && <input type="hidden" name="assigned_tech_id" value="" />}
        </>
      )}
    </Field>
  );
}
