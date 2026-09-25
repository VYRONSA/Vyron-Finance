import type { CSSProperties } from "react";
import type { RefPatch } from "@/components/ui/ref-planes.generated";

/**
 * Patches over a reference plane: each covers only the reference's own
 * baked-in lettering (or a baked control that a real control replaces),
 * blending the photograph's colours directly above it into those below.
 * `unit` — "rem" for compositions sized in rem (1rem = 16 reference px),
 * "px" for planes drawn at fixed reference pixels, or a CSS variable
 * holding one reference pixel.
 */
export function PlanePatches({ patches, unit, offsetX = 0, offsetY = 0 }: { patches: Record<string, RefPatch>; unit: "rem" | "px" | { scaleVar: string }; offsetX?: number; offsetY?: number }) {
  const v = (n: number) => (unit === "rem" ? `${n / 16}rem` : unit === "px" ? `${n}px` : `calc(var(${unit.scaleVar}) * ${n})`);
  return (
    <>
      {Object.entries(patches).map(([key, p]) => {
        const style: CSSProperties = { position: "absolute", left: v(p.x + offsetX), top: v(p.y + offsetY), width: v(p.w), height: v(p.h), background: p.top };
        return (
          <div key={key} aria-hidden style={style}>
            <div className="absolute inset-0" style={{ background: p.bottom, maskImage: "linear-gradient(to bottom, transparent, #000)", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000)" }} />
          </div>
        );
      })}
    </>
  );
}
