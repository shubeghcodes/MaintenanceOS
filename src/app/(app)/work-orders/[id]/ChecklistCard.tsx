"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ChevronDown, Loader2, Wrench, X } from "lucide-react";
import { setChecklistResult, uploadChecklistPhoto } from "../checklist-actions";

export type ChecklistItem = {
  id: string;
  activity: string;
  description: string | null;
  photo_rule: "before_after" | "single" | "none";
  result: "ok" | "needs_repair" | "na" | null;
  note: string | null;
  before_url: string | null;
  after_url: string | null;
  followup: { id: string; number: number } | null;
  completed_by_name: string | null;
  completed_at: string | null;
  done: boolean;
};

const RESULT_LABEL = { ok: "OK", needs_repair: "Needs repair", na: "N/A" } as const;

/** Checklist photos are shrunk harder than other uploads: ~1280px JPEG, usually 150–350 KB. */
async function shrink(f: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.72));
    if (!blob) return f;
    return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } catch {
    return f;
  }
}

export function ChecklistCard({ items, editable }: { items: ChecklistItem[]; editable: boolean }) {
  const done = items.filter((i) => i.done).length;
  const firstOpen = items.find((i) => !i.done)?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(editable ? firstOpen : null);
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">PM checklist</h2>
          <span className={`text-xs font-medium ${done === items.length ? "text-emerald-700" : "text-slate-600"}`}>
            {done} of {items.length} done
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${done === items.length ? "bg-emerald-500" : "bg-brand-600"}`} style={{ width: `${pct}%` }} />
        </div>
        {editable && done < items.length && (
          <p className="mt-2 text-xs text-slate-500">
            Each activity needs its photos and a result before this PM can be completed. Mark N/A (with a reason) if it doesn&apos;t apply.
          </p>
        )}
      </div>
      <ul className="divide-y divide-slate-100">
        {items.map((item, idx) => (
          <Row
            key={item.id}
            n={idx + 1}
            item={item}
            editable={editable}
            open={openId === item.id}
            onToggle={() => setOpenId(openId === item.id ? null : item.id)}
            onDone={() => {
              const next = items.slice(idx + 1).find((i) => !i.done) ?? items.find((i) => !i.done && i.id !== item.id);
              setOpenId(next?.id ?? null);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  n,
  item,
  editable,
  open,
  onToggle,
  onDone,
}: {
  n: number;
  item: ChecklistItem;
  editable: boolean;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"before" | "after" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<ChecklistItem["result"]>(item.result);
  const [note, setNote] = useState(item.note ?? "");

  const photos: { slot: "before" | "after"; label: string; url: string | null }[] =
    item.photo_rule === "before_after"
      ? [
          { slot: "before", label: "Before", url: item.before_url },
          { slot: "after", label: "After", url: item.after_url },
        ]
      : item.photo_rule === "single"
        ? [{ slot: "after", label: "Photo", url: item.after_url ?? item.before_url }]
        : [];
  const photosMissing = photos.some((p) => !p.url);

  async function upload(slot: "before" | "after", f: File | undefined) {
    if (!f) return;
    setError(null);
    setBusy(slot);
    const fd = new FormData();
    fd.set("item_id", item.id);
    fd.set("slot", slot);
    fd.set("file", await shrink(f));
    const res = await uploadChecklistPhoto(fd);
    setBusy(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  function save(result: NonNullable<ChecklistItem["result"]>) {
    setChoice(result);
    if (result !== "ok" && !note.trim()) return; // wait for the note
    submit(result);
  }

  function submit(result: NonNullable<ChecklistItem["result"]>) {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("item_id", item.id);
      fd.set("result", result);
      fd.set("note", note);
      const res = await setChecklistResult(fd);
      if (!res.ok) return setError(res.error);
      router.refresh();
      const willBeDone = result === "na" || !photosMissing;
      if (willBeDone) onDone();
    });
  }

  return (
    <li>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-50">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            item.done
              ? item.result === "needs_repair"
                ? "bg-amber-100 text-amber-700"
                : item.result === "na"
                  ? "bg-slate-200 text-slate-600"
                  : "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {item.done ? item.result === "needs_repair" ? <Wrench className="h-3.5 w-3.5" /> : item.result === "na" ? "–" : <Check className="h-3.5 w-3.5" /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-900">{item.activity}</span>
          <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
            {item.result ? <span>{RESULT_LABEL[item.result]}</span> : <span>Not started</span>}
            {photos.length > 0 && item.result !== "na" && (
              <span>
                · {photos.filter((p) => p.url).length}/{photos.length} photo{photos.length > 1 ? "s" : ""}
              </span>
            )}
            {item.followup && <span>· repair #{item.followup.number}</span>}
          </span>
        </span>
        {!open && (photos.some((p) => p.url) ? (
          <span className="flex shrink-0 gap-1">
            {photos.filter((p) => p.url).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.slot} src={p.url!} alt={p.label} className="h-9 w-9 rounded object-cover ring-1 ring-slate-200" />
            ))}
          </span>
        ) : null)}
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-3 bg-slate-50/60 px-5 pb-4 pt-1">
          {item.description && <p className="text-sm text-slate-600">{item.description}</p>}

          {photos.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {photos.map((p) => (
                <PhotoSlot key={p.slot} label={p.label} url={p.url} busy={busy === p.slot} disabled={!editable || busy !== null} onFile={(f) => upload(p.slot, f)} />
              ))}
            </div>
          )}

          {editable ? (
            <>
              <div className="flex flex-wrap gap-2">
                {(["ok", "needs_repair", "na"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={pending}
                    onClick={() => save(r)}
                    className={`rounded-lg px-3.5 py-2 text-sm font-medium ring-1 transition ${
                      choice === r
                        ? r === "ok"
                          ? "bg-emerald-600 text-white ring-emerald-600"
                          : r === "needs_repair"
                            ? "bg-amber-500 text-white ring-amber-500"
                            : "bg-slate-600 text-white ring-slate-600"
                        : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {RESULT_LABEL[r]}
                  </button>
                ))}
                {pending && <Loader2 className="h-5 w-5 animate-spin self-center text-slate-400" />}
              </div>
              {(choice === "needs_repair" || choice === "na" || item.note) && (
                <div className="space-y-2">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    placeholder={
                      choice === "needs_repair"
                        ? "What needs repair? This opens a repair request for admin approval."
                        : choice === "na"
                          ? "Why doesn't this apply? (e.g. no make-up air unit at this store)"
                          : "Note (optional)"
                    }
                  />
                  {choice && (
                    <button
                      type="button"
                      disabled={pending || (choice !== "ok" && !note.trim())}
                      onClick={() => submit(choice)}
                      className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Save {choice === "needs_repair" && !item.followup ? "& open repair request" : "note"}
                    </button>
                  )}
                </div>
              )}
              {choice && choice !== "na" && photosMissing && !error && (
                <p className="text-xs text-amber-700">Add the {photos.filter((p) => !p.url).map((p) => p.label.toLowerCase()).join(" and ")} photo to finish this item.</p>
              )}
            </>
          ) : (
            item.note && <p className="text-sm text-slate-700">Note: {item.note}</p>
          )}

          {item.followup && (
            <p className="text-xs text-slate-600">
              Repair request{" "}
              <Link href={`/work-orders/${item.followup.id}`} className="font-medium text-brand-700 hover:underline">
                #{item.followup.number}
              </Link>{" "}
              opened from this item.
            </p>
          )}
          {item.done && item.completed_by_name && (
            <p className="text-xs text-slate-400">
              Done by {item.completed_by_name}
              {item.completed_at ? ` · ${new Date(item.completed_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
            </p>
          )}
          {error && (
            <p className="flex items-center gap-1 text-sm text-red-600">
              <X className="h-4 w-4" /> {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function PhotoSlot({ label, url, busy, disabled, onFile }: { label: string; url: string | null; busy: boolean; disabled: boolean; onFile: (f: File | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className={`relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg ${
          url ? "ring-1 ring-slate-200" : "border-2 border-dashed border-slate-300 bg-white text-slate-500 hover:border-brand-400 hover:text-brand-700"
        } disabled:cursor-not-allowed`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-sm">
            <Camera className="h-6 w-6" />
            Take photo
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
          </span>
        )}
        {url && !disabled && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">Retake</span>}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
