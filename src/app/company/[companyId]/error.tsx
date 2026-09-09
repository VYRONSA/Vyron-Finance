"use client";

/**
 * Phase 43 — production defect investigation found this file did not
 * exist ANYWHERE in the app (no `error.tsx`/`global-error.tsx` under
 * `src/app` at all), and `company/[companyId]/layout.tsx` renders
 * `FinancialWorkspaceShell` (the sidebar) directly around `{children}`
 * with nothing between them. An uncaught render error anywhere in a
 * page's content — Transaction Explorer's included, a large, complex
 * component with 20+ fetches/effects — had nothing to stop it from
 * unmounting the ENTIRE tree up to the app root, taking the sidebar down
 * with it: exactly the reported symptom ("clicking other navigation
 * items does not open other sections," recoverable only by a full
 * logout/login, i.e. a fresh mount).
 *
 * Next.js's own `error.tsx` convention is what fixes this by
 * construction: a boundary here wraps this segment's `page.tsx` (and
 * every nested route below it — transactions, suppliers, customers,
 * banking rules, everything under `/company/[companyId]/**`) but does
 * NOT wrap `layout.tsx` at this same level — so the shell/sidebar stays
 * completely outside this boundary and un-remounted, always interactive,
 * regardless of what breaks inside the content area. This is a genuine
 * fix for the "whole app looks stuck" failure mode, not merely a nicer
 * error message — clicking anywhere in the still-mounted sidebar
 * continues to work exactly as it did before the error.
 */
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAlertTriangle } from "@/components/ui/icons";

export default function CompanySectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Company workspace section failed to render:", error);
  }, [error]);

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center">
      <EmptyState
        icon={<IconAlertTriangle className="h-5 w-5" />}
        title="Something went wrong loading this section."
        description="This section failed to load, but the rest of the application is still working — use the sidebar to navigate elsewhere, or try again."
        action={
          <Button variant="primary" size="sm" onClick={() => reset()}>
            Try Again
          </Button>
        }
      />
    </div>
  );
}
