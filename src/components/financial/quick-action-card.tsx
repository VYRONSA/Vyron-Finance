import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * A shortcut into an operational module (Product Review Board, Part 7).
 * `href` present -> a live link into a built module; absent -> rendered
 * as a disabled "Soon" card, matching the sidebar nav's own honest
 * not-yet-built convention (see workspace-shell.tsx's `MODULES` array).
 */
export function QuickActionCard({
  icon,
  title,
  description,
  href,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  href?: string;
}) {
  const content = (
    <>
      <span
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-[10px]",
          href ? "bg-vf-red-500/10 text-vf-red-600" : "bg-vf-paper-alt text-vf-ink-faint",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <p className="font-sans text-sm font-semibold text-vf-ink">{title}</p>
          {!href && (
            <span className="rounded-full bg-vf-paper-alt px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-vf-ink-faint">
              Soon
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-vf-ink-faint">{description}</p>
      </div>
    </>
  );

  const className = cn(
    "flex flex-col rounded-vf-md border border-vf-paper-border bg-vf-paper p-4 transition-[transform,box-shadow] duration-150",
    href ? "hover:-translate-y-0.5 hover:shadow-vf-paper-md" : "opacity-60",
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <div className={className} aria-disabled>
      {content}
    </div>
  );
}
