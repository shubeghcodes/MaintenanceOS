"use client";

/** Browser-side helpers for push notifications. */

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function keyToBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Asks permission (must be called from a tap), subscribes this device and saves it. Returns an error message or null. */
export async function enablePush(vapidPublicKey: string): Promise<string | null> {
  if (!pushSupported()) {
    return isIos() && !isStandalone()
      ? "On iPhone, add MaintenanceOS to your Home Screen first, then turn on notifications from the app."
      : "This browser doesn't support notifications.";
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "Notifications are blocked. Allow them for this site in your phone or browser settings.";
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(vapidPublicKey) });
  const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  return res.ok ? null : "Couldn't save this device. Try again.";
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

export function remember(key: string, days: number) {
  try {
    localStorage.setItem(key, String(Date.now() + days * 864e5));
  } catch {}
}
export function remembered(key: string) {
  try {
    return Number(localStorage.getItem(key) ?? 0) > Date.now();
  } catch {
    return false;
  }
}
