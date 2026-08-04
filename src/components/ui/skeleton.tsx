import { cn } from "@/lib/utils";

/** A single pulsing placeholder block, used while real content loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-vf-sm bg-current/10", className)} />;
}
