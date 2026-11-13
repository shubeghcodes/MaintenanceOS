export type UserRole = "admin" | "manager" | "tech" | "vendor";
export type SiteType = "qsr" | "dine_in" | "cre";
export type AssetStatus = "operational" | "needs_repair" | "down" | "retired";
export type WoPriority = "emergency" | "high" | "medium" | "low";
export type WoStatus = "new" | "assigned" | "in_progress" | "on_hold" | "pending_approval" | "pending_review" | "completed" | "cancelled";
export type DispatchStatus = "sent" | "accepted" | "declined" | "in_progress" | "pending_approval" | "work_completed" | "closed" | "revoked";
export type InvoiceStatus = "submitted" | "under_review" | "approved" | "rejected" | "paid";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type QuoteStatus = "submitted" | "approved" | "rejected" | "superseded";
export type CostCategory = "labor" | "materials" | "trip" | "equipment" | "other";
export type WoType = "reactive" | "preventive" | "compliance" | "project";
export type FreqUnit = "day" | "week" | "month" | "year";
export type ComplianceResult = "pass" | "fail" | "conditional";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  vendor_id: string | null;
  active: boolean;
  is_super?: boolean;
}

export interface Site {
  id: string;
  code: string | null;
  name: string;
  type: SiteType;
  brand: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  sq_ft: number | null;
  notes: string | null;
  active: boolean;
}

export interface Vendor {
  id: string;
  name: string;
  trades: string[];
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  after_hours_phone: string | null;
  license_number: string | null;
  coi_expires_on: string | null;
  hourly_rate: number | null;
  rating: number | null;
  notes: string | null;
  active: boolean;
}

export interface Asset {
  id: string;
  site_id: string;
  name: string;
  tag: string | null;
  category: string;
  location_detail: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  warranty_expires_on: string | null;
  purchase_cost: number | null;
  expected_life_years: number | null;
  status: AssetStatus;
  notes: string | null;
}

export interface WorkOrder {
  id: string;
  number: number;
  site_id: string;
  asset_id: string | null;
  title: string;
  description: string | null;
  category: string;
  location_detail: string | null;
  priority: WoPriority;
  status: WoStatus;
  type: WoType;
  requested_by: string | null;
  assigned_tech_id: string | null;
  vendor_id: string | null;
  due_at: string | null;
  nte_amount: number | null;
  labor_hours: number;
  visit?: number;
  labor_cost: number;
  parts_cost: number;
  vendor_invoice_amount: number;
  invoice_number: string | null;
  total_cost: number;
  resolution_notes: string | null;
  pm_schedule_id: string | null;
  compliance_requirement_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  scheduled_date: string | null;
  scheduled_start: string | null;
  estimated_hours: number | null;
  certificate_number: string | null;
  purchases_cost: number;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderEvent {
  id: string;
  work_order_id: string;
  user_id: string | null;
  kind: string;
  body: string | null;
  actor_type: "user" | "vendor" | "system" | null;
  actor_label: string | null;
  visibility: "internal" | "shared";
  meta: Record<string, unknown> | null;
  from_status: WoStatus | null;
  to_status: WoStatus | null;
  created_at: string;
}

export interface PmSchedule {
  id: string;
  title: string;
  site_id: string;
  asset_id: string | null;
  category: string;
  instructions: string | null;
  checklist: string[];
  frequency_interval: number;
  frequency_unit: FreqUnit;
  next_due_on: string;
  lead_days: number;
  priority: WoPriority;
  assigned_tech_id: string | null;
  vendor_id: string | null;
  estimated_hours: number | null;
  active: boolean;
  last_generated_on: string | null;
  last_completed_on: string | null;
}

export interface ComplianceRequirement {
  id: string;
  site_id: string;
  name: string;
  category: string;
  authority: string | null;
  frequency_interval: number;
  frequency_unit: FreqUnit;
  last_completed_on: string | null;
  next_due_on: string;
  lead_days: number;
  auto_create_wo: boolean;
  auto_dispatch: boolean;
  scheduled_for: string | null;
  vendor_id: string | null;
  notes: string | null;
  active: boolean;
}

export interface ComplianceRecord {
  id: string;
  requirement_id: string;
  completed_on: string;
  result: ComplianceResult;
  vendor_id: string | null;
  work_order_id: string | null;
  certificate_number: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface Attachment {
  id: string;
  entity_type: "work_order" | "asset" | "compliance";
  entity_id: string;
  storage_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  category: string;
  visibility: "shared" | "internal";
  dispatch_id: string | null;
  uploaded_by_label: string | null;
  created_at: string;
}

export interface VendorDispatch {
  id: string;
  work_order_id: string;
  vendor_id: string;
  contact_name: string | null;
  contact_email: string;
  contact_phone: string | null;
  instructions: string | null;
  requested_by: string | null;
  token_expires_at: string;
  status: DispatchStatus;
  email_status: string;
  email_error: string | null;
  sent_at: string | null;
  last_emailed_at: string | null;
  last_reminded_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  started_at: string | null;
  completed_at: string | null;
  completion_notes: string | null;
  closed_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
  quote_required?: boolean;
}

export type QuoteLine = { category: CostCategory; description: string; quantity: number; unit_cost: number; amount: number };

export interface VendorQuote {
  id: string;
  work_order_id: string;
  dispatch_id: string;
  vendor_id: string;
  quote_number: string | null;
  amount: number;
  scope: string;
  lines: QuoteLine[];
  valid_until: string | null;
  attachment_id: string | null;
  status: QuoteStatus;
  version: number;
  submitted_by_label: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface VendorCostLine {
  id: string;
  work_order_id: string;
  dispatch_id: string;
  vendor_id: string;
  category: CostCategory;
  description: string;
  quantity: number;
  unit_cost: number;
  amount: number;
  attachment_id: string | null;
  added_by_label: string | null;
  created_at: string;
}

export interface ApprovalRequest {
  id: string;
  dispatch_id: string;
  work_order_id: string;
  description: string;
  amount: number | null;
  status: ApprovalStatus;
  requested_by_label: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface VendorInvoice {
  id: string;
  work_order_id: string;
  dispatch_id: string | null;
  vendor_id: string;
  invoice_number: string;
  invoice_date: string;
  amount: number;
  notes: string | null;
  status: InvoiceStatus;
  attachment_id: string | null;
  version: number;
  submitted_by_label: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  created_at: string;
}

export type PurchaseStatus = "submitted" | "approved" | "rejected";
export type PaymentMethod = "company_card" | "store_account" | "petty_cash" | "personal" | "other";

export interface Purchase {
  id: string;
  work_order_id: string;
  store: string;
  purchase_date: string;
  category: string;
  description: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number;
  payment_method: PaymentMethod;
  card_last4: string | null;
  receipt_attachment_id: string | null;
  status: PurchaseStatus;
  review_note: string | null;
  reviewed_at: string | null;
  reimbursable: boolean;
  reimbursed_at: string | null;
  reimbursement_ref: string | null;
  purchased_by: string | null;
  created_at: string;
}
