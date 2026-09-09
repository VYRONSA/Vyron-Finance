import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Phase 3 — Premium Enterprise UI: the shared interaction contract
  // every variant now gets — a real pressed state (a button that never
  // moves on click reads as unfinished next to the ones that do), and
  // the expo-out easing used everywhere else in this pass so hover/press
  // settle instead of linearly snapping.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold tracking-[0.01em] transition-[transform,box-shadow,background-color,border-color,color] duration-150 ease-vf-out focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 active:scale-[0.985] min-h-11",
  {
    variants: {
      variant: {
        // Executive red gradient — the platform's one signature action
        // colour, used on both dark and paper surfaces.
        primary:
          "bg-gradient-to-b from-vf-red-500 to-vf-red-700 text-vf-on-dark shadow-vf-red-glow hover:-translate-y-px hover:shadow-[0_28px_72px_-10px_rgba(15,108,189,0.55)] active:translate-y-0 active:shadow-vf-red-glow",
        // For dark canvas/charcoal surfaces.
        outline:
          "border border-vf-dark-border text-vf-on-dark hover:-translate-y-px hover:border-vf-red-400 hover:text-vf-red-300 hover:shadow-[0_10px_28px_-14px_rgba(15,108,189,0.55)] active:translate-y-0",
        // Translucent, for glass panels floating over the hero.
        ghostDark:
          "border border-white/35 text-vf-on-dark hover:-translate-y-px hover:border-white/70 hover:bg-white/5 active:translate-y-0",
        // For white/paper card surfaces (forms, tables) — Part 8's
        // "secondary actions neutral."
        subtle:
          "border border-vf-paper-border text-vf-ink-soft shadow-vf-paper-sm hover:-translate-y-px hover:border-vf-red-500 hover:text-vf-red-600 hover:shadow-vf-paper-md active:translate-y-0 active:shadow-vf-paper-sm",
        // For the confirm step of a destructive action (RC-3) — distinct
        // from "primary" so a delete/reverse confirm never looks like an
        // ordinary affirmative action.
        danger:
          "border border-vf-danger/40 bg-vf-danger/5 text-vf-danger hover:bg-vf-danger/10",
      },
      size: {
        default: "px-6 py-3",
        sm: "px-5 py-2 text-[0.88rem] min-h-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

type ButtonBaseProps = VariantProps<typeof buttonVariants> & {
  className?: string;
  children: React.ReactNode;
};

type ButtonAsButton = ButtonBaseProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };

type ButtonAsLink = ButtonBaseProps &
  Omit<React.ComponentProps<typeof Link>, "href"> & { href: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

/** Shared primary action control — used identically across the public
 * website, authentication, Platform Workspace, and Financial Workspace,
 * per the Product Review Board's "one component library" instruction. */
export function Button({ className, variant, size, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);

  if ("href" in props && props.href !== undefined) {
    const { href, ...rest } = props as ButtonAsLink;
    return <Link href={href} className={classes} {...rest} />;
  }

  const { ...rest } = props as ButtonAsButton;
  return <button className={classes} {...rest} />;
}
