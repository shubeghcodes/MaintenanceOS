"use client";

/** Shown if an action is interrupted (dropped connection, upload timeout). Nothing is half-saved: retry is safe. */
export default function PortalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-semibold">That didn&apos;t go through</h1>
        <p className="mt-2 text-sm text-slate-600">
          The connection was interrupted or an upload was too large. Nothing was submitted twice. Please check your signal and try again.
          Photos must be under 10 MB each.
        </p>
        <button onClick={() => (reset(), window.location.reload())} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
      </div>
    </div>
  );
}
