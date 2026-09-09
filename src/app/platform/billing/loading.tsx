import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const TAB_LABELS = ["Subscriptions", "Payments & Invoices", "Webhooks & Provider Health", "Revenue Intelligence", "Support & Audit"];

export default function Loading() {
  return (
    <div className="flex w-full flex-col gap-6">
      <Card tone="hero" className="relative overflow-hidden">
        <CardContent className="flex flex-col gap-3 p-8 lg:p-10">
          <Skeleton className="h-3 w-40 bg-vf-on-dark/20" />
          <Skeleton className="h-8 w-72 bg-vf-on-dark/20" />
          <Skeleton className="h-4 w-full max-w-xl bg-vf-on-dark/20" />
        </CardContent>
      </Card>
      <Card>
        <div className="flex flex-wrap gap-1 border-b border-vf-paper-border px-4 pt-3">
          {TAB_LABELS.map((tab) => (
            <span key={tab} className="rounded-t-lg px-3.5 py-2 text-sm font-medium text-vf-ink-faint">
              {tab}
            </span>
          ))}
        </div>
        <CardContent className="flex flex-col gap-3 p-6">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
