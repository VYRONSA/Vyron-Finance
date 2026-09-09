import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Three-level card hierarchy — every card in the platform is one of:
 *   hero  — Level 1, large, executive blue gradient (hero moments)
 *   dark  — Level 2, executive blue gradient, statistic/chart cards
 *   paper — Level 3, white "paper" (the default — tables, forms, lists)
 *
 * Phase 3 — Premium Enterprise UI: every tone now answers a hover with a
 * quiet lift (one shadow tier up, a hair of translation, a fractionally
 * more defined border) — the same "surface responds to you" cue Linear/
 * Notion cards give even when the card itself isn't a button, then
 * settles back on the same expo-out ease everything else in this pass
 * uses. Kept deliberately subtle (a couple of px, not a jump) per "nothing
 * flashy" — and it composes fine with a card that's also `overflow-hidden`
 * for a decorative glow (the transform is on the card itself, not a child).
 */
const cardVariants = cva("rounded-vf-lg transition-[transform,box-shadow,border-color] duration-200 ease-vf-out", {
  variants: {
    tone: {
      paper:
        "border border-vf-paper-border bg-vf-paper text-vf-ink shadow-vf-paper-lg hover:-translate-y-0.5 hover:shadow-vf-paper-xl",
      dark: "border border-vf-red-900/40 bg-gradient-to-br from-vf-red-600 to-vf-red-900 text-vf-on-dark shadow-vf-dark-card hover:-translate-y-0.5 hover:border-vf-red-700/60",
      hero: "border border-vf-red-900/40 bg-gradient-to-br from-vf-red-700 to-vf-red-900 text-vf-on-dark shadow-vf-red-glow",
    },
  },
  defaultVariants: {
    tone: "paper",
  },
});

export interface CardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export function Card({ className, tone, ...props }: CardProps) {
  return <div className={cn(cardVariants({ tone }), className)} {...props} />;
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pb-3", className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-sans text-base font-semibold tracking-[-0.01em]", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("mt-1 text-sm opacity-75", className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-3", className)} {...props} />;
}
