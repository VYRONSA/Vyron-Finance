import { cn } from "@/lib/utils";

/**
 * The PRECISIA wordmark, as drawn in all four approved PRECISIA reference
 * images: "PRECISI" in white, the final "A" in the electric-blue accent,
 * with "FINANCIAL INTELLIGENCE" letter-spaced underneath.
 *
 * `size` scales the whole lock-up; `subtitleTone` follows the references
 * (blue under the Software Page sidebar, white/silver everywhere else).
 */
const SIZES = {
  sm: { word: "text-[1.35rem]", sub: "text-[0.5rem] tracking-[0.2em] mt-0.5" },
  md: { word: "text-[1.85rem]", sub: "text-[0.6rem] tracking-[0.2em] mt-1" },
  lg: { word: "text-[2.6rem]", sub: "text-[0.82rem] tracking-[0.22em] mt-1.5" },
  /** The "New Login Page" reference card lock-up. */
  card: { word: "text-[3.05rem]", sub: "text-[0.9rem] tracking-[0.2em] mt-2.5" },
  xl: { word: "text-[3.4rem] sm:text-[4rem]", sub: "text-[0.95rem] sm:text-[1.1rem] tracking-[0.24em] mt-2" },
} as const;

export function PrecisiaWordmark({
  size = "md",
  subtitle = true,
  subtitleTone = "light",
  tone = "onDark",
  className,
}: {
  size?: keyof typeof SIZES;
  subtitle?: boolean;
  subtitleTone?: "light" | "blue";
  /** `onLight` — ink letters, for the few remaining white-card screens. */
  tone?: "onDark" | "onLight";
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex flex-col leading-none", className)}>
      <span className={cn("font-[family-name:var(--font-brand)] font-normal tracking-[0.02em]", tone === "onLight" ? "text-[#0a1640]" : "text-white", s.word)} role="img" aria-label="PRECISIA">
        <span aria-hidden>PRECISI</span>
        <span aria-hidden className="text-[#1d8dff]">A</span>
      </span>
      {subtitle && (
        <span
          className={cn(
            "font-[family-name:var(--font-brand)] font-medium whitespace-nowrap uppercase",
            subtitleTone === "blue" ? "text-[#2f9bff]" : tone === "onLight" ? "text-[#4a5670]" : "text-[#dbe4f1]",
            s.sub,
          )}
        >
          Financial Intelligence
        </span>
      )}
    </span>
  );
}

/** "A product of Vyronsoft (Pty) Ltd." — mandatory attribution, exact wording. */
export function VyronsoftAttribution({ className, stacked = false }: { className?: string; stacked?: boolean }) {
  return stacked ? (
    <p className={cn("text-xs leading-relaxed", className)}>
      A product of
      <br />
      <span className="font-semibold">Vyronsoft (Pty) Ltd.</span>
    </p>
  ) : (
    <p className={cn("text-sm", className)}>
      A product of <span className="font-semibold">Vyronsoft (Pty) Ltd.</span>
    </p>
  );
}
