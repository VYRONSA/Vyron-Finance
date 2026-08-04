import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
  {
    variants: {
      tone: {
        good: "bg-vf-success/14 text-[#1f6e4b]",
        warn: "bg-vf-warning/16 text-[#93601f]",
        info: "bg-vf-info/14 text-vf-info",
        danger: "bg-vf-danger/14 text-vf-danger",
        muted: "bg-vf-paper-alt text-vf-ink-faint",
      },
    },
    defaultVariants: {
      tone: "muted",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/** Status pill — coding status, rule state, alert severity. Semantic
 * tone (good/warn/info/danger) is deliberately separate from the brand
 * accent (gold), matching this session's own "encode state as a chip,
 * not just a number" UI convention. */
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
