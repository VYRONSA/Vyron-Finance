import type { Metadata } from "next";
import { TransactionExplorer } from "@/components/financial/transaction-explorer/transaction-explorer";
import { IconImport } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listTransactions } from "@/server/services/transaction-explorer-service";
import { listBankAccounts } from "@/server/repositories/bank-account-repository";
import { listSuppliers } from "@/server/repositories/supplier-reconciliation-repository";
import { listCustomers } from "@/server/repositories/customer-repository";
import { listMerchants } from "@/server/repositories/merchant-repository";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { listVatTreatments } from "@/server/repositories/vat-treatment-repository";
import { sortByGlAccountCode } from "@/server/general-ledger/types";
import { MOCK_TRANSACTIONS } from "@/lib/mock/transaction-explorer-data";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import { MOCK_SUPPLIERS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";
import { MOCK_MERCHANTS } from "@/lib/mock/banking-automation-data";
import { MOCK_CHART_OF_ACCOUNTS } from "@/lib/mock/general-ledger-data";
import { MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";

export const metadata: Metadata = {
  title: "Transactions — VYRON FINANCE",
};

export default async function TransactionExplorerPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ importBatch?: string }>;
}) {
  const { companyId } = await params;
  const { importBatch } = await searchParams;
  const previewMode = !isSupabaseConfigured();

  const bankAccounts = previewMode
    ? MOCK_BANK_ACCOUNT_SUMMARIES.map((s) => ({ id: s.account.id, accountName: s.account.accountName }))
    : (await listBankAccounts(companyId)).map((a) => ({ id: a.id, accountName: a.accountName }));
  const suppliers = previewMode ? MOCK_SUPPLIERS : await listSuppliers(companyId);
  const customers = previewMode ? MOCK_CUSTOMERS : await listCustomers(companyId);
  const merchants = previewMode ? MOCK_MERCHANTS : await listMerchants(companyId);
  // Phase 30 — `listChartOfAccounts` already returns numerically-sorted
  // accounts for a real company; `MOCK_CHART_OF_ACCOUNTS` (preview mode,
  // no Supabase configured) is a hand-authored fixture that isn't
  // guaranteed to be in order itself, so the sort is applied uniformly
  // here regardless of which branch ran — the selector is always
  // correctly ordered either way.
  const chartOfAccounts = sortByGlAccountCode(previewMode ? MOCK_CHART_OF_ACCOUNTS : await listChartOfAccounts(companyId));
  const vatTreatments = previewMode ? MOCK_VAT_TREATMENTS : await listVatTreatments(companyId);

  // Pilot Review Board follow-up — the new Import Summary screen's
  // "Review Transactions" button links here with `?importBatch=...` so
  // an accountant lands directly on the statement they just imported,
  // not the whole unfiltered ledger.
  const defaultFilters = {
    search: null, dateFrom: null, dateTo: null, minAmount: null, maxAmount: null,
    statuses: null, bankAccountId: null, importBatch: importBatch ?? null, duplicateOnly: false,
    unknownSupplierOnly: false, sortBy: "transactionDate" as const, sortDirection: "desc" as const,
  };
  const initialPage = previewMode
    ? { transactions: MOCK_TRANSACTIONS, nextCursor: null, hasMore: false }
    : await listTransactions(companyId, defaultFilters, null);

  return (
    // Phase 26A — the Transaction Intelligence header (title/subtitle,
    // the 5-card ExecutiveSummaryBar, and the Attention Queue) was
    // removed from this page per real production usage feedback: it
    // consumed a large amount of vertical space before an accountant
    // ever reached the actual filters/grid. That capability itself was
    // NOT deleted — `TransactionAttentionQueue`/`ExecutiveSummaryBar`
    // remain real, tested components (`ExecutiveSummaryBar` is still
    // used across 20+ other pages); only this page's rendering of them
    // was removed. UX-006/UX-011's original "Processing Mode" intent —
    // the grid should occupy nearly the full viewport — is restored:
    // this page now opens directly into TransactionExplorer's own
    // filters/action bar/grid, with no page-level chrome above it.
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-4 overflow-y-auto">
      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample transactions. Filtering, sorting, and column choice all work against this
          sample; mutations are disabled until Supabase is configured.
        </p>
      )}

      {/* `min-h-0 flex-1` — this wrapper, not `TransactionExplorer`
          itself, is what claims the full available height in this
          page's own flex column. */}
      <div className="min-h-[600px] min-w-0 flex-1">
        <TransactionExplorer
          companyId={companyId}
          previewMode={previewMode}
          bankAccounts={bankAccounts}
          suppliers={suppliers}
          customers={customers.map((c) => ({ id: c.id, name: c.name, customerCode: c.customerCode }))}
          merchants={merchants}
          chartOfAccounts={chartOfAccounts}
          vatTreatments={vatTreatments}
          initialTransactions={initialPage.transactions}
          initialNextCursor={initialPage.nextCursor}
          initialHasMore={initialPage.hasMore}
          initialImportBatch={importBatch ?? null}
        />
      </div>
    </div>
  );
}
