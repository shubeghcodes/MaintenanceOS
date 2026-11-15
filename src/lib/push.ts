import "server-only";
import webpush from "web-push";
import { createAdminClient } from "./supabase/admin";

/**
 * Web push for the installed app. Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, or from the
 * server-only app_secrets table (vapid_public_key / vapid_private_key) when those aren't set.
 * Every function here is best-effort: push never blocks or breaks the action that triggered it.
 */

type Vapid = { publicKey: string; privateKey: string };
let cached: Vapid | null | undefined;

export async function getVapid(): Promise<Vapid | null> {
  if (cached !== undefined) return cached;
  const envPub = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (envPub && process.env.VAPID_PRIVATE_KEY) return (cached = { publicKey: envPub, privateKey: process.env.VAPID_PRIVATE_KEY });
  try {
    const db = createAdminClient();
    const read = async () => {
      const { data, error } = await db.from("app_secrets").select("key,value").in("key", ["vapid_public_key", "vapid_private_key"]);
      if (error) throw error;
      const m = new Map((data ?? []).map((r) => [r.key as string, r.value as string]));
      const pub = m.get("vapid_public_key");
      const priv = m.get("vapid_private_key");
      return pub && priv ? { publicKey: pub, privateKey: priv } : null;
    };
    let keys = await read();
    if (!keys) {
      // First use: create the key pair on the server and store it (the private key never leaves the server).
      const k = webpush.generateVAPIDKeys();
      await db.from("app_secrets").upsert(
        [
          { key: "vapid_public_key", value: k.publicKey },
          { key: "vapid_private_key", value: k.privateKey },
        ],
        { onConflict: "key", ignoreDuplicates: true },
      );
      keys = await read(); // if two servers raced, everyone uses whichever pair was stored first
    }
    cached = keys;
  } catch {
    return null; // don't cache a failure; try again on the next request
  }
  return cached;
}

export async function getVapidPublicKey() {
  return (await getVapid())?.publicKey ?? null;
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string };

/** Sends to every device the given people turned notifications on for. Expired devices are removed. */
export async function pushToUsers(userIds: string[], payload: PushPayload) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return { sent: 0 };
  const vapid = await getVapid();
  if (!vapid) return { sent: 0 };
  const db = createAdminClient();
  const { data: subs } = await db.from("push_subscriptions").select("id,endpoint,p256dh,auth").in("user_id", ids);
  if (!subs?.length) return { sent: 0 };

  const contact = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "admin@example.com";
  const body = JSON.stringify({ ...payload, body: payload.body?.slice(0, 180) });
  let sent = 0;
  const dead: string[] = [];
  const ok: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          vapidDetails: { subject: `mailto:${contact}`, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
          TTL: 60 * 60 * 24,
          urgency: "high",
        });
        sent++;
        ok.push(s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id); // unsubscribed / app removed
      }
    }),
  );
  if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);
  if (ok.length) await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).in("id", ok);
  return { sent };
}

/** Same as pushToUsers, for code that only knows email addresses (the email notifications). */
export async function pushToEmails(emails: string | string[], payload: PushPayload) {
  try {
    const list = [...new Set((Array.isArray(emails) ? emails : [emails]).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (!list.length || !(await getVapid())) return { sent: 0 };
    // Small table: match case-insensitively in code rather than relying on how emails were typed.
    const { data } = await createAdminClient().from("profiles").select("id,email").eq("active", true).not("email", "is", null);
    const want = new Set(list);
    const ids = (data ?? []).filter((p) => want.has(String(p.email).toLowerCase())).map((p) => p.id as string);
    return await pushToUsers(ids, payload);
  } catch {
    return { sent: 0 };
  }
}
