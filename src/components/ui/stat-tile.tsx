import { cn } from "@/lib/utils";

export interface StatTileProps {
  value: string;
  label: string;
  tone?: "paper" | "dark";
  className?: string;
}

/** A single KPI figure — reused on the marketing stats strip, the
 * Financial Workspace dashboard, and Platform Workspace usage panels.
 * Figures always render in the monospaced financial-figure face with
 * tabular numerals, per the approved typography system. No border/
 * background of its own — it's meant to sit inside a Card (paper or
 * dark), whose tone it should match via the `tone` prop. */
export function StatTile({ value, label, tone = "paper", className }: StatTileProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className={cn(
          "font-mono text-2xl font-semibold tabular-nums sm:text-3xl",
          tone === "dark" ? "text-vf-red-400" : "text-vf-red-600",
        )}
      >
        {value}
      </div>
      <div className={cn("mt-1 text-xs", tone === "dark" ? "text-vf-on-dark-faint" : "text-vf-ink-faint")}>
        {label}
      </div>
    </div>
  );
}
