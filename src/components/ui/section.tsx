import * as React from "react";
import { cn } from "@/lib/utils";

/** Max-width content wrapper for the public marketing site (header, hero,
 * page sections, footer) — one consistent measure so every section aligns. */
export function Container({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12 xl:px-16", className)}
      {...props}
    />
  );
}

export function Section({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("py-14 sm:py-20 lg:py-24", className)}
      {...props}
    />
  );
}

export function Eyebrow({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.14em] text-vf-red-400 uppercase before:h-px before:w-5 before:bg-current before:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
