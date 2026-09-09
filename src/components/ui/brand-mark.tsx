import { useId } from "react";

/**
 * The official VYRON brand mark — a dark glass rounded-square tile with a
 * glowing blue rim, holding two angular blades that form a V: electric
 * blue on the left, metallic silver on the right, each lit brighter along
 * its inner (centre-facing) edge and deeper along its outer edge to imply
 * a faceted, dimensional fold without literal 3D rendering. This is the
 * permanent identity shared by every VYRON product, matching the approved
 * reference mark exactly (colour placement, blade shapes, glow ring).
 *
 * This component is fully self-contained — the dark tile, the glow ring,
 * and the glass edge are all part of the mark itself, not something the
 * call site wraps it in — so usage sites render it directly at the icon's
 * full outer size (no extra `bg-vf-charcoal` container needed around it).
 * The glow is kept inside the tile's own silhouette (clipped, not bled
 * past the viewBox) so it never overflows its layout box at small sizes.
 *
 * The same silhouette (background gradient, glow, blade geometry, glass
 * sheen) is reproduced in `src/lib/brand-icon.tsx` using plain flexbox/
 * gradient `div`s instead of SVG, for the non-browser renderers that can't
 * use full SVG (`icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx`, the
 * PWA icon routes) — keep both in sync if the glyph ever changes.
 *
 * Gradient/filter/clip ids are unique per instance (`useId`) so multiple
 * copies can render on one page without one SVG's `<defs>` bleeding into
 * another's.
 */
export function BrandMark({ className }: { className?: string }) {
  const uid = useId();
  const bgId = `vyron-bg-${uid}`;
  const blueId = `vyron-blue-${uid}`;
  const silverId = `vyron-silver-${uid}`;
  const glassId = `vyron-glass-${uid}`;
  const tileClipId = `vyron-tile-${uid}`;
  const glowFilterId = `vyron-glow-filter-${uid}`;

  // Two independent blade shapes (not one glyph split down the middle) —
  // matching the reference mark, which shows a small gap between the two
  // tips rather than a single continuous V silhouette. Blue leans in from
  // the top-left, silver is its mirror from the top-right.
  const bluePath = "M6.4,4.8 L5.3,9.2 L11,19.3 L8.1,8.6 Z";
  const silverPath = "M17.6,4.8 L18.7,9.2 L13,19.3 L15.9,8.6 Z";

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={bgId} x1="2" y1="1" x2="22" y2="23" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#161d33" />
          <stop offset="1" stopColor="#05060a" />
        </linearGradient>
        {/* Brighter toward the inner/centre edge, deeper toward the outer
            edge — the light reads as coming from the front, same
            convention on both blades. */}
        <linearGradient id={blueId} x1="4.6" y1="6" x2="10.6" y2="15.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0f5c96" />
          <stop offset="1" stopColor="#6cb8ea" />
        </linearGradient>
        <linearGradient id={silverId} x1="19.4" y1="6" x2="13.4" y2="15.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#95a0af" />
          <stop offset="1" stopColor="#f5f7f9" />
        </linearGradient>
        <linearGradient id={glassId} x1="12" y1="0" x2="12" y2="11" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={tileClipId}>
          <rect x="0.5" y="0.5" width="23" height="23" rx="6.2" />
        </clipPath>
        <filter id={glowFilterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
      </defs>

      <g clipPath={`url(#${tileClipId})`}>
        <rect x="0.5" y="0.5" width="23" height="23" fill={`url(#${bgId})`} />
        {/* Glowing rim — a blurred blue stroke along the tile's own edge,
            clipped to the same rounded silhouette so the blur reads as an
            inward glow rather than bleeding outside the icon's box. */}
        <rect
          x="0.5"
          y="0.5"
          width="23"
          height="23"
          rx="6.2"
          fill="none"
          stroke="#2f97e0"
          strokeOpacity="0.85"
          strokeWidth="2.6"
          filter={`url(#${glowFilterId})`}
        />
        <path d={bluePath} fill={`url(#${blueId})`} />
        <path d={silverPath} fill={`url(#${silverId})`} />
        <rect x="0.5" y="0.5" width="23" height="11" fill={`url(#${glassId})`} />
      </g>
      {/* Crisp bright edge line on top of the clip group, for the sharp
          inner rim-light that sits inside the softer glow behind it. */}
      <rect x="0.5" y="0.5" width="23" height="23" rx="6.2" fill="none" stroke="#7ec4f2" strokeOpacity="0.9" strokeWidth="0.7" />
    </svg>
  );
}
