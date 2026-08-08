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
import { MOCK_TRANSACTIONS } from "@/lib/mock/transaction-explorer-data";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import { MOCK_SUPPLIERS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";
import { MOCK_MERCHANTS } from "@/lib/mock/banking-automation-data";
import { MOCK_CHART_OF_ACCOUNTS } from "@/lib/mock/general-ledger-data";
import { MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";

export const metadata: Metadata = {
  title: "Transaction Explorer — VYRON FINANCE",
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
  const chartOfAccounts = previewMode ? MOCK_CHART_OF_ACCOUNTS : await listChartOfAccounts(companyId);
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
    // UX-006/UX-011 — "Processing Mode... remove unnecessary page
    // chrome/large headers/decorative hero sections... the grid should
    // occupy roughly 85-90% of available browser height." The old
    // Executive Hero card and company-wide Executive Summary bar are
    // gone from this page entirely — this is a processing screen, not a
    // report, and `TransactionExplorer`'s own page-scoped "This page"
    // stats row already satisfies "Allocation statistics" without a
    // second, redundant company-wide bar competing for the same space.
    // `h-full min-h-0` (paired with `workspace-shell.tsx`'s `<main
    // className="overflow-y-auto">`) is what actually lets the grid fill
    // the remaining browser height instead of just growing to its
    // content's natural size. `min-w-0` — see `workspace-shell.tsx`'s
    // own note on VR-022.
    <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-[1800px] flex-col gap-3">
      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample transactions. Filtering, sorting, and column choice all work against this
          sample; mutations are disabled until Supabase is configured.
        </p>
      )}

      {/* `min-h-0 flex-1` — this wrapper, not `TransactionExplorer`
          itself, is what claims "the rest of the available height" in
          this page's own flex column (the preview-mode banner above it
          keeps its natural height instead of being squeezed). */}
      <div className="min-h-0 min-w-0 flex-1">
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
