import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Saves this device's push subscription for the signed-in person (POST) or removes it (DELETE). */
async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("id,active").eq("id", user.id).single();
  return profile?.active ? user : null;
}

type Sub = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sub = (await request.json().catch(() => null)) as Sub | null;
  const endpoint = sub?.endpoint;
  if (!endpoint || !/^https:\/\//.test(endpoint) || !sub?.keys?.p256dh || !sub.keys.auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  // A device belongs to whoever turned notifications on last (shared phones / switching accounts).
  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
      { onConflict: "endpoint" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { endpoint } = ((await request.json().catch(() => ({}))) ?? {}) as { endpoint?: string };
  if (endpoint) await createAdminClient().from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
