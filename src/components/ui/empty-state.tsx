import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Guide-forward empty state (Product Review Board, Part 9): every empty
 * state names what's missing and gives one primary action to fix it,
 * rather than a bare "No data."
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      {icon && (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-vf-red-500/10 text-vf-red-600" aria-hidden>
          {icon}
        </span>
      )}
      <div>
        <p className="text-sm font-medium text-vf-ink">{title}</p>
        <p className="mt-1 text-sm text-vf-ink-faint">{description}</p>
      </div>
      {action}
    </div>
  );
}
