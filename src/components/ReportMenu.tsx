"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, FileSpreadsheet, FilterX, Globe, Loader2, MoreVertical, Printer, RefreshCw } from "lucide-react";

const TZ = process.env.NEXT_PUBLIC_TIMEZONE || "America/Los_Angeles";

type Cell = string | number | null;
type Grid = { name: string; rows: Cell[][]; formats: (string | null)[][] };
type Snapshot = { title: string; subtitle: string; filters: [string, string][]; stats: [string, Cell][]; tables: Grid[] };

// ---------- Reading what's on the page ----------------------------------------------------------

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Turns "$1,234.50", "-$20", "12.5", "85%" into numbers (with an Excel format); leaves everything else as text. */
function parseValue(text: string): { v: Cell; fmt: string | null } {
  const t = text.trim();
  if (!t || t === "—" || t === "-") return { v: null, fmt: null };
  const money = t.match(/^(-)?\$(-)?([\d,]+(?:\.\d+)?)$/);
  if (money) return { v: (money[1] || money[2] ? -1 : 1) * Number(money[3].replace(/,/g, "")), fmt: '"$"#,##0.00' };
  const pct = t.match(/^(-?[\d,]+(?:\.\d+)?)%$/);
  if (pct) return { v: Number(pct[1].replace(/,/g, "")) / 100, fmt: pct[1].includes(".") ? "0.0%" : "0%" };
  if (/^-?[\d,]*\.?\d+$/.test(t) && !/^0\d/.test(t) && t.replace(/[^\d]/g, "").length < 15) {
    const n = Number(t.replace(/,/g, ""));
    if (!Number.isNaN(n)) return { v: n, fmt: t.includes(".") ? "#,##0.00" : "#,##0" };
  }
  return { v: t, fmt: null };
}

/** Text of a cell without buttons, forms, icons or anything marked to skip. */
function cellText(el: Element) {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll("button, form, input, select, textarea, svg, script, [data-report-ignore], details > :not(summary)").forEach((n) => n.remove());
  // Keep line structure readable: block children become " · "-separated.
  c.querySelectorAll("br").forEach((b) => b.replaceWith(" "));
  const blocks = [...c.querySelectorAll(":scope > div, :scope > p, :scope > span.block, :scope > a > span.block")];
  if (blocks.length > 1) return blocks.map((b) => clean(b.textContent)).filter(Boolean).join(" · ");
  return clean(c.textContent);
}

function tableTitle(t: HTMLTableElement, i: number) {
  const own = t.getAttribute("data-report-table");
  if (own) return own;
  const card = t.closest(".rounded-xl, section, details");
  const h = card?.querySelector("h2, h3, summary");
  return clean(h?.textContent) || `Table ${i + 1}`;
}

function readTable(t: HTMLTableElement, i: number): Grid | null {
  const rows: Cell[][] = [];
  const formats: (string | null)[][] = [];
  t.querySelectorAll("tr").forEach((tr) => {
    if (tr.closest("table") !== t) return; // skip nested tables
    const cells = [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH") as HTMLElement[];
    if (!cells.length) return;
    const isHead = tr.parentElement?.tagName === "THEAD" || cells.every((c) => c.tagName === "TH");
    const r: Cell[] = [];
    const f: (string | null)[] = [];
    cells.forEach((c) => {
      const txt = cellText(c);
      const { v, fmt } = isHead ? { v: txt || null, fmt: null } : parseValue(txt);
      const span = Math.max(1, Number(c.getAttribute("colspan") ?? 1));
      r.push(v);
      f.push(fmt);
      for (let k = 1; k < span; k++) {
        r.push(null);
        f.push(null);
      }
    });
    if (r.some((v) => v !== null && v !== "")) {
      rows.push(r);
      formats.push(f);
    }
  });
  if (rows.length < 2) return null;
  // Drop columns that are empty in every row (action buttons, chevrons).
  const width = Math.max(...rows.map((r) => r.length));
  const keep = [...Array(width).keys()].filter((c) => rows.some((r) => r[c] !== null && r[c] !== "" && r[c] !== undefined));
  return { name: tableTitle(t, i), rows: rows.map((r) => keep.map((c) => r[c] ?? null)), formats: formats.map((r) => keep.map((c) => r[c] ?? null)) };
}

function snapshot(): Snapshot {
  const main = document.querySelector("main") ?? document.body;
  const title = clean(main.querySelector("h1")?.textContent) || document.title;
  const subtitle = clean(main.querySelector("h1")?.parentElement?.querySelector("p")?.textContent);

  // Filters: the GET forms on the page (not the forms that save something).
  const filters: [string, string][] = [];
  main.querySelectorAll("form").forEach((form) => {
    const action = form.getAttribute("action");
    if (action && !action.startsWith("/")) return; // server action
    form.querySelectorAll("select, input").forEach((el) => {
      const input = el as HTMLInputElement | HTMLSelectElement;
      if (!input.name || (input as HTMLInputElement).type === "hidden" || (input as HTMLInputElement).type === "submit") return;
      const value = input instanceof HTMLSelectElement ? clean(input.selectedOptions[0]?.textContent) : input.value;
      if (!value) return;
      const label =
        clean(input.closest("label")?.querySelector("span")?.textContent) ||
        clean(input.getAttribute("aria-label")) ||
        clean(input.getAttribute("placeholder")) ||
        input.name.replace(/_/g, " ");
      filters.push([label, value]);
    });
  });

  const stats: [string, Cell][] = [];
  main.querySelectorAll("[data-report-stat]").forEach((s) => {
    const label = clean(s.querySelector("[data-report-stat-label]")?.textContent);
    const value = clean(s.querySelector("[data-report-stat-value]")?.textContent);
    if (label) stats.push([label, parseValue(value).v ?? value]);
  });

  const tables = [...main.querySelectorAll("table")]
    .filter((t) => !t.closest("[data-report-ignore]") && !t.parentElement?.closest("table"))
    .map((t, i) => readTable(t as HTMLTableElement, i))
    .filter((g): g is Grid => !!g);

  return { title, subtitle, filters, stats, tables };
}

// ---------- Files ----------------------------------------------------------------------------------

const stamp = () =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date());
const fileBase = (name: string) => `${name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function downloadExcel(report: string, snap: Snapshot) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "MaintenanceOS";
  wb.created = new Date();

  // Summary sheet: what this report is, when, which filters, and the headline numbers.
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 34 }, { width: 48 }];
  sum.addRow([`${snap.title} · ${report}`]).font = { bold: true, size: 14 };
  if (snap.subtitle) sum.addRow([snap.subtitle]).font = { color: { argb: "FF64748B" } };
  sum.addRow([`Downloaded ${stamp()} (${TZ.replace("_", " ")})`]).font = { color: { argb: "FF64748B" } };
  if (snap.filters.length) {
    sum.addRow([]);
    sum.addRow(["Filters"]).font = { bold: true };
    snap.filters.forEach(([k, v]) => sum.addRow([k, v]));
  }
  if (snap.stats.length) {
    sum.addRow([]);
    sum.addRow(["Totals"]).font = { bold: true };
    snap.stats.forEach(([k, v]) => {
      const row = sum.addRow([k, v]);
      const p = typeof v === "number" ? parseValue(String(v)) : null;
      if (p?.fmt) row.getCell(2).numFmt = p.fmt;
    });
  }
  if (snap.tables.length) {
    sum.addRow([]);
    sum.addRow(["Sheets"]).font = { bold: true };
    snap.tables.forEach((t) => sum.addRow([t.name, `${t.rows.length - 1} rows`]));
  }

  const used = new Set<string>(["summary"]);
  snap.tables.forEach((t) => {
    let name = t.name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").slice(0, 31).trim() || "Table";
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name.slice(0, 27)} (${n})`;
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    t.rows.forEach((r, i) => {
      const row = ws.addRow(r);
      if (i === 0) {
        row.font = { bold: true };
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      } else {
        t.formats[i].forEach((f, c) => {
          if (f) row.getCell(c + 1).numFmt = f;
        });
      }
    });
    const cols = t.rows[0].length;
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
    ws.columns.forEach((col, c) => {
      const longest = Math.max(...t.rows.map((r) => String(r[c] ?? "").length));
      col.width = Math.min(60, Math.max(10, longest + 2));
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  save(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${fileBase(report)}.xlsx`);
}

function downloadCsv(report: string, snap: Snapshot) {
  // The biggest table on the page is the report's main list.
  const t = [...snap.tables].sort((a, b) => b.rows.length - a.rows.length)[0];
  const esc = (v: Cell) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Percentages go out as "45%" so the CSV reads like the screen; money and counts stay plain numbers.
  const csv = t.rows
    .map((r, i) => r.map((v, c) => esc(typeof v === "number" && t.formats[i][c]?.endsWith("%") ? `${+(v * 100).toFixed(2)}%` : v)).join(","))
    .join("\n");
  save(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `${fileBase(`${report} ${t.name}`)}.csv`);
}

// ---------- Menu -----------------------------------------------------------------------------------

/**
 * ⋮ menu for Analytics reports: refresh, download the page as Excel (summary + one sheet per table) or CSV,
 * print / save as PDF, reset filters. Downloads are built from exactly what's on screen, so they always
 * match the current filters.
 */
export function ReportMenu({ report }: { report: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());
  const [refreshing, startRefresh] = useTransition();
  const [printInfo, setPrintInfo] = useState<{ when: string; filters: [string, string][] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const hasFilters = [...params.keys()].length > 0;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      clearInterval(t);
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const mins = Math.floor((now.getTime() - refreshedAt.getTime()) / 60000);
  const ago = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)} h ago`;

  async function run(kind: "xlsx" | "csv") {
    setNote(null);
    const snap = snapshot();
    if (!snap.tables.length && !snap.stats.length) return setNote("Nothing on this page to download yet.");
    if (kind === "csv" && !snap.tables.length) return setNote("No table on this page; try Excel.");
    setBusy(kind);
    try {
      if (kind === "xlsx") await downloadExcel(report, snap);
      else downloadCsv(report, snap);
      setOpen(false);
    } catch {
      setNote("Download failed. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function print() {
    setPrintInfo({ when: stamp(), filters: snapshot().filters });
    setOpen(false);
    setTimeout(() => window.print(), 50);
  }

  const item = "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50";

  return (
    <>
      <div ref={ref} className="relative ml-auto flex shrink-0 items-center gap-1 self-center pb-1 print:hidden">
        <span className="hidden text-xs text-slate-400 sm:inline">Updated {ago}</span>
        <button
          type="button"
          onClick={() => startRefresh(() => (router.refresh(), setRefreshedAt(new Date()), setNow(new Date())))}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-label="Report options"
          title="Report options"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {open && (
          <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200">
            <button role="menuitem" type="button" className={item} onClick={() => run("xlsx")} disabled={!!busy}>
              {busy === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : <FileSpreadsheet className="h-4 w-4 text-emerald-600" />}
              <span>
                Download Excel
                <span className="block text-xs text-slate-500">Totals, filters and every table</span>
              </span>
            </button>
            <button role="menuitem" type="button" className={item} onClick={() => run("csv")} disabled={!!busy}>
              {busy === "csv" ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : <Download className="h-4 w-4 text-slate-500" />}
              <span>
                Download CSV
                <span className="block text-xs text-slate-500">The main table only</span>
              </span>
            </button>
            <button role="menuitem" type="button" className={item} onClick={print}>
              <Printer className="h-4 w-4 text-slate-500" />
              <span>
                Print or save as PDF
                <span className="block text-xs text-slate-500">Choose “Save as PDF” in the print window</span>
              </span>
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              role="menuitem"
              type="button"
              className={item}
              onClick={() => startRefresh(() => (router.refresh(), setRefreshedAt(new Date()), setNow(new Date()), setOpen(false)))}
            >
              <RefreshCw className="h-4 w-4 text-slate-500" /> Refresh data
            </button>
            <button role="menuitem" type="button" className={item} onClick={() => (router.push(pathname), setOpen(false))} disabled={!hasFilters}>
              <FilterX className="h-4 w-4 text-slate-500" /> Reset filters
            </button>
            <div className="my-1 border-t border-slate-100" />
            <div className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <Globe className="mt-0.5 h-4 w-4 text-slate-400" />
              <span className="text-slate-700">
                Time zone
                <span className="block text-xs text-slate-500">{TZ.replace("_", " ").replace("/", " – ")}</span>
              </span>
            </div>
            {note && <p className="border-t border-slate-100 px-4 py-2 text-xs text-red-600">{note}</p>}
          </div>
        )}
      </div>
      {printInfo && (
        <div className="hidden print:mb-4 print:block print:text-xs print:text-slate-600">
          <span className="font-medium text-slate-900">{report}</span> · Printed {printInfo.when}
          {printInfo.filters.length > 0 && <> · {printInfo.filters.map(([k, v]) => `${k}: ${v}`).join(" · ")}</>}
        </div>
      )}
    </>
  );
}
