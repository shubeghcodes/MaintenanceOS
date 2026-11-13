import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getReceiptsToReview } from "@/lib/company";

/** Analytics opens on Purchases when receipts are waiting for review, otherwise on R&M spending. */
export default async function AnalyticsPage() {
  await requireRole("admin");
  redirect((await getReceiptsToReview()) ? "/purchases?status=review" : "/rm");
}
