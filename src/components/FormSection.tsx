import type { ReactNode } from "react";

/** One labeled section inside a settings card: title + one-line help on the left, controls on the right. */
export function FormSection({ title, help, id, children }: { title: string; help?: ReactNode; id?: string; children: ReactNode }) {
  return (
    <div id={id} className="grid scroll-mt-6 gap-4 border-t border-slate-100 px-5 py-5 first:border-t-0 md:grid-cols-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
      </div>
      <div className="space-y-4 md:col-span-2">{children}</div>
    </div>
  );
}

/** Footer row of a settings card (Cancel / Save). */
export function FormFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4">{children}</div>;
}
