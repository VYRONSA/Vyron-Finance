import * as React from "react";
import { cn } from "@/lib/utils";

// Phase 3 — Premium Enterprise UI: a soft colour-tinted focus ring
// alongside the existing border-color change (Stripe/Linear's input
// focus treatment), a touch more breathing room, and a resting shadow so
// the field reads as a raised control rather than a flat outline even
// before it's focused. Same border colour, same radius, same brand blue
// — only the depth and the focus feedback are new.
export const FIELD_BASE =
  "w-full rounded-lg border border-vf-paper-border bg-vf-paper px-4 py-2.75 text-sm text-vf-ink shadow-vf-paper-sm outline-none transition-[border-color,box-shadow] duration-150 ease-vf-out placeholder:text-vf-ink-faint focus:border-vf-red-500 focus:shadow-[0_0_0_3.5px_rgba(15,108,189,0.12)] disabled:cursor-not-allowed disabled:opacity-60";

/** The one text input style — Part 8 form standard: rounded, paper
 * surface, red focus ring. Matches the (pre-existing) auth form inputs. */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(FIELD_BASE, className)} {...props} />;
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(FIELD_BASE, className)} {...props} />;
  },
);
