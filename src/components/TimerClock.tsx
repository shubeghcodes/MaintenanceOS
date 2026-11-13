"use client";

import { useEffect, useState } from "react";

function fmt(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Live h:mm:ss for a timer: seconds already banked plus time since it was last resumed. */
export function TimerClock({ worked, resumedAt, className }: { worked: number; resumedAt: string | null; className?: string }) {
  const calc = () => worked + (resumedAt ? Math.max(0, (Date.now() - new Date(resumedAt).getTime()) / 1000) : 0);
  const [secs, setSecs] = useState(calc);
  useEffect(() => {
    setSecs(calc());
    if (!resumedAt) return;
    const t = setInterval(() => setSecs(calc()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worked, resumedAt]);
  return (
    <span className={className} suppressHydrationWarning>
      {fmt(secs)}
    </span>
  );
}
