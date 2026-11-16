import "server-only";
import ExcelJS from "exceljs";
import { CATEGORIES } from "./constants";
import { readGrid } from "./site-import";
import type { AssetStatus } from "./types";

/** Columns the asset import understands. Headers are matched loosely (case, spaces and punctuation ignored). */
export const ASSET_COLUMNS = [
  { key: "site", label: "Location", required: true, example: "101", help: "Store # or location name, exactly as on the Sites page (see the Locations sheet). Blank = the location picked on the upload screen." },
  { key: "name", label: "Name", required: true, example: "Walk-in Cooler", help: "Asset name (required)." },
  { key: "category", label: "Category", required: false, example: "Refrigeration", help: `One of: ${CATEGORIES.join(", ")}. Other names are kept as they are.` },
  { key: "status", label: "Status", required: false, example: "Operational", help: "Operational, Needs repair, Down or Retired. Blank = Operational." },
  { key: "area", label: "Area (FOH / BOH)", required: false, example: "BOH", help: "Where it is in the store: FOH, BOH, Roof, Back lot…" },
  { key: "tag", label: "Barcode / Tag", required: false, example: "A-1042", help: "Asset tag or barcode number." },
  { key: "manufacturer", label: "Manufacturer", required: false, example: "True", help: "" },
  { key: "model", label: "Model", required: false, example: "TWT-48", help: "" },
  { key: "serial", label: "Serial Number", required: false, example: "1234567", help: "Used to match assets already in the app, so re-uploading updates instead of duplicating." },
  { key: "description", label: "Description", required: false, example: "2-door reach-in", help: "" },
  { key: "purchase_date", label: "Purchase Date", required: false, example: "11/15/2025", help: "Any date format Excel understands (11/15/25, 2025-11-15)." },
  { key: "install_date", label: "Install Date", required: false, example: "", help: "When it was installed / put in use." },
  { key: "service_date", label: "Service Date", required: false, example: "", help: "" },
  { key: "warranty", label: "Warranty Expiration", required: false, example: "11/15/2027", help: "" },
  { key: "cost", label: "Purchase Cost", required: false, example: "4500", help: "Dollars. Used for repair-vs-replace." },
  { key: "life", label: "Expected Life (years)", required: false, example: "10", help: "" },
  { key: "parts", label: "Parts", required: false, example: "Door gasket, Fan motor", help: "Part names, separated by commas." },
  { key: "notes", label: "Additional Information", required: false, example: "", help: "Anything else; shown as notes on the asset." },
] as const;

type ColKey = (typeof ASSET_COLUMNS)[number]["key"];

const ALIASES: Record<string, ColKey> = {
  location: "site", locationname: "site", site: "site", sitename: "site", sitecode: "site", store: "site", storeno: "site", storenumber: "site", storename: "site", restaurant: "site", property: "site", building: "site", facility: "site", parentlocation: "site", locationcode: "site",
  name: "name", assetname: "name", equipment: "name", equipmentname: "name", asset: "name", item: "name",
  category: "category", assetcategory: "category", type: "category", assettype: "category", equipmenttype: "category",
  status: "status", condition: "status", assetstatus: "status",
  area: "area", arealocatedinrestaurantfohorboh: "area", arealocatedinrestaurant: "area", locationinstore: "area", locationdetail: "area", room: "area", areafohboh: "area", fohboh: "area", sublocation: "area",
  tag: "tag", barcode: "tag", assettag: "tag", barcodetag: "tag", assetno: "tag", assetnumber: "tag", qrcode: "tag",
  manufacturer: "manufacturer", manufacturername: "manufacturer", make: "manufacturer", brand: "manufacturer", vendor: "manufacturer", vendormanufacturer: "manufacturer",
  model: "model", modelno: "model", modelnumber: "model",
  serial: "serial", serialno: "serial", serialnumber: "serial", sn: "serial",
  description: "description", desc: "description",
  purchasedate: "purchase_date", datepurchased: "purchase_date", purchased: "purchase_date", acquired: "purchase_date",
  installdate: "install_date", installeddate: "install_date", installed: "install_date", inservicedate: "install_date", dateinstalled: "install_date",
  servicedate: "service_date", lastservicedate: "service_date", lastservice: "service_date",
  warranty: "warranty", warrantyexpiration: "warranty", warrantyexpirationdate: "warranty", warrantyexpires: "warranty", warrantyend: "warranty", warrantydate: "warranty",
  cost: "cost", purchasecost: "cost", purchaseprice: "cost", price: "cost", value: "cost",
  life: "life", expectedlife: "life", expectedlifeyears: "life", usefullife: "life", lifeyears: "life",
  parts: "parts", partsnames: "parts", partnames: "parts", part: "parts", partslist: "parts",
  notes: "notes", note: "notes", additionalinformation: "notes", additionalinfo: "notes", comments: "notes", comment: "notes",
};

const normHeader = (h: string) => h.toLowerCase().replace(/#/g, "no").replace(/[^a-z0-9]/g, "");

export type AssetImportRow = {
  line: number;
  site: string | null;
  name: string | null;
  category: string;
  status: AssetStatus;
  location_detail: string | null;
  tag: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  description: string | null;
  purchase_date: string | null;
  install_date: string | null;
  service_date: string | null;
  warranty_expires_on: string | null;
  purchase_cost: number | null;
  expected_life_years: number | null;
  parts: string | null;
  notes: string | null;
  errors: string[];
  warnings: string[];
};

/** 11/15/25, 11/15/2025, 2025-11-15, Nov 15 2025, Excel serial numbers → YYYY-MM-DD. */
export function parseDate(raw: string | null, label: string, warnings: string[]): string | null {
  if (!raw) return null;
  const v = raw.trim();
  let y: number, m: number, d: number;
  let mt: RegExpMatchArray | null;
  if ((mt = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
  else if ((mt = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    [m, d, y] = [+mt[1], +mt[2], +mt[3]];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
  } else if (/^\d{5}$/.test(v)) {
    const t = new Date(Date.UTC(1899, 11, 30) + Number(v) * 864e5); // Excel serial date
    [y, m, d] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
  } else {
    const t = new Date(v);
    if (Number.isNaN(t.getTime())) {
      warnings.push(`${label} “${v}” isn't a date, left blank`);
      return null;
    }
    [y, m, d] = [t.getFullYear(), t.getMonth() + 1, t.getDate()];
  }
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d || y < 1950 || y > 2100) {
    warnings.push(`${label} “${v}” isn't a valid date, left blank`);
    return null;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function toStatus(v: string | null, warnings: string[]): AssetStatus {
  if (!v) return "operational";
  const s = v.toLowerCase().replace(/[^a-z]/g, "");
  if (["operational", "active", "working", "ok", "good", "running", "inservice", "online", "up"].includes(s)) return "operational";
  if (["needsrepair", "needsservice", "repair", "fair", "poor", "degraded", "needsattention", "warning"].includes(s)) return "needs_repair";
  if (["down", "notoperational", "nonoperational", "broken", "outofservice", "offline", "inoperable", "failed"].includes(s)) return "down";
  if (["retired", "disposed", "decommissioned", "removed", "sold", "scrapped", "inactive"].includes(s)) return "retired";
  warnings.push(`Status “${v.trim()}” set to Operational`);
  return "operational";
}

function toCategory(v: string | null): string {
  if (!v) return "Other";
  const k = v.toLowerCase().replace(/[^a-z]/g, "");
  const hit = CATEGORIES.find((c) => c.toLowerCase().replace(/[^a-z]/g, "") === k);
  if (hit) return hit;
  const loose: Record<string, string> = {
    hvacr: "HVAC", ac: "HVAC", airconditioning: "HVAC", heating: "HVAC", rtu: "HVAC", ventilation: "HVAC", exhaust: "HVAC",
    refrigerator: "Refrigeration", refrigerators: "Refrigeration", cooler: "Refrigeration", freezer: "Refrigeration", icemachine: "Refrigeration", walkin: "Refrigeration",
    kitchen: "Cooking", kitchenequipment: "Cooking", cookingequipment: "Cooking", fryer: "Cooking", oven: "Cooking", grill: "Cooking", foodequipment: "Cooking",
    plumbing: "Plumbing", waterheater: "Plumbing", electric: "Electrical", lighting: "Electrical",
    fire: "Fire/Life Safety", firesafety: "Fire/Life Safety", lifesafety: "Fire/Life Safety",
    it: "POS/IT", pos: "POS/IT", technology: "POS/IT", building: "Building", facility: "Building", structure: "Building", parking: "Grounds/Parking", grounds: "Grounds/Parking",
  };
  return loose[k] ?? v.replace(/\s+/g, " ").trim();
}

function buildRow(line: number, rec: Partial<Record<ColKey, string>>): AssetImportRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const clean = (k: ColKey) => {
    const v = rec[k]?.replace(/\s+/g, " ").trim();
    return v ? v : null;
  };
  const name = clean("name");
  if (!name) errors.push("Name is required");
  let cost: number | null = null;
  const costRaw = clean("cost");
  if (costRaw) {
    const n = Number(costRaw.replace(/[$,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0) cost = Math.round(n * 100) / 100;
    else warnings.push(`Purchase cost “${costRaw}” ignored`);
  }
  let life: number | null = null;
  const lifeRaw = clean("life");
  if (lifeRaw) {
    const n = Math.round(Number(lifeRaw.replace(/years?|yrs?/gi, "").trim()));
    if (Number.isFinite(n) && n > 0 && n < 100) life = n;
    else warnings.push(`Expected life “${lifeRaw}” ignored`);
  }
  const rawCategory = clean("category");
  const category = toCategory(rawCategory);
  if (rawCategory && !(CATEGORIES as readonly string[]).includes(category)) warnings.push(`New category “${category}”`);
  return {
    line,
    site: clean("site"),
    name,
    category,
    status: toStatus(clean("status"), warnings),
    location_detail: clean("area"),
    tag: clean("tag"),
    manufacturer: clean("manufacturer"),
    model: clean("model"),
    serial_number: clean("serial"),
    description: clean("description"),
    purchase_date: parseDate(clean("purchase_date"), "Purchase date", warnings),
    install_date: parseDate(clean("install_date"), "Install date", warnings),
    service_date: parseDate(clean("service_date"), "Service date", warnings),
    warranty_expires_on: parseDate(clean("warranty"), "Warranty date", warnings),
    purchase_cost: cost,
    expected_life_years: life,
    parts: clean("parts"),
    notes: rec.notes?.trim() || null,
    errors,
    warnings,
  };
}

export const MAX_ASSET_ROWS = 3000;

/** Reads an uploaded .xlsx / .csv of assets into validated rows (locations are matched later). */
export async function parseAssetFile(file: File): Promise<{ rows: AssetImportRow[]; unknownHeaders: string[] }> {
  if (!file || file.size === 0) throw new Error("Choose a file to upload.");
  if (file.size > 10 * 1024 * 1024) throw new Error("That file is over 10 MB. Remove extra sheets or images and try again.");
  const grid = await readGrid(file, "assets");

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

  const rows: AssetImportRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells.some((c) => c && c.trim())) continue;
    const rec: Partial<Record<ColKey, string>> = {};
    map.forEach((k, ci) => {
      if (!k || cells[ci] == null || !String(cells[ci]).trim()) return;
      // Two columns for the same field (e.g. Description + Additional Information both → notes): keep both.
      rec[k] = rec[k] ? `${rec[k]}\n${cells[ci]}` : String(cells[ci]);
    });
    if (rec.name === "Walk-in Cooler" && rec.model === "TWT-48") continue; // template example row
    rows.push(buildRow(i + 1, rec));
    if (rows.length > MAX_ASSET_ROWS) throw new Error(`Up to ${MAX_ASSET_ROWS} assets per upload. Split the file and upload in parts.`);
  }
  if (!rows.length) throw new Error("No asset rows found under the header row.");
  return { rows, unknownHeaders };
}

/** Template workbook: Assets sheet (location dropdown), Locations sheet, Instructions. */
export async function buildAssetTemplate(locations: { code: string | null; name: string }[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MaintenanceOS";
  const ws = wb.addWorksheet("Assets", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = ASSET_COLUMNS.map((c) => ({ header: c.required ? `${c.label} *` : c.label, key: c.key, width: Math.max(12, c.label.length + 4, c.example.length + 2) }));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3459BF" } };
  const first = locations[0];
  ws.addRow(Object.fromEntries(ASSET_COLUMNS.map((c) => [c.key, c.key === "site" && first ? first.code ?? first.name : c.example])));
  ws.getRow(2).font = { italic: true, color: { argb: "FF64748B" } };
  for (const k of ["site", "tag", "serial", "model"]) ws.getColumn(k).numFmt = "@";
  for (const k of ["purchase_date", "install_date", "service_date", "warranty"]) ws.getColumn(k).numFmt = "mm/dd/yyyy";

  const list = (col: string, formula: string, title: string, error: string, strict = true) => {
    const letter = ws.getColumn(col).letter;
    for (let r = 2; r <= 3001; r++)
      ws.getCell(`${letter}${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [formula], showErrorMessage: strict, errorTitle: title, error };
  };
  list("status", '"Operational,Needs repair,Down,Retired"', "Status", "Pick Operational, Needs repair, Down or Retired");
  list("area", '"FOH,BOH,Roof,Drive-thru,Exterior,Office"', "Area", "", false);

  const cs = wb.addWorksheet("Categories");
  cs.columns = [{ header: "Category", key: "c", width: 24 }];
  cs.getRow(1).font = { bold: true };
  CATEGORIES.forEach((c) => cs.addRow({ c }));
  list("category", `Categories!$A$2:$A$${CATEGORIES.length + 1}`, "Category", "", false);

  if (locations.length) {
    const ls = wb.addWorksheet("Locations");
    ls.columns = [
      { header: "Location (use in the Location column)", key: "v", width: 34 },
      { header: "Name", key: "n", width: 40 },
    ];
    ls.getRow(1).font = { bold: true };
    locations.forEach((l) => ls.addRow({ v: l.code ?? l.name, n: l.name }));
    ls.getColumn("v").numFmt = "@";
    list("site", `Locations!$A$2:$A$${locations.length + 1}`, "Location", "Pick a location from the list (add new locations on the Sites page first)");
  }

  const help = wb.addWorksheet("Instructions");
  help.columns = [
    { header: "Column", key: "c", width: 24 },
    { header: "What to enter", key: "h", width: 100 },
  ];
  help.getRow(1).font = { bold: true };
  for (const c of ASSET_COLUMNS) help.addRow({ c: c.required ? `${c.label} *` : c.label, h: c.help || "Optional." });
  help.addRow({});
  help.addRow({ c: "Tips", h: "Replace the grey example row with your equipment, one asset per row. * = required." });
  help.addRow({ c: "", h: "Re-uploading updates assets already at that location (matched by serial #, then barcode/tag, then name). Blank cells never erase existing data." });
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
