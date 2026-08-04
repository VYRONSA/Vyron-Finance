import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StackedStatusBar } from "@/components/ui/charts/stacked-status-bar";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { IconFileText, IconImport, IconListChecks } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { buildDashboardCounts } from "@/server/accounting/reconciliation-reports";
import { mockDashboardCounts, MOCK_REPORTS } from "@/lib/mock/supplier-reconciliation-data";
import { GenerateReportsButton } from "@/components/financial/generate-reports-button";
import { ReportViewer } from "@/components/financial/report-viewer";

export const metadata: Metadata = {
  title: "Supplier Reconciliation — VYRON FINANCE",
};

export default async function SupplierReconciliationPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const counts = previewMode ? mockDashboardCounts() : await buildDashboardCounts(companyId);

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
      {/* Executive Hero */}
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
              Financial Workspace
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Supplier Reconciliation Centre</h1>
            <p className="mt-1.5 text-sm text-vf-on-dark-soft">
              Import, match, allocate, and report on supplier payments.
            </p>
          </div>
          <GenerateReportsButton companyId={companyId} previewMode={previewMode} />
        </CardContent>
      </Card>

      {/* Executive Summary — same white bar used on the Dashboard */}
      <ExecutiveSummaryBar
        items={[
          { key: "bills", label: "Bills Imported", value: String(counts.billsImported), icon: IconImport },
          { key: "creditNotes", label: "Credit Notes Imported", value: String(counts.creditNotesImported), icon: IconFileText },
          { key: "transactions", label: "Bank Transactions Imported", value: String(counts.bankTransactionsImported), icon: IconListChecks },
          { key: "workQueue", label: "Work Queue Items", value: String(counts.outstandingWorkQueueItems), icon: IconListChecks },
        ]}
      />

      {/* Allocation Status — same chart form as the Dashboard */}
      <Card tone="dark">
        <CardHeader>
          <CardTitle className="text-vf-on-dark">Allocation Status</CardTitle>
          <CardDescription className="text-vf-on-dark-faint">Every imported transaction, by outcome</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <StackedStatusBar
            segments={[
              { key: "matched", label: "Matched", value: counts.matched, color: "var(--color-vf-success)" },
              { key: "allocated", label: "Allocated", value: counts.allocated, color: "var(--color-vf-info)" },
              { key: "suggested", label: "Suggested", value: counts.suggested, color: "var(--color-vf-warning)" },
              { key: "unallocated", label: "Unallocated", value: counts.unallocated, color: "var(--color-vf-red-300)" },
            ]}
          />
        </CardContent>
      </Card>

      {/* Primary Workspace — white report/table surface */}
      <ReportViewer companyId={companyId} previewMode={previewMode} initialReports={previewMode ? MOCK_REPORTS : undefined} />
    </div>
  );
}
