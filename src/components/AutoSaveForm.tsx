"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";

type Result = { ok: true } | { ok: false; error: string };

/**
 * A form that saves itself: whenever a field is left (or Enter is pressed) after a change, the whole form is sent
 * to `action`, and a small status shows Saving… / Saved ✓ / Not saved. No Save button needed.
 */
export function AutoSaveForm({ action, className, children }: { action: (fd: FormData) => Promise<Result>; className?: string; children: React.ReactNode }) {
  const t = useT();
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const last = useRef<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [, start] = useTransition();

  const snapshot = () => (ref.current ? new URLSearchParams(new FormData(ref.current) as unknown as Record<string, string>).toString() : "");
  const save = () => {
    const form = ref.current;
    if (!form) return;
    const now = snapshot();
    if (last.current === null) last.current = now; // first blur with no change: remember the starting point
    if (now === last.current && state !== "error") return;
    setState("saving");
    start(async () => {
      const res = await action(new FormData(form));
      if (res.ok) {
        last.current = now;
        setState("saved");
        router.refresh();
      } else {
        setError(res.error);
        setState("error");
      }
    });
  };

  return (
    <form
      ref={ref}
      className={className}
      onFocus={() => {
        if (last.current === null) last.current = snapshot();
      }}
      onBlur={save}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          save();
        }
      }}
    >
      {children}
      <p className="h-4 text-right text-xs" aria-live="polite">
        {state === "saving" && <span className="text-slate-500">{t("Saving…")}</span>}
        {state === "saved" && <span className="text-emerald-700">{t("Saved ✓")}</span>}
        {state === "error" && (
          <button type="button" onClick={save} className="text-red-700 underline">
            {t("Not saved — retry")}
            {error ? ` (${t(error)})` : ""}
          </button>
        )}
      </p>
    </form>
  );
}
