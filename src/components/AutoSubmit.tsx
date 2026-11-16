"use client";

import { useEffect, useRef } from "react";

/**
 * Put inside a GET filter form: changing a dropdown, checkbox or date applies the filter right away
 * (no need to press Filter). Typing in a search box still waits for Enter or the Filter button.
 */
export function AutoSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const onChange = (e: Event) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      if (el.tagName === "SELECT" || (el.tagName === "INPUT" && ["checkbox", "radio", "date"].includes((el as HTMLInputElement).type))) {
        form.requestSubmit();
      }
    };
    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, []);
  return <span ref={ref} hidden />;
}
