"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { UserRole } from "@/lib/types";
import { saveTourState } from "@/app/(app)/tour-actions";

/** Fire this (e.g. from the Help menu) to start the tour on the current page. */
export const START_TOUR_EVENT = "mos:start-tour";

type Step = {
  id: string;
  /** data-tour values to highlight; the first one visible on screen wins. None = centered. */
  targets?: string[];
  title: string;
  body: string;
  /** Leave the step out when its target isn't on screen (instead of showing it centered). */
  optional?: boolean;
};

/** The steps for each role. Text is written for what that person can actually do. */
function stepsFor(role: UserRole, firstName: string | null): Step[] {
  const hi = firstName ? `Welcome to MaintenanceOS, ${firstName}` : "Welcome to MaintenanceOS";
  const welcome: Step = {
    id: "welcome",
    title: hi,
    body:
      role === "manager"
        ? "This one-minute tour shows how to report problems at your store and follow them until they're fixed. You can restart it anytime from Help."
        : role === "tech"
          ? "This one-minute tour shows where your jobs are, how to log your time, and how work gets closed out. You can restart it anytime from Help."
          : "This one-minute tour walks through the main parts of the system. You can restart it anytime from Help.",
  };
  const dashboard: Step = {
    id: "dashboard",
    targets: ["dashboard-stats"],
    title: "Your dashboard",
    body:
      role === "manager"
        ? "Open and overdue work at your store, what's waiting on you (like jobs to sign off), and how much of this month's budget is used. Click a tile to see the list behind it."
        : "Open and overdue work, PM and compliance status, and this month's R&M spend at a glance. Anything waiting on you shows at the top. Click a tile to see the list behind it.",
  };
  const company: Step = {
    id: "company",
    targets: ["company-dash", "company"],
    optional: true,
    title: "Pick a company",
    body: "Switch between your companies here. Locations, work orders and reports all follow the company you pick. Choose All companies to see everything combined.",
  };
  const locations: Step = {
    id: "locations",
    targets: ["nav-/sites"],
    title: role === "manager" ? "Your location" : "Locations",
    body:
      role === "manager"
        ? "Your store's page: open work, equipment, compliance items, and how much of this month's R&M budget is used."
        : role === "tech"
          ? "Each store or property you cover, with its open work, equipment and compliance items."
          : "Each store or property, with its open work, equipment, compliance and monthly budget. Add one at a time or import them all from Excel.",
  };
  const workOrders: Step = {
    id: "work-orders",
    targets: ["nav-/work-orders"],
    title: "Work orders",
    body:
      role === "manager"
        ? "Submit a request with photos when something breaks. An admin approves it and assigns a tech or vendor, and you'll get emails as it moves along. When the work is done, you confirm it's fixed or send it back."
        : role === "tech"
          ? "Jobs assigned to you live here. Open one to see the details, add notes and photos, and mark it complete. New requests you submit go to an admin to approve."
          : "Every job lives here. Requests from GMs and techs wait for your approval: assign a technician or send it to a vendor. When the work is done, the store's GM signs off before it closes.",
  };
  const vendors: Step = {
    id: "vendors",
    targets: ["nav-/vendor-jobs"],
    title: "Vendor management",
    body:
      role === "tech"
        ? "Jobs sent to outside vendors and where each one stands: accepted, in progress, or completed."
        : "Send a job to an outside vendor in one step. They get a secure link (no login needed) to accept, post updates, send quotes and invoice. This page shows everything waiting on you; the vendor directory is under Vendors.",
  };
  const time: Step =
    role === "tech"
      ? {
          id: "time",
          targets: ["nav-/my-day"],
          title: "My day, clock in and time tracking",
          body: "Start your day here: Clock in and pick your first job, and its timer starts. Pause for breaks or parts runs, switch jobs as you go, and at the end of the day Clock out on your last job and say if it's finished.",
        }
      : {
          id: "time",
          targets: ["nav-/schedule"],
          title: "Scheduling and time tracking",
          body: "Drag jobs onto techs and days. Techs time their work with a start/stop timer on each job. You can add or fix time with a reason, and every change is kept in the history.",
        };
  const rm: Step =
    role === "manager"
      ? {
          id: "rm",
          targets: ["by-site", "nav-/sites"],
          title: "Your monthly budget",
          body: "See how much of your store's monthly repairs and maintenance budget is used and what's left. Bars turn amber at 80% and red when over.",
        }
      : {
          id: "rm",
          targets: ["nav-/analytics"],
          title: "R&M reporting",
          body: "R&M spending by location, category and month, with technician labor included. Also each tech's hours and labor cost, and receipts waiting for review.",
        };
  const help: Step = {
    id: "help",
    targets: ["help"],
    title: "You're all set",
    body: "Restart this tour anytime from Help → Take a tour.",
  };

  if (role === "manager") return [welcome, dashboard, company, locations, workOrders, rm, help];
  if (role === "tech") return [welcome, dashboard, company, locations, workOrders, vendors, time, help];
  return [welcome, dashboard, company, locations, workOrders, vendors, time, rm, help];
}

const PAD = 6; // space around the highlighted element
const GAP = 12; // space between the highlight and the pop-up

function visibleTarget(ids: string[] | undefined) {
  for (const id of ids ?? []) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(id)}"]`))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

type Box = { top: number; left: number; width: number; height: number };

/** Where the pop-up goes: beside the highlight if there's room, else below, else above; always on screen. */
function place(target: Box | null, pop: { w: number; h: number }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(12, Math.min(x, vw - pop.w - 12));
  const clampY = (y: number) => Math.max(12, Math.min(y, vh - pop.h - 12));
  if (!target) return { top: clampY((vh - pop.h) / 2), left: clampX((vw - pop.w) / 2) };
  const right = target.left + target.width + PAD + GAP;
  if (right + pop.w <= vw - 12) return { top: clampY(target.top + target.height / 2 - pop.h / 2), left: right };
  const below = target.top + target.height + PAD + GAP;
  if (below + pop.h <= vh - 12) return { top: below, left: clampX(target.left + target.width / 2 - pop.w / 2) };
  const above = target.top - PAD - GAP - pop.h;
  if (above >= 12) return { top: above, left: clampX(target.left + target.width / 2 - pop.w / 2) };
  return { top: clampY((vh - pop.h) / 2), left: clampX((vw - pop.w) / 2) };
}

export function OnboardingTour({ role, firstName, autoStart }: { role: UserRole; firstName: string | null; autoStart: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const start = useCallback(() => {
    // Drop steps whose feature isn't on screen for this person (e.g. no company picker with one company).
    const all = stepsFor(role, firstName).filter((s) => !s.optional || visibleTarget(s.targets));
    setIndex(0);
    setSteps(all);
  }, [role, firstName]);

  const end = useCallback(
    (outcome: "completed" | "skipped") => {
      setSteps(null);
      setBox(null);
      try {
        sessionStorage.setItem("mos-tour-done", "1");
      } catch {}
      void saveTourState(outcome);
      if (window.location.search.includes("tour=1")) router.replace(pathname);
    },
    [pathname, router],
  );

  // First visit (on the dashboard), or "Take a tour" from another page (?tour=1).
  useEffect(() => {
    if (pathname !== "/" || steps) return;
    const asked = new URLSearchParams(window.location.search).get("tour") === "1";
    let seen = false;
    try {
      seen = sessionStorage.getItem("mos-tour-done") === "1";
    } catch {}
    if (asked || (autoStart && !seen)) {
      const t = setTimeout(start, 400);
      return () => clearTimeout(t);
    }
  }, [pathname, autoStart, start, steps]);

  // "Take a tour" while already on the dashboard.
  useEffect(() => {
    const onStart = () => start();
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, [start]);

  const step = steps?.[index] ?? null;

  // Measure the highlighted element and position the pop-up; follow scrolling and resizing.
  useLayoutEffect(() => {
    if (!step) return;
    const el = visibleTarget(step.targets);
    if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const t = visibleTarget(step.targets);
        const r = t?.getBoundingClientRect();
        const b = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
        setBox(b);
        const p = popRef.current;
        setPos(place(b, { w: p?.offsetWidth ?? 340, h: p?.offsetHeight ?? 200 }));
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  // Keyboard: arrows / Enter to move, Esc to skip. Focus the main button on each step.
  useEffect(() => {
    if (!steps) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end("skipped");
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps, index, end]);

  if (!steps || !step) return null;
  const last = index === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[60]" aria-live="polite">
      {/* Dim everything except the highlighted feature. Clicks outside the pop-up are ignored. */}
      {box ? (
        <div
          className="pointer-events-none fixed rounded-xl transition-all duration-200"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            // White then blue outline so the highlight reads on the dark sidebar and on light pages.
            boxShadow: "0 0 0 2px #ffffff, 0 0 0 4px #3459bf, 0 0 0 9999px rgba(15, 23, 42, 0.55)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-slate-900/55" />
      )}
      <div className="fixed inset-0" onClick={(e) => e.stopPropagation()} />

      <div
        ref={popRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="fixed w-[min(340px,calc(100vw-24px))] rounded-xl bg-white p-5 shadow-xl ring-1 ring-slate-200 transition-[top,left] duration-200"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium text-brand-700">
            Step {index + 1} of {steps.length}
          </p>
          <button onClick={() => end("skipped")} className="-m-1 rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Close tour">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <h2 id="tour-title" className="mt-1 text-base font-semibold text-slate-900">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-1.5 text-sm leading-6 text-slate-600">
          {step.body}
        </p>
        {!box && step.targets?.some((t) => t.startsWith("nav-") || t === "help" || t === "company") && (
          <p className="mt-2 text-xs text-slate-500">On a phone, find it in the menu (☰) at the top of the screen.</p>
        )}
        <div className="mt-3 flex gap-1" aria-hidden>
          {steps.map((s, i) => (
            <span key={s.id} className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-brand-500" : "bg-slate-200"}`} />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          {last ? (
            <span />
          ) : (
            <button onClick={() => end("skipped")} className="text-sm font-medium text-slate-500 hover:text-slate-800">
              Skip tour
            </button>
          )}
          <div className="flex gap-2">
            {index > 0 && (
              <button
                onClick={() => setIndex(index - 1)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
              >
                Back
              </button>
            )}
            <button
              ref={primaryRef}
              onClick={() => (last ? end("completed") : setIndex(index + 1))}
              className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
            >
              {last ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
