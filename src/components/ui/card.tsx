import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Three-level card hierarchy — every card in the platform is one of:
 *   hero  — Level 1, page header panel (the Dashboard's glowing navy)
 *   dark  — Level 2, statistic/chart panel
 *   paper — Level 3, the default panel — tables, forms, lists
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
// PRECISIA — the Dashboard's card language: 14px corners, thin navy
// borders, deep shadow. `paper` follows the theme tokens (navy panel in
// the app, white paper inside .pc-light documents); `dark` is the
// Dashboard's statistic panel; `hero` is the Dashboard's glowing hero
// panel (page headers).
const cardVariants = cva("rounded-[14px] transition-[transform,box-shadow,border-color] duration-200 ease-vf-out", {
  variants: {
    tone: {
      paper:
        "border border-vf-paper-border bg-vf-paper text-vf-ink shadow-vf-paper-lg hover:-translate-y-0.5 hover:shadow-vf-paper-xl",
      dark: "border border-[#1f3550] bg-gradient-to-b from-[#0d1b2e] to-[#0a1524] text-vf-on-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_40px_-24px_rgba(0,0,0,0.9)] hover:-translate-y-0.5 hover:border-[#2d5a8c]",
      hero: "border border-[#2d5f9e]/60 bg-[radial-gradient(900px_260px_at_85%_-20%,rgba(29,125,255,0.28),transparent_65%),linear-gradient(135deg,#0c1f38_0%,#081629_55%,#060f1d_100%)] text-vf-on-dark shadow-[0_0_0_1px_rgba(47,155,255,0.08),0_18px_48px_-20px_rgba(22,112,255,0.45)]",
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
