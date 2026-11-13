"use server";

import { getSession } from "@/lib/auth";

/** Remember that the signed-in person finished or skipped the onboarding tour. */
export async function saveTourState(outcome: "completed" | "skipped") {
  const { supabase } = await getSession();
  await supabase.rpc("set_tour_state", { p_outcome: outcome });
}
