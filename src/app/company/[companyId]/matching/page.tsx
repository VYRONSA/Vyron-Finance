import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { MatchingTabs } from "@/components/financial/matching/matching-tabs";
import { IconAlertTriangle, IconGrid, IconImport, IconReconcile, IconShieldCheck, IconSparkles } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import { getMatchingQueue } from "@/server/services/matching-queue-service";
import { buildMatchingSummary } from "@/server/services/matching-summary-service";
import { getBankingAutomationAggregate } from "@/server/services/transaction-explorer-service";
import { buildBankingAutomationSummary } from "@/server/services/banking-summary-service";
import { listBankingExceptions } from "@/server/services/banking-exception-service";
import { listRecentImports } from "@/server/services/import-service";
import { listRuleApplicationsSince } from "@/server/services/banking-rule-service";
import { listMerchants } from "@/server/services/merchant-service";
import { getCustomerMatchingWorkspace } from "@/server/services/customer-matching-service";
import { getSupplierMatchingWorkspace } from "@/server/services/supplier-matching-service";
import type { DuplicateFinding } from "@/server/services/duplicate-detection-service";
import { MOCK_COMPANIES_FULL } from "@/lib/mock/company-management-data";
import { MOCK_BANKING_AGGREGATE } from "@/lib/mock/transaction-explorer-data";
import { MOCK_BANKING_EXCEPTIONS } from "@/lib/mock/banking-automation-data";
import {
  MOCK_CUSTOMER_MATCHING,
  MOCK_DUPLICATE_FINDINGS,
  MOCK_MATCHING_QUEUE,
  MOCK_MATCHING_SUMMARY,
  MOCK_MERCHANTS,
  MOCK_SUPPLIER_MATCHING,
} from "@/lib/mock/matching-data";

export const metadata: Metadata = {
  title: "Matching — VYRON FINANCE",
};

export default async function MatchingPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const company = previewMode ? MOCK_COMPANIES_FULL.find((c) => c.id === companyId) : await getCompany(companyId);
  if (!company) notFound();

  const todayIso = new Date().toISOString().slice(0, 10);

  // Launch Blocker fix (post-RC2): was `listTransactionsForExport`,
  // pulling the company's entire bank transaction history into memory —
  // see banking-summary-service.ts's own comment for the full evidence.
  const [queue, bankingAggregate, importBatches, bankingExceptions, ruleApplicationsToday, merchants, customerMatching, supplierMatching] = previewMode
    ? [MOCK_MATCHING_QUEUE, MOCK_BANKING_AGGREGATE, [], MOCK_BANKING_EXCEPTIONS, [], MOCK_MERCHANTS, MOCK_CUSTOMER_MATCHING, MOCK_SUPPLIER_MATCHING]
    : await Promise.all([
        getMatchingQueue(companyId),
        getBankingAutomationAggregate(companyId),
        listRecentImports(companyId),
        listBankingExceptions(companyId),
        listRuleApplicationsSince(companyId, `${todayIso}T00:00:00.000Z`),
        listMerchants(companyId),
        getCustomerMatchingWorkspace(companyId),
        getSupplierMatchingWorkspace(companyId),
      ]);

  const bankingAutomationSummary = buildBankingAutomationSummary(bankingAggregate, importBatches.map((b) => b.createdAt), bankingExceptions, ruleApplicationsToday, todayIso);
  const summary = previewMode ? MOCK_MATCHING_SUMMARY : buildMatchingSummary(bankingAggregate, queue, bankingAutomationSummary.automationRatePercent, bankingAutomationSummary.exceptionsAwaitingReview);

  // Real Duplicate Detection is fetched client-side by DuplicateDetectionTab
  // (a 12-entity-type composite query too heavy to run unconditionally on
  // every page load for a tab that isn't the default); Preview Mode gets
  // the same real, derived mock findings every other tab already shows.
  const duplicateFindings: DuplicateFinding[] = previewMode ? MOCK_DUPLICATE_FINDINGS : [];

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Matching Platform</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Matching</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              One Matching Engine, one Review Queue, one Confidence Engine. Every unmatched item across Bank Transactions, Customer/Supplier
              Matching, Duplicates, Allocation, and Cashbook — in one place.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "accuracy", label: "Matching Accuracy", value: `${summary.matchingAccuracyPercent}%`, icon: IconShieldCheck },
          { key: "autoMatch", label: "Auto Match %", value: `${summary.autoMatchPercent}%`, icon: IconSparkles },
          { key: "queue", label: "Manual Queue", value: String(summary.manualQueueCount), icon: IconGrid },
          { key: "duplicateRisk", label: "Duplicate Risk", value: String(summary.duplicateRiskCount), icon: IconAlertTriangle },
          { key: "ruleSuccess", label: "Rule Success Rate", value: `${summary.ruleSuccessRatePercent}%`, icon: IconReconcile },
          { key: "exceptions", label: "Unresolved Exceptions", value: String(summary.unresolvedExceptionsCount), icon: IconAlertTriangle },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample Matching data. Every action is disabled until Supabase is configured.
        </p>
      )}

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-vf-md" />}>
        <MatchingTabs
          companyId={companyId}
          summary={summary}
          queue={queue}
          merchants={merchants}
          duplicateFindings={duplicateFindings}
          customerMatching={customerMatching}
          supplierMatching={supplierMatching}
          previewMode={previewMode}
        />
      </Suspense>
    </div>
  );
}
