import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { TransactionExplorer } from "@/components/financial/transaction-explorer/transaction-explorer";
import { IconListChecks, IconReconcile, IconAlertTriangle, IconBookOpen, IconBanknote, IconImport } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getSummary, listTransactions } from "@/server/services/transaction-explorer-service";
import { listBankAccounts } from "@/server/repositories/bank-account-repository";
import { listSuppliers } from "@/server/repositories/supplier-reconciliation-repository";
import { listCustomers } from "@/server/repositories/customer-repository";
import { listMerchants } from "@/server/repositories/merchant-repository";
import { MOCK_TRANSACTION_SUMMARY, MOCK_TRANSACTIONS } from "@/lib/mock/transaction-explorer-data";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import { MOCK_SUPPLIERS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";
import { MOCK_MERCHANTS } from "@/lib/mock/banking-automation-data";

export const metadata: Metadata = {
  title: "Transaction Explorer — VYRON FINANCE",
};

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function TransactionExplorerPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const summary = previewMode ? MOCK_TRANSACTION_SUMMARY : await getSummary(companyId);
  const bankAccounts = previewMode
    ? MOCK_BANK_ACCOUNT_SUMMARIES.map((s) => ({ id: s.account.id, accountName: s.account.accountName }))
    : (await listBankAccounts(companyId)).map((a) => ({ id: a.id, accountName: a.accountName }));
  const suppliers = previewMode ? MOCK_SUPPLIERS : await listSuppliers(companyId);
  const customers = previewMode ? MOCK_CUSTOMERS : await listCustomers(companyId);
  const merchants = previewMode ? MOCK_MERCHANTS : await listMerchants(companyId);

  const defaultFilters = {
    search: null, dateFrom: null, dateTo: null, minAmount: null, maxAmount: null,
    statuses: null, bankAccountId: null, importBatch: null, duplicateOnly: false,
    unknownSupplierOnly: false, sortBy: "transactionDate" as const, sortDirection: "desc" as const,
  };
  const initialPage = previewMode
    ? { transactions: MOCK_TRANSACTIONS, nextCursor: null, hasMore: false }
    : await listTransactions(companyId, defaultFilters, null);

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
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Transaction Explorer</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Every imported bank transaction, searchable, filterable, and actionable in one place — the record
              every other module reads from.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Executive Summary — company-wide, real, updates automatically as
          transactions are imported and matched */}
      <ExecutiveSummaryBar
        items={[
          { key: "total", label: "Total Transactions", value: String(summary.totalTransactions), icon: IconListChecks },
          { key: "matched", label: "Matched", value: String(summary.matched), icon: IconReconcile },
          { key: "unmatched", label: "Unmatched", value: String(summary.unmatched), icon: IconAlertTriangle },
          { key: "awaitingReview", label: "Awaiting Review", value: String(summary.awaitingReview), icon: IconAlertTriangle },
          { key: "journals", label: "Journals Created", value: String(summary.journalsCreated), icon: IconBookOpen },
          { key: "totalValue", label: "Total Value", value: money(summary.totalValue), icon: IconBanknote },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample transactions. Filtering, sorting, and column choice all work against this
          sample; mutations are disabled until Supabase is configured.
        </p>
      )}

      <TransactionExplorer
        companyId={companyId}
        previewMode={previewMode}
        bankAccounts={bankAccounts}
        suppliers={suppliers}
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        merchants={merchants}
        initialTransactions={initialPage.transactions}
        initialNextCursor={initialPage.nextCursor}
        initialHasMore={initialPage.hasMore}
      />
    </div>
  );
}
