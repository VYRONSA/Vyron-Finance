import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { IconArrowDown, IconArrowUp, IconMinus } from "@/components/ui/icons";
import type { KpiTrend } from "@/lib/mock/financial-data";

const TREND_ICON = { up: IconArrowUp, down: IconArrowDown, flat: IconMinus };

/**
 * The one standardised KPI/statistic card (Product Review Board, Part 6:
 * "they should feel like one cohesive component family") — fixed height,
 * fixed padding, fixed icon/number/label/trend layout. Every statistic
 * anywhere in the platform should use this rather than a bespoke card.
 */
export function KpiCard({
  icon,
  label,
  value,
  trend,
  tone = "dark",
  className,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  trend?: KpiTrend;
  tone?: "dark" | "paper";
  className?: string;
}) {
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
  const trendToneClass = trend
    ? { good: "text-vf-success", bad: "text-vf-danger", neutral: tone === "dark" ? "text-vf-on-dark-faint" : "text-vf-ink-faint" }[trend.tone]
    : "";

  return (
    <Card
      tone={tone}
      className={cn(
        "flex h-[148px] flex-col justify-between p-5 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5",
        tone === "dark" ? "hover:shadow-[0_16px_40px_rgba(0,0,0,0.6)]" : "hover:shadow-vf-paper-lg",
        className,
      )}
    >
      <CardContent className="flex h-full flex-col justify-between p-0">
        <div className="flex items-start justify-between">
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-[10px]",
              tone === "dark" ? "bg-vf-red-500/14 text-vf-red-400" : "bg-vf-red-500/10 text-vf-red-600",
            )}
            aria-hidden
          >
            {icon}
          </span>
          {trend && TrendIcon && (
            <span className={cn("flex items-center gap-1 text-xs font-medium", trendToneClass)}>
              <TrendIcon className="h-3 w-3" />
              {trend.label}
            </span>
          )}
        </div>
        <div>
          <p className={cn("font-mono text-2xl font-semibold tabular-nums", tone === "dark" ? "text-vf-on-dark" : "text-vf-ink")}>
            {value}
          </p>
          <p className={cn("mt-1 text-xs", tone === "dark" ? "text-vf-on-dark-faint" : "text-vf-ink-faint")}>{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
