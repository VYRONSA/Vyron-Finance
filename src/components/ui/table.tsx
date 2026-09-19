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
        // Phase 5I — two separate fixes for one symptom: the PAGE, rather
        // than the table, scrolled sideways (measured: Sales 171px of
        // horizontal document scroll at 1440 and 949px at 390; Customers
        // 676px at 390). Both are fixed once here rather than per page, so
        // neither can recur on the next screen that renders a wide table.
        //
        // `min-w-0` — a flex item's automatic minimum size is its CONTENT
        // width, so inside a flex/grid parent this scroll container grew
        // to the table's full width instead of shrinking to the space
        // available. Same gotcha `workspace-shell.tsx` documents for
        // VR-022.
        //
        // `relative` — the real culprit, and the subtler one. Tailwind's
        // `sr-only` is `position: absolute`. An absolutely positioned
        // element is only clipped by an ancestor that is its containing
        // block, so with no positioned ancestor its containing block was
        // the document itself: a `<span class="sr-only">Actions</span>` in
        // a far-right column sat at x=1339 and extended the document's
        // scrollable width, straight through `overflow-x-auto` (which is
        // why raising the overflow to `hidden` did not help either).
        // Making the scroll container positioned puts those spans back
        // inside it. This was latent in every table — Sales only showed it
        // because its `sr-only` is in the LAST column rather than the first.
        "relative min-w-0 overflow-x-auto rounded-vf-md border",
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
