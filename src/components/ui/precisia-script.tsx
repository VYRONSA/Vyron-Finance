import { cn } from "@/lib/utils";

/**
 * "Clarity Creates Opportunity" — the hand-lettered line that appears in
 * the PRECISIA Landing Page and Software Page references, set as real
 * text in a script face with the reference's blue brush underline. It is
 * typography, not an image, so it stays sharp at every size and is read
 * out by screen readers as the phrase itself.
 */
export function ClarityScript({ tone = "onDark", className }: { tone?: "onDark" | "onLight"; className?: string }) {
  return (
    <p
      className={cn(
        "relative inline-block -rotate-[9deg] font-[family-name:var(--font-script)] whitespace-nowrap",
        tone === "onDark" ? "text-white" : "text-[#0a1640]",
        className,
      )}
      // Inline, not a `leading-*` class: callers size this with a text-*
      // class, and class merging would drop a line-height utility.
      style={{ lineHeight: 0.74 }}
    >
      <span className="block">Clarity</span>
      <span className="block pl-[0.3em]">Creates</span>
      <span className="block pl-[0.42em]">Opportunity</span>
      <svg aria-hidden viewBox="0 0 200 24" className="absolute -bottom-[0.26em] left-[0.95em] h-[0.3em] w-[2.9em]" fill="none">
        <path d="M2 21 C 60 15, 130 8, 198 3 L 198 5 C 130 11, 62 18, 4 23 Z" fill="#1d7dff" />
      </svg>
    </p>
  );
}
