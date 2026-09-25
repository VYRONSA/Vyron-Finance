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
        "relative inline-block -rotate-[8deg] font-[family-name:var(--font-script)] leading-none whitespace-nowrap",
        tone === "onDark" ? "text-white" : "text-[#0a1640]",
        className,
      )}
    >
      <span className="block">Clarity</span>
      <span className="-mt-[0.32em] block pl-[0.55em]">Creates</span>
      <span className="-mt-[0.32em] block">Opportunity</span>
      <svg aria-hidden viewBox="0 0 220 30" className="absolute -bottom-[0.1em] left-[0.35em] h-[0.42em] w-[3.1em]" fill="none">
        <path d="M4 22 C 60 12, 140 6, 216 4" stroke="#1d7dff" strokeWidth="6" strokeLinecap="round" />
        <path d="M30 27 C 80 20, 130 16, 170 14" stroke="#1d7dff" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
      </svg>
    </p>
  );
}
