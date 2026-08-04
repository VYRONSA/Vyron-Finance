import { useId } from "react";

/**
 * The VYRON FINANCE brand mark — a two-tone "V" (silver left arm, blue
 * right arm, meeting at a point), replacing the earlier bank/building
 * glyph. Gradient ids are unique per instance (`useId`) so multiple
 * copies can render on one page (header + footer, hero + mobile card)
 * without one SVG's gradient bleeding into another's.
 */
export function BrandMark({ className }: { className?: string }) {
  const uid = useId();
  const silverId = `vyron-silver-${uid}`;
  const blueId = `vyron-blue-${uid}`;

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={silverId} x1="3" y1="4" x2="13" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e7eaee" />
          <stop offset="1" stopColor="#8b93a1" />
        </linearGradient>
        <linearGradient id={blueId} x1="21" y1="3" x2="9" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6cb8ea" />
          <stop offset="1" stopColor="#106ebe" />
        </linearGradient>
      </defs>
      <polygon points="3,4 6.5,4 13,20 9.5,20" fill={`url(#${silverId})`} />
      <polygon points="9,20 12.5,20 21,3 17.5,3" fill={`url(#${blueId})`} />
    </svg>
  );
}
