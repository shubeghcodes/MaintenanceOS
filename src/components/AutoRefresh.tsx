"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches server data periodically while the tab is visible, so vendor activity shows up without reloading. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      // Don't refresh while someone is typing in a form.
      const el = document.activeElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (document.visibilityState === "visible" && !typing) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
