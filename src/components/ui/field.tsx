import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Label + control + optional error message — the one field wrapper for
 * every form in the app. */
export function Field({
  label,
  htmlFor,
  error,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-vf-ink">
        {label}
        {required && <span className="text-vf-danger"> *</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-vf-danger">
          {error}
        </p>
      )}
    </div>
  );
}
