import type { CostCategory, QuoteStatus, PaymentMethod, PurchaseStatus, ApprovalStatus, AssetStatus, DispatchStatus, FreqUnit, InvoiceStatus, SiteType, UserRole, WoPriority, WoStatus, WoType } from "./types";

export const CATEGORIES = [
  "HVAC",
  "Refrigeration",
  "Cooking",
  "Plumbing",
  "Electrical",
  "Fire/Life Safety",
  "Building",
  "Grounds/Parking",
  "POS/IT",
  "Pest Control",
  "Health/Sanitation",
  "Permits",
  "Other",
] as const;

export const SITE_TYPE_LABEL: Record<SiteType, string> = {
  qsr: "QSR",
  dine_in: "Dine-in",
  cre: "Commercial RE",
};

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Store / Property Manager",
  tech: "Technician",
  vendor: "Vendor",
};

export const STATUS_LABEL: Record<WoStatus, string> = {
  requested: "Needs approval",
  new: "New",
  assigned: "Assigned",
  in_progress: "In progress",
  on_hold: "On hold",
  pending_approval: "Extra work approval",
  pending_review: "Pending review",
  awaiting_signoff: "Awaiting GM sign-off",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const OPEN_STATUSES: WoStatus[] = ["requested", "new", "assigned", "in_progress", "on_hold", "pending_approval", "pending_review", "awaiting_signoff"];
/** Work is done; waiting for the store's GM to confirm (auto-closes after this many days). */
export const SIGNOFF_AUTO_CLOSE_DAYS = 3;

export const PRIORITY_LABEL: Record<WoPriority, string> = {
  emergency: "Emergency",
  high: "High",
  medium: "Medium",
  low: "Low",
};
export const PRIORITY_SLA: Record<WoPriority, string> = {
  emergency: "4 hours",
  high: "24 hours",
  medium: "3 days",
  low: "7 days",
};

export const TYPE_LABEL: Record<WoType, string> = {
  reactive: "Reactive",
  preventive: "Preventive",
  compliance: "Compliance",
  project: "Project",
};

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  operational: "Operational",
  needs_repair: "Needs repair",
  down: "Down",
  retired: "Retired",
};

export const FREQ_UNIT_LABEL: Record<FreqUnit, string> = { day: "day", week: "week", month: "month", year: "year" };

/** Tone classes used by <Badge>. Status colors always ship with a text label. */
export type Tone = "neutral" | "info" | "good" | "warning" | "serious" | "critical" | "muted";

/** Open and approved: what can be scheduled and worked. */
export const WORKABLE_STATUSES: WoStatus[] = ["new", "assigned", "in_progress", "on_hold", "pending_approval", "pending_review"];

export const STATUS_TONE: Record<WoStatus, Tone> = {
  requested: "serious",
  new: "info",
  assigned: "info",
  in_progress: "warning",
  on_hold: "muted",
  pending_approval: "serious",
  pending_review: "serious",
  awaiting_signoff: "warning",
  completed: "good",
  cancelled: "muted",
};
export const PRIORITY_TONE: Record<WoPriority, Tone> = {
  emergency: "critical",
  high: "serious",
  medium: "warning",
  low: "neutral",
};
export const ASSET_STATUS_TONE: Record<AssetStatus, Tone> = {
  operational: "good",
  needs_repair: "warning",
  down: "critical",
  retired: "muted",
};

export const DISPATCH_LABEL: Record<DispatchStatus, string> = {
  sent: "Sent — awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  in_progress: "In progress",
  pending_approval: "Pending approval",
  work_completed: "Work completed",
  closed: "Closed",
  revoked: "Access revoked",
};
export const DISPATCH_TONE: Record<DispatchStatus, Tone> = {
  sent: "info",
  accepted: "info",
  declined: "critical",
  in_progress: "warning",
  pending_approval: "serious",
  work_completed: "serious",
  closed: "good",
  revoked: "muted",
};
export const ACTIVE_DISPATCH: DispatchStatus[] = ["sent", "accepted", "in_progress", "pending_approval", "work_completed"];

export const INVOICE_LABEL: Record<InvoiceStatus | "none", string> = {
  none: "Not submitted",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Revision requested",
  paid: "Paid",
};
export const INVOICE_TONE: Record<InvoiceStatus | "none", Tone> = {
  none: "muted",
  submitted: "serious",
  under_review: "warning",
  approved: "info",
  rejected: "critical",
  paid: "good",
};
export const APPROVAL_LABEL: Record<ApprovalStatus, string> = { pending: "Awaiting decision", approved: "Approved", rejected: "Rejected" };
export const APPROVAL_TONE: Record<ApprovalStatus, Tone> = { pending: "serious", approved: "good", rejected: "critical" };

export const QUOTE_LABEL: Record<QuoteStatus | "none", string> = {
  none: "No quote",
  submitted: "Awaiting decision",
  approved: "Approved",
  rejected: "Not approved",
  superseded: "Replaced by revision",
};
export const QUOTE_TONE: Record<QuoteStatus | "none", Tone> = { none: "muted", submitted: "serious", approved: "good", rejected: "critical", superseded: "muted" };
export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  labor: "Labor",
  materials: "Parts & materials",
  trip: "Trip / service call",
  equipment: "Equipment rental",
  other: "Other",
};

/** How long a vendor link works before it must be renewed. */
export const VENDOR_LINK_DAYS = 90;

export const PURCHASE_CATEGORIES = ["Parts", "Materials", "Tools", "Equipment rental", "Supplies", "Other"] as const;
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  company_card: "Company card",
  store_account: "Store / supplier account",
  petty_cash: "Petty cash",
  personal: "Personal (reimburse me)",
  other: "Other",
};
export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = { submitted: "Needs review", approved: "Approved", rejected: "Rejected" };
export const PURCHASE_STATUS_TONE: Record<PurchaseStatus, Tone> = { submitted: "warning", approved: "good", rejected: "critical" };
