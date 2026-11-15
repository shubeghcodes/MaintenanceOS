import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pushToUsers } from "@/lib/push";

/** Sends a test notification to the signed-in person's devices. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { sent } = await pushToUsers([user.id], {
    title: "Notifications are on",
    body: "You'll get work order alerts on this device.",
    url: "/",
    tag: "test",
  });
  return NextResponse.json({ ok: sent > 0, sent });
}
