import "server-only";
import ExcelJS from "exceljs";
import { readGrid } from "./site-import";

/** Columns the user import understands. Headers are matched loosely (case, spaces and punctuation ignored). */
export const USER_COLUMNS = [
  { key: "email", label: "Email", required: true, example: "gm.1450@example.com", help: "Login email (required). Someone already in the system is updated, not invited again." },
  { key: "name", label: "Name", required: false, example: "Maria Lopez", help: "Full name." },
  { key: "role", label: "Role", required: false, example: "Manager", help: "Manager, Tech or Admin. Blank = Manager. Vendor logins are set up on the Users page." },
  { key: "phone", label: "Phone", required: false, example: "(702) 555-0100", help: "" },
  { key: "stores", label: "Store #", required: false, example: "DT-1450", help: "The location(s) this person can see. Several? Separate with commas: DT-1450, DT-1451. ALL = every location (in the Company column, if filled). See the Stores sheet for the codes." },
  { key: "company", label: "Company", required: false, example: "", help: "Optional. With Store # blank or ALL, gives access to every location in this company." },
  { key: "hourly_rate", label: "Hourly Rate", required: false, example: "", help: "Techs and admins only. Labor rate in $/hr, effective today. Only admins can see rates." },
] as const;

type ColKey = (typeof USER_COLUMNS)[number]["key"];

const ALIASES: Record<string, ColKey> = {
  email: "email", emailaddress: "email", workemail: "email", login: "email", username: "email", manageremail: "email", gmemail: "email", techemail: "email",
  name: "name", fullname: "name", employee: "name", employeename: "name", managername: "name", gmname: "name", techname: "name", technician: "name", contact: "name",
  role: "role", position: "role", title: "role", jobtitle: "role", usertype: "role", access: "role", type: "role",
  phone: "phone", phonenumber: "phone", cell: "phone", mobile: "phone", cellphone: "phone",
  stores: "stores", store: "stores", storeno: "stores", storenumber: "stores", storenumbers: "stores", storecode: "stores", storecodes: "stores",
  site: "stores", sites: "stores", sitecode: "stores", location: "stores", locations: "stores", unit: "stores", units: "stores",
  company: "company", companyname: "company", corporation: "company", entity: "company",
  hourlyrate: "hourly_rate", rate: "hourly_rate", payrate: "hourly_rate", laborrate: "hourly_rate", wage: "hourly_rate", hourly: "hourly_rate",
};

const normHeader = (h: string) => h.toLowerCase().replace(/#/g, "no").replace(/[^a-z0-9]/g, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ImportRole = "manager" | "tech" | "admin";

export type UserImportRow = {
  line: number;
  email: string | null;
  name: string | null;
  role: ImportRole;
  roleGiven: boolean;
  phone: string | null;
  stores: string[]; // codes as typed; ["ALL"] for every location
  company: string | null;
  hourly_rate: number | null;
  errors: string[];
  warnings: string[];
};

function toRole(v: string | null, errors: string[]): ImportRole {
  if (!v) return "manager";
  const t = v.toLowerCase().replace(/[^a-z]/g, "");
  if (["manager", "gm", "generalmanager", "storemanager", "propertymanager", "restaurantmanager", "mgr", "agm", "assistantmanager", "shiftmanager"].includes(t)) return "manager";
  if (["tech", "technician", "maintenance", "maintenancetech", "maint", "handyman", "facilities", "facilitytech", "repair", "maintenancetechnician"].includes(t)) return "tech";
  if (["admin", "administrator", "owner", "director", "operations", "opsmanager", "operationsmanager"].includes(t)) return "admin";
  if (t === "vendor") errors.push("Vendor logins can’t be imported; set them up on the Users page");
  else errors.push(`Role “${v}” not recognised (use Manager, Tech or Admin)`);
  return "manager";
}

function buildRow(line: number, rec: Partial<Record<ColKey, string>>): UserImportRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const clean = (k: ColKey) => {
    const v = rec[k]?.replace(/\s+/g, " ").trim();
    return v ? v : null;
  };
  const email = clean("email")?.toLowerCase().replace(/^mailto:/, "") ?? null;
  if (!email) errors.push("Email is required");
  else if (!EMAIL_RE.test(email)) errors.push(`“${email}” isn’t a valid email`);
  const roleRaw = clean("role");
  const role = toRole(roleRaw, errors);
  const stores = (clean("stores") ?? "")
    .split(/[,;\n/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const all = stores.some((s) => s.toLowerCase() === "all");
  let rate: number | null = null;
  const rateRaw = clean("hourly_rate");
  if (rateRaw) {
    const n = Number(rateRaw.replace(/[$,\s]|\/?\s*h(ou)?r/gi, ""));
    if (Number.isFinite(n) && n >= 0) rate = Math.round(n * 100) / 100;
    else errors.push(`Hourly rate “${rateRaw}” isn’t a number`);
  }
  if (rate != null && role === "manager") warnings.push("Hourly rate ignored for managers");
  return {
    line,
    email,
    name: clean("name"),
    role,
    roleGiven: !!roleRaw,
    phone: clean("phone"),
    stores: all ? ["ALL"] : Array.from(new Set(stores)),
    company: clean("company"),
    hourly_rate: role === "manager" ? null : rate,
    errors,
    warnings,
  };
}

export const MAX_USER_ROWS = 500;

export async function parseUserFile(file: File): Promise<{ rows: UserImportRow[]; unknownHeaders: string[] }> {
  if (!file || file.size === 0) throw new Error("Choose a file to upload.");
  if (file.size > 10 * 1024 * 1024) throw new Error("That file is over 10 MB.");
  const grid = await readGrid(file, "users");
  let headerIdx = -1;
  let map: (ColKey | null)[] = [];
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const m = grid[i].map((h) => ALIASES[normHeader(h)] ?? null);
    if (m.includes("email")) {
      headerIdx = i;
      map = m;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Couldn’t find a header row with an “Email” column. Download the template to see the expected columns.");
  const unknownHeaders = grid[headerIdx].filter((h, i) => h.trim() && !map[i]).map((h) => h.trim());

  const rows: UserImportRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells.some((c) => c && c.trim())) continue;
    const rec: Partial<Record<ColKey, string>> = {};
    map.forEach((k, ci) => {
      if (k && cells[ci] != null && !rec[k]) rec[k] = String(cells[ci]);
    });
    if (rec.email === USER_COLUMNS[0].example) continue; // template example row left in
    rows.push(buildRow(i + 1, rec));
    if (rows.length > MAX_USER_ROWS) throw new Error(`Up to ${MAX_USER_ROWS} people per upload. Split the file and upload in parts.`);
  }
  if (!rows.length) throw new Error("No people found under the header row.");

  const seen = new Map<string, number>();
  for (const r of rows) {
    if (!r.email) continue;
    if (seen.has(r.email)) r.errors.push(`Same email as row ${seen.get(r.email)}; combine their stores on one row`);
    else seen.set(r.email, r.line);
  }
  return { rows, unknownHeaders };
}

/** Template: Users sheet (with Role dropdown), Stores sheet listing every location's code, and instructions. */
export async function buildUserTemplate(stores: { code: string | null; name: string; city: string | null; company: string | null }[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MaintenanceOS";
  const ws = wb.addWorksheet("Users", { views: [{ state: "frozen", ySplit: 1 }] });
  const example = stores.find((s) => s.code)?.code ?? USER_COLUMNS.find((c) => c.key === "stores")!.example;
  ws.columns = USER_COLUMNS.map((c) => ({ header: c.required ? `${c.label} *` : c.label, key: c.key, width: Math.max(14, c.label.length + 4, String(c.example).length + 2) }));
  ws.getColumn("stores").width = 26;
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3459BF" } };
  ws.addRow(Object.fromEntries(USER_COLUMNS.map((c) => [c.key, c.key === "stores" ? example : c.example])));
  ws.getRow(2).font = { italic: true, color: { argb: "FF64748B" } };
  ws.getColumn("stores").numFmt = "@";
  ws.getColumn("phone").numFmt = "@";
  const roleCol = ws.getColumn("role").letter;
  for (let r = 2; r <= 501; r++) {
    ws.getCell(`${roleCol}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Manager,Tech,Admin"'],
      showErrorMessage: true,
      errorTitle: "Role",
      error: "Pick Manager, Tech or Admin",
    };
  }

  const ss = wb.addWorksheet("Stores");
  ss.columns = [
    { header: "Store #", key: "code", width: 14 },
    { header: "Name", key: "name", width: 34 },
    { header: "City", key: "city", width: 18 },
    { header: "Company", key: "company", width: 28 },
  ];
  ss.getRow(1).font = { bold: true };
  for (const s of stores) ss.addRow(s);

  const help = wb.addWorksheet("Instructions");
  help.columns = [
    { header: "Column", key: "c", width: 16 },
    { header: "What to enter", key: "h", width: 110 },
  ];
  help.getRow(1).font = { bold: true };
  for (const c of USER_COLUMNS) help.addRow({ c: c.required ? `${c.label} *` : c.label, h: c.help || "Optional." });
  help.addRow({});
  help.addRow({ c: "Tips", h: "Replace the grey example row with your people, one per row. * = required." });
  help.addRow({ c: "", h: "New emails get an invite to set a password. People already in MaintenanceOS are updated: blank cells never erase anything, and stores are added (never removed)." });
  help.addRow({ c: "", h: "Managers and techs only see the locations they're given. Admins see every location." });
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
