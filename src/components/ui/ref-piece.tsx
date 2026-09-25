import type { CSSProperties } from "react";

type Edge = "left" | "right" | "top" | "bottom";

/**
 * A photographic region of an owner-supplied PRECISIA reference screen,
 * placed at its original size (px) and offsets. The file is the
 * reference's own pixels, cropped only where no text or UI is baked in
 * (see public/brand/precisia-ref/manifest.json); `fade` feathers the named
 * edges into the surrounding panel with a CSS mask — the image itself is
 * never altered. Decorative: hidden from assistive technology.
 */
export function RefPiece({
  name,
  w,
  h,
  left,
  right,
  top,
  bottom,
  fade = [],
  className,
}: {
  name: string;
  w: number;
  h: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  fade?: { edge: Edge; size: number }[];
  className?: string;
}) {
  const masks = fade.map(({ edge, size }) => {
    const dir = { left: "to right", right: "to left", top: "to bottom", bottom: "to top" }[edge];
    return `linear-gradient(${dir}, transparent, #000 ${size}px)`;
  });
  const style: CSSProperties = {
    position: "absolute",
    width: w,
    height: h,
    ...(left !== undefined && { left }),
    ...(right !== undefined && { right }),
    ...(top !== undefined && { top }),
    ...(bottom !== undefined && { bottom }),
    ...(masks.length > 0 && { maskImage: masks.join(", "), WebkitMaskImage: masks.join(", "), maskComposite: "intersect", WebkitMaskComposite: "source-in" }),
  };
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the reference's own pixels, served as-is (no re-encoding)
    <img src={`/brand/precisia-ref/${name}.png`} alt="" aria-hidden width={w} height={h} className={className} style={style} draggable={false} />
  );
}
