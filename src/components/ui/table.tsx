import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The platform's one table pattern (Part 8): comfortable row height, row
 * hover, sticky header, subtle separators, no heavy borders. Every data
 * table in the app should be built from these primitives rather than a
 * bespoke `<table>`. Defaults to `tone="paper"` (white) — the original,
 * still the right choice for every table except one placed on top of a
 * blue card — so no existing usage changes unless it opts into `dark`.
 */
type TableTone = "paper" | "dark";

export function Table({ className, tone = "paper", ...props }: React.TableHTMLAttributes<HTMLTableElement> & { tone?: TableTone }) {
  return (
    <div className={cn("overflow-x-auto rounded-vf-md border", tone === "dark" ? "border-vf-dark-border" : "border-vf-paper-border")}>
      <table className={cn("w-full min-w-max border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function TableHead({
  className,
  sticky,
  tone = "paper",
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean; tone?: TableTone }) {
  return (
    <thead
      className={cn(
        "text-left text-xs font-medium uppercase tracking-wide",
        tone === "dark" ? "bg-white/8 text-vf-on-dark-faint" : "bg-vf-paper-alt text-vf-ink-faint",
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
      className={cn("transition-colors", tone === "dark" ? "hover:bg-white/8" : "hover:bg-vf-paper-alt/70", className)}
      {...props}
    />
  );
}

export function TableHeadCell({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-4 py-2.5 font-medium", className)} {...props} />;
}

export function TableCell({ className, tone = "paper", ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & { tone?: TableTone }) {
  return <td className={cn("px-4 py-3", tone === "dark" ? "text-vf-on-dark-soft" : "text-vf-ink-soft", className)} {...props} />;
}
