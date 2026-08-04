import * as React from "react";
import { cn } from "@/lib/utils";

/** The one text input style — Part 8 form standard: rounded, paper
 * surface, red focus ring. Matches the (pre-existing) auth form inputs. */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-lg border border-vf-paper-border bg-vf-paper px-3.5 py-2.5 text-vf-ink outline-none transition-colors placeholder:text-vf-ink-faint focus:border-vf-red-500",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "w-full rounded-lg border border-vf-paper-border bg-vf-paper px-3.5 py-2.5 text-vf-ink outline-none transition-colors focus:border-vf-red-500",
          className,
        )}
        {...props}
      />
    );
  },
);
