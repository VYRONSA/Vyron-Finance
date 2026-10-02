import type { CSSProperties } from "react";

/**
 * A licensed PRECISIA photograph from public/brand/precisia-photo (see
 * manifest.json there for each file's source, photographer and licence).
 * Every file is a high-resolution original downscaled — never enlarged —
 * and served at several widths so the browser picks one at least as
 * large as the rendered size × device pixel ratio. Cropping is done by
 * the box (`object-fit: cover`), so a photograph is never stretched.
 * Decorative: hidden from assistive technology.
 */
export function Photo({
  name,
  widths,
  sizes,
  className,
  style,
  priority = false,
  portrait,
}: {
  name: string;
  widths: number[];
  sizes: string;
  className?: string;
  style?: CSSProperties;
  priority?: boolean;
  /** A taller crop of the same photograph below 1024px, where a
   * landscape file would have to be enlarged to cover a tall box. */
  portrait?: { name: string; widths: number[]; sizes: string };
}) {
  const srcSet = (n: string, ws: number[]) => ws.map((w) => `/brand/precisia-photo/${n}-${w}.jpg ${w}w`).join(", ");
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- static, pre-sized originals with an explicit srcset
    <img
      src={`/brand/precisia-photo/${name}-${widths[0]}.jpg`}
      srcSet={srcSet(name, widths)}
      sizes={sizes}
      alt=""
      aria-hidden
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      draggable={false}
      className={`object-cover ${className ?? ""}`}
      style={style}
    />
  );
  if (!portrait) return img;
  return (
    <picture>
      <source media="(max-width: 1023px)" srcSet={srcSet(portrait.name, portrait.widths)} sizes={portrait.sizes} />
      {img}
    </picture>
  );
}

export const HERO_WIDTHS = [3840, 2560, 1600];
export const TILE_WIDTHS = [1200, 600];
