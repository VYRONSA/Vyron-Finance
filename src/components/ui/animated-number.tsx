"use client";

import { useEffect, useRef, useState } from "react";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts up from 0 to `value` once, on mount — used for the hero's
 * headline Recovery % (Product Review Board, Part 10: "animated
 * counters"). Respects `prefers-reduced-motion` by rendering the final
 * value immediately instead of animating.
 */
export function AnimatedNumber({
  value,
  suffix = "",
  durationMs = 900,
}: {
  value: number;
  suffix?: string;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? value : 0));
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let frame: number;
    function tick(timestamp: number) {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return (
    <span className="tabular-nums">
      {display}
      {suffix}
    </span>
  );
}
