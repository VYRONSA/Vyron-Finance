/**
 * The official VYRON brand mark, built as plain flexbox/gradient JSX so it
 * renders identically through `next/og`'s `ImageResponse` (Satori) — the
 * engine behind `icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx`, and the
 * PWA icon routes. Satori's SVG support is narrower than a real browser's,
 * so this deliberately avoids nested `<svg>`/`clipPath` (which the in-app
 * `BrandMark` component uses instead) in favour of absolutely-positioned
 * `div`s with `clipPath: "polygon(...)"` — a well-supported Satori feature.
 * The polygon coordinates below are the same two blade shapes as
 * `src/components/ui/brand-mark.tsx` (`bluePath`/`silverPath`), expressed
 * as percentages instead of a 24-unit SVG viewBox, so the mark is the same
 * silhouette everywhere it appears. Keep the two in sync if the glyph
 * ever changes.
 */

export const VYRON_BRAND_COLORS = {
  navyTop: "#161d33",
  navyBottom: "#05060a",
  glowBlue: "rgba(47, 151, 224, 0.55)",
  glowBlueSoft: "rgba(47, 151, 224, 0.35)",
  glowRim: "rgba(126, 196, 242, 0.9)",
  silverLight: "#f5f7f9",
  silverDeep: "#95a0af",
  blueBright: "#6cb8ea",
  blueDeep: "#0f5c96",
  glassHighlight: "rgba(255, 255, 255, 0.14)",
  glassTransparent: "rgba(255, 255, 255, 0)",
} as const;

// Two independent blade shapes (not one glyph split down the middle) —
// blue leans in from the top-left, silver is its mirror from the
// top-right, with a small gap between their tips at the bottom.
const BLUE_BLADE_POLYGON = "polygon(26.67% 20%, 22.08% 38.33%, 45.83% 80.42%, 33.75% 35.83%)";
const SILVER_BLADE_POLYGON = "polygon(73.33% 20%, 77.92% 38.33%, 54.17% 80.42%, 66.25% 35.83%)";

/**
 * Builds the full brand tile — dark glass rounded square, glowing blue
 * rim, two angular blades, glass sheen — sized for a single
 * `ImageResponse` render. `radiusRatio` mirrors the in-app mark's ~26%
 * corner radius.
 */
export function vyronIconElement(size: number) {
  const radius = Math.round(size * 0.258);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(135deg, ${VYRON_BRAND_COLORS.navyTop} 0%, ${VYRON_BRAND_COLORS.navyBottom} 100%)`,
        display: "flex",
        position: "relative",
        overflow: "hidden",
        // Glowing rim: a crisp bright inset line, a softer inset bloom
        // just inside it, and a gentle outward bleed — the div-based
        // equivalent of brand-mark.tsx's blurred SVG stroke + crisp edge
        // line pair.
        boxShadow: `inset 0 0 0 1px ${VYRON_BRAND_COLORS.glowRim}, inset 0 0 ${Math.round(size * 0.06)}px ${Math.round(size * 0.01)}px ${VYRON_BRAND_COLORS.glowBlue}, 0 0 ${Math.round(size * 0.12)}px ${Math.round(size * 0.02)}px ${VYRON_BRAND_COLORS.glowBlueSoft}`,
      }}
    >
      {/* Blue blade — left */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(135deg, ${VYRON_BRAND_COLORS.blueDeep} 0%, ${VYRON_BRAND_COLORS.blueBright} 100%)`,
          clipPath: BLUE_BLADE_POLYGON,
          display: "flex",
        }}
      />
      {/* Silver blade — right */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(135deg, ${VYRON_BRAND_COLORS.silverDeep} 0%, ${VYRON_BRAND_COLORS.silverLight} 100%)`,
          clipPath: SILVER_BLADE_POLYGON,
          display: "flex",
        }}
      />
      {/* Glass sheen across the top third */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "42%",
          background: `linear-gradient(180deg, ${VYRON_BRAND_COLORS.glassHighlight} 0%, ${VYRON_BRAND_COLORS.glassTransparent} 100%)`,
          display: "flex",
        }}
      />
    </div>
  );
}
