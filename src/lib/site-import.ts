import "server-only";
import ExcelJS from "exceljs";
import type { SiteType } from "./types";

/** Columns the import understands. Header names are matched loosely (case, spaces and punctuation ignored). */
export const IMPORT_COLUMNS = [
  { key: "code", label: "Store #", required: false, example: "DT-1042", help: "Store number or site code. Used to match existing sites, so re-uploading updates instead of duplicating." },
  { key: "name", label: "Name", required: true, example: "Del Taco Fullerton", help: "Location name (required)." },
  { key: "type", label: "Type", required: false, example: "QSR", help: "QSR, Dine-in or CRE. Drives the compliance checklist. Blank = QSR." },
  { key: "brand", label: "Brand", required: false, example: "Del Taco", help: "" },
  { key: "address", label: "Address", required: false, example: "123 W Commonwealth Ave", help: "" },
  { key: "city", label: "City", required: false, example: "Fullerton", help: "" },
  { key: "state", label: "State", required: false, example: "CA", help: "" },
  { key: "zip", label: "ZIP", required: false, example: "92832", help: "" },
  { key: "phone", label: "Phone", required: false, example: "(714) 555-0100", help: "" },
  { key: "sq_ft", label: "Sq Ft", required: false, example: "2400", help: "" },
  { key: "manager_email", label: "Manager Email", required: false, example: "gm.fullerton@example.com", help: "The manager(s) who should see this site. Separate several with commas. New emails get an invite." },
  { key: "manager_name", label: "Manager Name", required: false, example: "Maria Lopez", help: "Used when inviting a new manager." },
] as const;

type ColKey = (typeof IMPORT_COLUMNS)[number]["key"];

const ALIASES: Record<string, ColKey> = {
  code: "code", storecode: "code", sitecode: "code", store: "code", storeno: "code", storenumber: "code", store_: "code", unit: "code", unitnumber: "code", locationcode: "code", id: "code",
  name: "name", sitename: "name", storename: "name", location: "name", locationname: "name",
  type: "type", sitetype: "type", locationtype: "type", category: "type",
  brand: "brand", concept: "brand",
  address: "address", address1: "address", street: "address", streetaddress: "address",
  city: "city",
  state: "state", st: "state",
  zip: "zip", zipcode: "zip", postalcode: "zip", postal: "zip",
  phone: "phone", phonenumber: "phone", storephone: "phone",
  sqft: "sq_ft", squarefeet: "sq_ft", squarefootage: "sq_ft", size: "sq_ft",
  manageremail: "manager_email", manageremails: "manager_email", manager: "manager_email", gmemail: "manager_email", gm: "manager_email", email: "manager_email",
  managername: "manager_name", gmname: "manager_name",
};

const normHeader = (h: string) => {
  const n = h.toLowerCase().replace(/#/g, "no").replace(/[^a-z0-9]/g, "");
  return n;
};

export type ImportRow = {
  line: number; // spreadsheet row number, for messages
  code: string | null;
  name: string | null;
  type: SiteType;
  brand: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  sq_ft: number | null;
  manager_emails: string[];
  manager_name: string | null;
  errors: string[];
  warnings: string[];
};

function toType(v: string | null, warnings: string[], errors: string[]): SiteType {
  if (!v) {
    warnings.push("Type blank, set to QSR");
    return "qsr";
  }
  const t = v.toLowerCase().replace(/[^a-z]/g, "");
  if (["qsr", "quickservice", "quickservicerestaurant", "fastfood", "drivethru"].includes(t)) return "qsr";
  if (["dinein", "dine", "fullservice", "restaurant", "casualdining", "sitdown"].includes(t)) return "dine_in";
  if (["cre", "commercial", "commercialre", "commercialrealestate", "realestate", "retail", "office", "property", "plaza", "center"].includes(t)) return "cre";
  errors.push(`Type “${v}” not recognised (use QSR, Dine-in or CRE)`);
  return "qsr";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildRow(line: number, rec: Partial<Record<ColKey, string>>): ImportRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const clean = (k: ColKey) => {
    const v = rec[k]?.replace(/\s+/g, " ").trim();
    return v ? v : null;
  };
  let zip = clean("zip");
  if (zip && /^\d{3,4}$/.test(zip)) zip = zip.padStart(5, "0"); // Excel drops leading zeros
  let sq: number | null = null;
  const sqRaw = clean("sq_ft");
  if (sqRaw) {
    const n = Number(sqRaw.replace(/[, ]|sq\.?\s*ft\.?/gi, ""));
    if (Number.isFinite(n) && n > 0) sq = Math.round(n);
    else warnings.push(`Sq Ft “${sqRaw}” ignored`);
  }
  const emails = (clean("manager_email") ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.toLowerCase().replace(/^mailto:/, ""))
    .filter(Boolean);
  const goodEmails: string[] = [];
  for (const e of emails) {
    if (EMAIL_RE.test(e)) goodEmails.push(e);
    else errors.push(`Manager email “${e}” isn’t a valid email`);
  }
  const name = clean("name");
  if (!name) errors.push("Name is required");
  return {
    line,
    code: clean("code"),
    name,
    type: toType(clean("type"), warnings, errors),
    brand: clean("brand"),
    address: clean("address"),
    city: clean("city"),
    state: clean("state")?.toUpperCase() ?? null,
    zip,
    phone: clean("phone"),
    sq_ft: sq,
    manager_emails: Array.from(new Set(goodEmails)),
    manager_name: clean("manager_name"),
    errors,
    warnings,
  };
}

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readGrid(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    return parseCsv(new TextDecoder("utf-8").decode(buf).replace(/^﻿/, ""));
  }
  if (!name.endsWith(".xlsx") && !name.endsWith(".xlsm")) {
    throw new Error("Upload an Excel .xlsx file or a .csv file. (Older .xls files: open in Excel and Save As .xlsx.)");
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet =
    wb.worksheets.find((w) => w.name.trim().toLowerCase() === "sites") ??
    wb.worksheets.find((w) => !/instruction|readme|help/i.test(w.name) && w.actualRowCount > 0) ??
    wb.worksheets[0];
  if (!sheet) throw new Error("The workbook has no sheets.");
  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) cells.push((row.getCell(c).text ?? "").toString());
    grid[rowNumber - 1] = cells;
  });
  for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  return grid;
}

export const MAX_IMPORT_ROWS = 1000;

/** Reads an uploaded .xlsx / .csv into validated rows. Throws with a friendly message if the file can't be used. */
export async function parseSiteFile(file: File): Promise<{ rows: ImportRow[]; unknownHeaders: string[] }> {
  if (!file || file.size === 0) throw new Error("Choose a file to upload.");
  if (file.size > 10 * 1024 * 1024) throw new Error("That file is over 10 MB. Remove extra sheets or images and try again.");
  const grid = await readGrid(file);

  // Header = first row that maps to a Name column.
  let headerIdx = -1;
  let map: (ColKey | null)[] = [];
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const m = grid[i].map((h) => ALIASES[normHeader(h)] ?? null);
    if (m.includes("name")) {
      headerIdx = i;
      map = m;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Couldn’t find a header row with a “Name” column. Download the template to see the expected columns.");
  const unknownHeaders = grid[headerIdx].filter((h, i) => h.trim() && !map[i]).map((h) => h.trim());

  const rows: ImportRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells.some((c) => c && c.trim())) continue;
    const rec: Partial<Record<ColKey, string>> = {};
    map.forEach((k, ci) => {
      if (k && cells[ci] != null && !rec[k]) rec[k] = String(cells[ci]);
    });
    // Skip the template's example row if it was left in.
    if (rec.code === "DT-1042" && rec.manager_email === "gm.fullerton@example.com") continue;
    rows.push(buildRow(i + 1, rec));
    if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Up to ${MAX_IMPORT_ROWS} sites per upload. Split the file and upload in parts.`);
  }
  if (!rows.length) throw new Error("No site rows found under the header row.");

  // Duplicate codes / names inside the file.
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = r.code ? `c:${r.code.toLowerCase()}` : r.name ? `n:${r.name.toLowerCase()}` : null;
    if (!k) continue;
    if (seen.has(k)) r.errors.push(`Duplicate of row ${seen.get(k)} in this file`);
    else seen.set(k, r.line);
  }
  return { rows, unknownHeaders };
}

/** Builds the downloadable template workbook. */
export async function buildTemplate(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MaintainOS";
  const ws = wb.addWorksheet("Sites", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({
    header: c.required ? `${c.label} *` : c.label,
    key: c.key,
    width: Math.max(12, c.label.length + 4, c.example.length + 2),
  }));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3459BF" } };
  ws.addRow(Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.example])));
  ws.getRow(2).font = { italic: true, color: { argb: "FF64748B" } };
  // Text format for codes, ZIPs and phones so Excel keeps leading zeros.
  for (const k of ["code", "zip", "phone"]) ws.getColumn(k).numFmt = "@";
  const typeCol = ws.getColumn("type").letter;
  for (let r = 2; r <= 1001; r++) {
    ws.getCell(`${typeCol}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"QSR,Dine-in,CRE"'],
      showErrorMessage: true,
      errorTitle: "Type",
      error: "Pick QSR, Dine-in or CRE",
    };
  }

  const help = wb.addWorksheet("Instructions");
  help.columns = [
    { header: "Column", key: "c", width: 18 },
    { header: "What to enter", key: "h", width: 100 },
  ];
  help.getRow(1).font = { bold: true };
  for (const c of IMPORT_COLUMNS) help.addRow({ c: c.required ? `${c.label} *` : c.label, h: c.help || "Optional." });
  help.addRow({});
  help.addRow({ c: "Tips", h: "Replace the grey example row with your locations, one per row. * = required." });
  help.addRow({ c: "", h: "Re-uploading the same file updates matching sites (by Store #, or by Name if no Store #). Blank cells never erase existing data." });
  help.addRow({ c: "", h: "Managers only see the sites they're assigned to. An admin sees everything." });
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
