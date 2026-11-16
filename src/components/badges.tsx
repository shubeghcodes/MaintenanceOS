"use client";

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
import { useT } from "@/lib/i18n/client";

export function StatusBadge({ status }: { status: WoStatus }) {
  const t = useT();
  return <Badge tone={STATUS_TONE[status]}>{t(STATUS_LABEL[status])}</Badge>;
}
export function PriorityBadge({ priority }: { priority: WoPriority }) {
  const t = useT();
  return <Badge tone={PRIORITY_TONE[priority]}>{t(PRIORITY_LABEL[priority])}</Badge>;
}
export function TypeBadge({ type }: { type: WoType }) {
  const t = useT();
  return (
    <Badge tone="neutral" dot={false}>
      {t(TYPE_LABEL[type])}
    </Badge>
  );
}
export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  const t = useT();
  return <Badge tone={ASSET_STATUS_TONE[status]}>{t(ASSET_STATUS_LABEL[status])}</Badge>;
}

export function OverdueBadge({ dueAt, status }: { dueAt: string | null; status: string }) {
  const t = useT();
  return isOverdue(dueAt, status) ? <Badge tone="critical">{t("Overdue")}</Badge> : null;
}

/** Due-date health for compliance items, COIs, warranties. */
export function DueBadge({ date, soonDays = 30, label }: { date: string | null; soonDays?: number; label?: string }) {
  const t = useT();
  const d = daysUntil(date);
  if (d == null) return <Badge tone="muted">{t("Not set")}</Badge>;
  if (d < 0) return <Badge tone="critical">{label ?? t("Overdue")} · {-d}d</Badge>;
  if (d <= soonDays) return <Badge tone="warning">{t("Due in {n}d", { n: d })}</Badge>;
  return <Badge tone="good">{t("Current")}</Badge>;
}
