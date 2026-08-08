import { useId } from "react";

/**
 * The VYRON ecosystem mark — a four-point compass star (the symbol
 * every future VYRON product shares: Finance, Payroll, Audit,
 * Manufacturing, Farm, Safe, ...), designed to be recognizable on its
 * own with no wordmark. Silver/white on the north+west facets, blue on
 * the east+south facets, split along the same diagonal the mark has
 * always used, plus a thin orbit ring — matching the approved brand
 * identity reference exactly. Rendered as one clean symmetric star
 * silhouette (not literal illustration facets) so it stays crisp and
 * legible from a 16px sidebar icon up to a full marketing hero — a
 * faceted-gem illustration with dozens of subtle gradient facets
 * doesn't survive scaling down that far, a clean two-tone split does.
 * Gradient/clip ids are unique per instance (`useId`) so multiple
 * copies can render on one page without one SVG's defs bleeding into
 * another's.
 */
export function BrandMark({ className }: { className?: string }) {
  const uid = useId();
  const silverId = `vyron-silver-${uid}`;
  const blueId = `vyron-blue-${uid}`;
  const clipNorthWestId = `vyron-clip-nw-${uid}`;
  const clipSouthEastId = `vyron-clip-se-${uid}`;

  const starPath = "M12,1.5 L14.7,9.3 L22.5,12 L14.7,14.7 L12,22.5 L9.3,14.7 L1.5,12 L9.3,9.3 Z";

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={silverId} x1="2" y1="2" x2="14" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f5f7f9" />
          <stop offset="1" stopColor="#95a0af" />
        </linearGradient>
        <linearGradient id={blueId} x1="14" y1="10" x2="22.5" y2="22.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6cb8ea" />
          <stop offset="1" stopColor="#0f5c96" />
        </linearGradient>
        {/* Split along x + y = 24 — the diagonal through the star's own
            centre — north+west tips fall in the first clip, east+south
            in the second. */}
        <clipPath id={clipNorthWestId}>
          <polygon points="0,0 24,0 0,24" />
        </clipPath>
        <clipPath id={clipSouthEastId}>
          <polygon points="24,0 24,24 0,24" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="11" fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="0.55" />
      <path d={starPath} fill={`url(#${silverId})`} clipPath={`url(#${clipNorthWestId})`} />
      <path d={starPath} fill={`url(#${blueId})`} clipPath={`url(#${clipSouthEastId})`} />
    </svg>
  );
}
