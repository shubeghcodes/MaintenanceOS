"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";

/**
 * Wraps a table with row checkboxes (`<input type="checkbox" name="ids" value=…>`) and a header checkbox
 * marked `data-select-all`. Shows a bar with how many are picked and a delete button that asks first.
 */
export function BulkForm({
  action,
  noun,
  nounPlural,
  extra,
  children,
}: {
  action: (fd: FormData) => void | Promise<void>;
  noun: string;
  nounPlural: string;
  /** Extra fields shown in the bar (e.g. an "also cancel work orders" checkbox). */
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const boxes = () => Array.from(ref.current?.querySelectorAll<HTMLInputElement>('input[name="ids"]') ?? []);
  const sync = () => {
    const all = boxes();
    const n = all.filter((b) => b.checked).length;
    setCount(n);
    const head = ref.current?.querySelector<HTMLInputElement>("input[data-select-all]");
    if (head) {
      head.checked = n > 0 && n === all.length;
      head.indeterminate = n > 0 && n < all.length;
    }
  };

  return (
    <form
      ref={ref}
      action={action}
      onChange={(e) => {
        const el = e.target as unknown as HTMLInputElement;
        if (el.dataset.selectAll !== undefined) boxes().forEach((b) => (b.checked = el.checked));
        sync();
      }}
      onSubmit={(e) => {
        if (!count || !confirm(`Delete ${count} ${count === 1 ? noun : nounPlural}? This can't be undone.`)) {
          e.preventDefault();
          return;
        }
        setBusy(true);
      }}
    >
      {count > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2.5">
          <span className="text-sm font-medium text-red-900">
            {count} {count === 1 ? noun : nounPlural} selected
          </span>
          {extra}
          <button
            type="submit"
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" aria-hidden /> {busy ? "Deleting…" : "Delete selected"}
          </button>
          <button
            type="button"
            onClick={() => {
              boxes().forEach((b) => (b.checked = false));
              sync();
            }}
            className="text-sm text-red-800 hover:underline"
          >
            Clear
          </button>
        </div>
      )}
      {children}
    </form>
  );
}
