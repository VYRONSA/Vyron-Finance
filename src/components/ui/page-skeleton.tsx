import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Finding #197 (RC-8) — full-page loading fallback for `loading.tsx`
 * files. These routes' `page.tsx` awaits its data before returning any
 * JSX at all (hero included), so a `<Suspense>` wrapped only around the
 * page's tabs never actually suspends — real streaming instead comes
 * from Next.js's own `loading.tsx` convention, which wraps the whole
 * page (and its top-of-function awaits) in one real boundary.
 */
export function PageLoadingSkeleton({ maxWidthClassName = "w-full" }: { maxWidthClassName?: string }) {
  return (
    <div className={cn("flex flex-col gap-6", maxWidthClassName)}>
      <Card tone="hero" className="relative overflow-hidden">
        <CardContent className="flex flex-col gap-3 p-8 lg:p-10">
          <Skeleton className="h-3 w-40 bg-vf-on-dark/20" />
          <Skeleton className="h-8 w-72 bg-vf-on-dark/20" />
          <Skeleton className="h-4 w-full max-w-xl bg-vf-on-dark/20" />
        </CardContent>
      </Card>
      <Skeleton className="h-64 w-full rounded-vf-md" />
    </div>
  );
}
