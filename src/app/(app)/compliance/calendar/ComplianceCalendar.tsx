"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, Mail, X } from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { clearComplianceDate, scheduleCompliance } from "../actions";

export type CalItem = {
  id: string; // requirement id
  name: string;
  site: string;
  category: string;
  next_due_on: string;
  scheduled_for: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_email: string | null;
  dispatch: string | null; // vendor status label, if emailed
  wo_id: string | null;
};
export type CalDone = { id: string; requirement_id: string; name: string; site: string; date: string; result: string; certificate_number: string | null };
export type CalVendor = { id: string; name: string; email: string | null; trades: string[] };

const TONE = {
  overdue: "border-red-300 bg-red-50 text-red-900",
  soon: "border-amber-300 bg-amber-50 text-amber-900",
  upcoming: "border-slate-200 bg-white text-slate-800",
  scheduled: "border-blue-300 bg-blue-50 text-blue-900",
  done: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

export function ComplianceCalendar({
  weeks,
  month,
  today,
  items,
  done,
  vendors,
  canEdit,
  backUrl,
}: {
  weeks: { date: string; inMonth: boolean }[][];
  month: string;
  today: string;
  items: CalItem[];
  done: CalDone[];
  vendors: CalVendor[];
  canEdit: boolean;
  backUrl: string;
}) {
  const [editing, setEditing] = useState<{ item: CalItem; date: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const daysUntil = (d: string) => Math.round((Date.parse(d + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86_400_000);
  const tone = (i: CalItem) =>
    i.scheduled_for ? "scheduled" : daysUntil(i.next_due_on) < 0 ? "overdue" : daysUntil(i.next_due_on) <= 30 ? "soon" : "upcoming";

  const byDate = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const i of items) {
      const d = i.scheduled_for ?? i.next_due_on;
      m.set(d, [...(m.get(d) ?? []), i]);
    }
    return m;
  }, [items]);
  const doneByDate = useMemo(() => {
    const m = new Map<string, CalDone[]>();
    for (const d of done) m.set(d.date, [...(m.get(d.date) ?? []), d]);
    return m;
  }, [done]);

  const needsScheduling = items
    .filter((i) => !i.scheduled_for && daysUntil(i.next_due_on) <= 60)
    .sort((a, b) => a.next_due_on.localeCompare(b.next_due_on));

  const chip = (i: CalItem, opts: { showDue?: boolean } = {}) => {
    const t = tone(i);
    return (
      <button
        key={i.id}
        type="button"
        draggable={canEdit}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", i.id);
          setDragId(i.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOver(null);
        }}
        onClick={() => (canEdit ? setEditing({ item: i, date: i.scheduled_for ?? i.next_due_on }) : (window.location.href = `/compliance/${i.id}`))}
        className={clsx(
          "block w-full rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition hover:shadow",
          TONE[t],
          canEdit && "cursor-grab active:cursor-grabbing",
          dragId === i.id && "opacity-40",
        )}
        title={`${i.name} · ${i.site}${i.vendor_name ? ` · ${i.vendor_name}` : ""}`}
      >
        <span className="block truncate font-semibold">{i.name}</span>
        <span className="flex items-center gap-1 truncate opacity-80">
          {i.site}
          {t === "scheduled" && <span>· due {i.next_due_on.slice(5).replace("-", "/")}</span>}
          {opts.showDue && <span>· due {i.next_due_on.slice(5).replace("-", "/")}</span>}
          {i.dispatch && <Mail className="ml-auto h-3 w-3 flex-none" aria-label={`Vendor: ${i.dispatch}`} />}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4 2xl:flex-row">
      <div className="min-w-0 flex-1">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid min-w-[760px] grid-cols-7">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="border-b border-slate-200 bg-slate-50 px-2 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                {d}
              </div>
            ))}
            {weeks.flat().map(({ date, inMonth }) => {
              const list = byDate.get(date) ?? [];
              const fin = doneByDate.get(date) ?? [];
              return (
                <div
                  key={date}
                  data-day={date}
                  onDragOver={(e) => {
                    if (!canEdit) return;
                    e.preventDefault();
                    if (over !== date) setOver(date);
                  }}
                  onDragLeave={() => setOver((o) => (o === date ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const item = items.find((x) => x.id === dragId);
                    setOver(null);
                    setDragId(null);
                    if (item) setEditing({ item, date });
                  }}
                  className={clsx(
                    "min-h-[104px] border-b border-r border-slate-100 p-1.5",
                    !inMonth && "bg-slate-50/70",
                    over === date && "bg-brand-50 ring-2 ring-inset ring-brand-500",
                  )}
                >
                  <p className={clsx("mb-1 text-xs", date === today ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-semibold text-white" : inMonth ? "font-medium text-slate-700" : "text-slate-400")}>
                    {Number(date.slice(8))}
                  </p>
                  <div className="space-y-1">
                    {list.map((i) => chip(i))}
                    {fin.map((d) => (
                      <Link
                        key={d.id}
                        href={`/compliance/${d.requirement_id}`}
                        className={clsx("flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] leading-tight", d.result === "fail" ? "border-red-200 bg-red-50 text-red-900" : TONE.done)}
                        title={`Completed${d.certificate_number ? ` · cert ${d.certificate_number}` : ""}`}
                      >
                        <CheckCircle2 className="h-3 w-3 flex-none" aria-hidden />
                        <span className="truncate">
                          {d.name} · {d.site}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <Legend cls={TONE.overdue} label="Overdue" />
          <Legend cls={TONE.soon} label="Due within 30 days" />
          <Legend cls={TONE.upcoming} label="Due later" />
          <Legend cls={TONE.scheduled} label="Scheduled service date" />
          <Legend cls={TONE.done} label="Completed" />
          <span className="flex items-center gap-1">
            <Mail className="h-3 w-3" aria-hidden /> emailed to vendor
          </span>
          {canEdit && <span className="text-slate-500">Drag an item to a day, or click it, to schedule.</span>}
        </div>
      </div>

      <aside className="2xl:w-72 2xl:flex-none">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold">Needs a service date</p>
            <p className="text-xs text-slate-500">Overdue or due within 60 days, not yet scheduled</p>
          </div>
          <div className="grid max-h-[70vh] grid-cols-1 gap-1.5 overflow-y-auto p-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-1">
            {needsScheduling.length === 0 ? <p className="px-2 py-6 text-center text-xs text-slate-500">Everything coming due is scheduled.</p> : needsScheduling.map((i) => chip(i, { showDue: true }))}
          </div>
        </div>
      </aside>

      {editing && (
        <ScheduleDialog
          key={`${editing.item.id}-${editing.date}`}
          item={editing.item}
          date={editing.date}
          vendors={vendors}
          backUrl={backUrl}
          month={month}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={clsx("h-3 w-3 rounded border", cls)} /> {label}
    </span>
  );
}

function ScheduleDialog({
  item,
  date,
  vendors,
  backUrl,
  onClose,
}: {
  item: CalItem;
  date: string;
  vendors: CalVendor[];
  backUrl: string;
  month: string;
  onClose: () => void;
}) {
  const [vendorId, setVendorId] = useState(item.vendor_id ?? "");
  const vendor = vendors.find((v) => v.id === vendorId);
  const [email, setEmail] = useState(item.vendor_id === vendorId ? (item.vendor_email ?? "") : (vendor?.email ?? ""));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Schedule compliance service</p>
            <p className="text-base font-semibold text-slate-900">{item.name}</p>
            <p className="text-xs text-slate-500">
              {item.site} · due {item.next_due_on}
              {item.dispatch && ` · vendor: ${item.dispatch.toLowerCase()}`}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form action={scheduleCompliance} className="space-y-3 px-5 py-4">
          <input type="hidden" name="requirement_id" value={item.id} />
          <input type="hidden" name="back" value={backUrl} />
          <Field label="Service date">
            <Input type="date" name="date" required defaultValue={date} />
          </Field>
          <Field label="Vendor">
            <Select
              name="vendor_id"
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                setEmail(vendors.find((v) => v.id === e.target.value)?.email ?? "");
              }}
            >
              <option value="">— In-house / no vendor —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.trades.length ? ` — ${v.trades.join(", ")}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          {vendorId && (
            <>
              <Field label="Vendor email" hint={vendor?.email ? undefined : "Not in the directory yet. It will be used for this job only."}>
                <Input type="email" name="contact_email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dispatch@vendor.com" />
              </Field>
              <Field label="Note to vendor (optional)">
                <Textarea name="note" rows={2} placeholder="e.g. Please arrive before 10am, store opens at 11." />
              </Field>
              <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                <input type="checkbox" name="send" defaultChecked={!!email} className="mt-0.5 rounded border-slate-300" />
                <span>
                  <b>Email the work order to the vendor now</b>
                  <span className="block text-xs text-slate-500">
                    They get a secure link to accept, complete, and upload the certificate. If they already have this job, they&rsquo;re emailed the new date instead.
                  </span>
                </span>
              </label>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <SubmitButton pendingText="Scheduling…">Schedule</SubmitButton>
            {item.scheduled_for && (
              <SubmitButton variant="ghost" formAction={clearComplianceDate}>
                Clear date
              </SubmitButton>
            )}
            <Link href={`/compliance/${item.id}`} className="ml-auto text-sm text-brand-700 hover:underline">
              Open requirement
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
