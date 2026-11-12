import { Badge } from "./ui";
import {
  ASSET_STATUS_LABEL,
  ASSET_STATUS_TONE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  TYPE_LABEL,
} from "@/lib/constants";
import type { AssetStatus, WoPriority, WoStatus, WoType } from "@/lib/types";
import { daysUntil, isOverdue } from "@/lib/format";

export const StatusBadge = ({ status }: { status: WoStatus }) => (
  <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
);
export const PriorityBadge = ({ priority }: { priority: WoPriority }) => (
  <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>
);
export const TypeBadge = ({ type }: { type: WoType }) => (
  <Badge tone="neutral" dot={false}>
    {TYPE_LABEL[type]}
  </Badge>
);
export const AssetStatusBadge = ({ status }: { status: AssetStatus }) => (
  <Badge tone={ASSET_STATUS_TONE[status]}>{ASSET_STATUS_LABEL[status]}</Badge>
);

export function OverdueBadge({ dueAt, status }: { dueAt: string | null; status: string }) {
  return isOverdue(dueAt, status) ? <Badge tone="critical">Overdue</Badge> : null;
}

/** Due-date health for compliance items, COIs, warranties. */
export function DueBadge({ date, soonDays = 30, label }: { date: string | null; soonDays?: number; label?: string }) {
  const d = daysUntil(date);
  if (d == null) return <Badge tone="muted">Not set</Badge>;
  if (d < 0) return <Badge tone="critical">{label ?? "Overdue"} · {-d}d</Badge>;
  if (d <= soonDays) return <Badge tone="warning">Due in {d}d</Badge>;
  return <Badge tone="good">Current</Badge>;
}
