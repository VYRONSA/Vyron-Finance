import type { CSSProperties } from "react";

/**
 * A photographic region of an owner-supplied PRECISIA reference screen,
 * placed at its original size (px) and offsets. The file is the
 * reference's own pixels, cropped only where no text or UI is baked in
 * (see public/brand/precisia-ref/manifest.json), and is rendered as-is:
 * no mask, filter, opacity or overlay. Decorative: hidden from assistive
 * technology.
 */
export function RefPiece({
  name,
  w,
  h,
  left,
  right,
  top,
  bottom,
  className,
}: {
  name: string;
  w: number;
  h: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  className?: string;
}) {
  const style: CSSProperties = {
    position: "absolute",
    width: w,
    height: h,
    ...(left !== undefined && { left }),
    ...(right !== undefined && { right }),
    ...(top !== undefined && { top }),
    ...(bottom !== undefined && { bottom }),
  };
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the reference's own pixels, served as-is (no re-encoding)
    <img src={`/brand/precisia-ref/${name}.png`} alt="" aria-hidden width={w} height={h} className={className} style={style} draggable={false} />
  );
}
