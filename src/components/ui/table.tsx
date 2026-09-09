import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The platform's one table pattern (Part 8): comfortable row height, row
 * hover, sticky header, subtle separators, no heavy borders. Every data
 * table in the app should be built from these primitives rather than a
 * bespoke `<table>`. Defaults to `tone="paper"` (white) — the original,
 * still the right choice for every table except one placed on top of a
 * blue card — so no existing usage changes unless it opts into `dark`.
 *
 * Phase 3 — Premium Enterprise UI: slightly taller rows, a crisp header
 * underline instead of relying on background contrast alone, wider header
 * letter-spacing, and a softer row hover. Any caller passing its own
 * `className`/cell padding (e.g. `BatchEntryGrid`'s dense `p-1` cells)
 * still wins — `cn()` always lets the later class override — so nothing
 * that already opts out of the default padding is affected.
 */
type TableTone = "paper" | "dark";

// `forwardRef` targets the *wrapping* scroll div, not the `<table>`
// itself — that's the element callers actually need a handle to (e.g.
// syncing an external scrollbar to this one's `scrollLeft`). `onScroll`
// is likewise applied to that same wrapping div (the only element that
// ever actually fires a scroll event here, since it's the one with
// `overflow-x-auto`) rather than spread onto `<table>`, where a native
// scroll event would never fire. No existing caller passes either prop,
// so this is purely additive.
//
// UX-010 — "only ONE horizontal scrollbar." Transaction Workspace pairs
// this div with a floating mirror bar (see transaction-grid.tsx) that's
// the one actually visible/interactive; this div's own native scrollbar
// is hidden (still fully functional — `overflow-x-auto` still scrolls
// via drag, wheel, or the mirror's synced `scrollLeft`) so the two never
// stack. `hideScrollbar` defaults to false so every other table in the
// app keeps its native scrollbar unchanged.
export const Table = React.forwardRef<
  HTMLDivElement,
  React.TableHTMLAttributes<HTMLTableElement> & { tone?: TableTone; onScroll?: React.UIEventHandler<HTMLDivElement>; hideScrollbar?: boolean }
>(function Table({ className, tone = "paper", onScroll, hideScrollbar, ...props }, ref) {
  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className={cn(
        "overflow-x-auto rounded-vf-md border",
        tone === "dark" ? "border-vf-dark-border" : "border-vf-paper-border",
        hideScrollbar && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      <table className={cn("w-full min-w-max border-collapse text-sm", className)} {...props} />
    </div>
  );
});

export function TableHead({
  className,
  sticky,
  tone = "paper",
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean; tone?: TableTone }) {
  return (
    <thead
      className={cn(
        "border-b text-left text-[0.7rem] font-semibold tracking-wider uppercase",
        tone === "dark" ? "border-white/10 bg-white/8 text-vf-on-dark-faint" : "border-vf-paper-border bg-vf-paper-alt text-vf-ink-faint",
        sticky && "sticky top-0 z-[1]",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, tone = "paper", ...props }: React.HTMLAttributes<HTMLTableSectionElement> & { tone?: TableTone }) {
  return <tbody className={cn(tone === "dark" ? "divide-y divide-white/10" : "divide-y divide-vf-paper-border/70", className)} {...props} />;
}

export function TableRow({ className, tone = "paper", ...props }: React.HTMLAttributes<HTMLTableRowElement> & { tone?: TableTone }) {
  return (
    <tr
      className={cn(
        "transition-colors duration-150 ease-vf-out",
        tone === "dark" ? "hover:bg-white/8" : "hover:bg-vf-paper-alt/60",
        className,
      )}
      {...props}
    />
  );
}

export function TableHeadCell({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-4 py-3", className)} {...props} />;
}

export function TableCell({ className, tone = "paper", ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & { tone?: TableTone }) {
  return <td className={cn("px-4 py-3.5", tone === "dark" ? "text-vf-on-dark-soft" : "text-vf-ink-soft", className)} {...props} />;
}
