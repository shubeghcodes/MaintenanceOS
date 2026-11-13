import "server-only";
import ExcelJS from "exceljs";
import { readGrid } from "./site-import";
import { MONTHS } from "./periods";
import { addMonthsISO, monthLabel, parseAmount } from "./budgets";

export type BudgetSite = {
  id: string;
  code: string | null;
  name: string;
  company: string | null;
  monthly: number | null;
  overrides: Map<string, number>;
};

/** Prefilled workbook: one row per location, the default monthly budget, then 12 month columns (blank = use the default). */
export async function buildBudgetTemplate(sites: BudgetSite[], firstMonth: string): Promise<ArrayBuffer> {
  const months = Array.from({ length: 12 }, (_, i) => addMonthsISO(firstMonth, i));
  const wb = new ExcelJS.Workbook();
  wb.creator = "MaintainOS";
  const ws = wb.addWorksheet("Budgets", {
    views: [{ state: "frozen", ySplit: 1, xSplit: 2 }],
  });
  ws.columns = [
    { header: "Store #", key: "code", width: 12 },
    { header: "Location", key: "name", width: 32 },
    { header: "Company", key: "company", width: 22 },
    { header: "Monthly budget", key: "monthly", width: 16 },
    ...months.map((m) => ({ header: monthLabel(m), key: m, width: 12 })),
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF3459BF" },
  };
  ws.getColumn("code").numFmt = "@";
  for (const s of sites) {
    ws.addRow({
      code: s.code ?? "",
      name: s.name,
      company: s.company ?? "",
      monthly: s.monthly ?? null,
      ...Object.fromEntries(months.map((m) => [m, s.overrides.get(m) ?? null])),
    });
  }
  for (let c = 4; c <= 4 + months.length; c++) ws.getColumn(c).numFmt = '"$"#,##0.00';
  for (let c = 1; c <= 3; c++) ws.getColumn(c).font = { color: { argb: "FF475569" } };

  const help = wb.addWorksheet("Instructions");
  help.columns = [
    { header: "Column", key: "c", width: 20 },
    { header: "What to enter", key: "h", width: 100 },
  ];
  help.getRow(1).font = { bold: true };
  [
    [
      "Store # / Location",
      "How each row is matched to a location (Store #, or Location name when there's no Store #). Don't change these. Company is for reference only.",
    ],
    ["Monthly budget", "The location's R&M budget for a normal month, labor included. Blank = leave the current budget as it is."],
    ["Month columns", "Only for months that differ from the normal budget (e.g. a bigger summer HVAC month). Blank = use the monthly budget."],
    ["", "Amounts can be typed as 2500, 2,500 or $2,500.00. Rows for locations you don't change can stay as they are."],
  ].forEach(([c, h]) => help.addRow({ c, h }));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Header → month (YYYY-MM-01): "Nov 2026", "November 2026", "2026-11", "11/2026", "11/1/2026". */
function headerMonth(h: string): string | null {
  const s = h.trim().toLowerCase();
  let m = /^([a-z]{3})[a-z]*\.?[\s\-/']+(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const i = MONTHS.findIndex((x) => x.toLowerCase() === m![1]);
    if (i < 0) return null;
    const y = m[2].length === 2 ? `20${m[2]}` : m[2];
    return `${y}-${String(i + 1).padStart(2, "0")}-01`;
  }
  m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2].padStart(2, "0")}-01`;
  m = /^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${m[1].padStart(2, "0")}-01`;
  return null;
}

const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/#/g, "no")
    .replace(/[^a-z0-9]/g, "");

export type BudgetImportRow = {
  line: number;
  code: string | null;
  name: string | null;
  monthly: number | null; // null = no change
  months: { month: string; amount: number | null }[]; // amount null = use the default (remove override)
  errors: string[];
};

export async function parseBudgetFile(file: File) {
  const grid = await readGrid(file, "budgets");
  const hi = grid.findIndex((r) => r.some((c) => /store|location|site|name/i.test(c)));
  if (hi < 0) throw new Error("Couldn't find the header row. Use the downloaded template (Store #, Location, Monthly budget…).");
  const header = grid[hi];
  let codeCol = -1,
    nameCol = -1,
    monthlyCol = -1;
  const monthCols: { col: number; month: string }[] = [];
  header.forEach((h, i) => {
    const n = norm(h);
    if (["storeno", "store", "storenumber", "code", "sitecode", "storecode", "unit"].includes(n)) codeCol = i;
    else if (["location", "name", "locationname", "site", "sitename", "storename"].includes(n)) nameCol = i;
    else if (["monthlybudget", "budget", "defaultbudget", "monthly", "monthlyamount"].includes(n)) monthlyCol = i;
    else {
      const m = headerMonth(h);
      if (m) monthCols.push({ col: i, month: m });
    }
  });
  if (codeCol < 0 && nameCol < 0) throw new Error("Add a Store # or Location column so rows can be matched to locations.");
  if (monthlyCol < 0 && monthCols.length === 0) throw new Error("No budget columns found. Add a “Monthly budget” column or month columns like “Jan 2027”.");

  const rows: BudgetImportRow[] = [];
  for (let r = hi + 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    const get = (c: number) => (c >= 0 ? (cells[c] ?? "").trim() : "");
    const code = get(codeCol) || null;
    const name = get(nameCol) || null;
    if (!code && !name && !cells.some((c) => c?.trim())) continue;
    const errors: string[] = [];
    const amt = (raw: string, label: string) => {
      const v = parseAmount(raw);
      if (Number.isNaN(v)) {
        errors.push(`${label}: “${raw}” isn't an amount`);
        return null;
      }
      return v;
    };
    rows.push({
      line: r + 1,
      code,
      name,
      monthly: monthlyCol >= 0 ? amt(get(monthlyCol), "Monthly budget") : null,
      months: monthCols.map(({ col, month }) => ({
        month,
        amount: amt(get(col), monthLabel(month)),
      })),
      errors,
    });
    if (rows.length > 2000) throw new Error("That file has more than 2,000 rows. Split it into smaller files.");
  }
  return { rows, months: monthCols.map((m) => m.month) };
}
