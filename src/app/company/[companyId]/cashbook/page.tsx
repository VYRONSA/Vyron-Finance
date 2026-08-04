import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { CashbookTabs } from "@/components/financial/cashbook/cashbook-tabs";
import { IconBanknote, IconImport, IconReconcile, IconSliders } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import { listBankAccountSummaries } from "@/server/services/bank-account-service";
import { listCashbookBatches, listCashbookTransactions } from "@/server/services/cashbook-service";
import { getReconciliationSummary, listReconciliations } from "@/server/services/bank-reconciliation-service";
import { MOCK_COMPANIES_FULL } from "@/lib/mock/company-management-data";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import { MOCK_BANK_RECONCILIATIONS, MOCK_CASHBOOK_BATCHES, MOCK_CASHBOOK_TRANSACTIONS, MOCK_RECONCILIATION_SUMMARY } from "@/lib/mock/cashbook-data";

export const metadata: Metadata = {
  title: "Cashbook — VYRON FINANCE",
};

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function CashbookPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const company = previewMode ? MOCK_COMPANIES_FULL.find((c) => c.id === companyId) : await getCompany(companyId);
  if (!company) notFound();

  const [bankAccountSummaries, entries, batches, reconciliations] = previewMode
    ? [MOCK_BANK_ACCOUNT_SUMMARIES, MOCK_CASHBOOK_TRANSACTIONS, MOCK_CASHBOOK_BATCHES, MOCK_BANK_RECONCILIATIONS]
    : await Promise.all([listBankAccountSummaries(companyId), listCashbookTransactions(companyId), listCashbookBatches(companyId), listReconciliations(companyId)]);

  const bankAccounts = bankAccountSummaries.map((s) => ({ id: s.account.id, accountName: s.account.accountName }));
  const activeReconciliation = reconciliations.find((r) => r.status === "InProgress" || r.status === "Reopened") ?? null;
  const activeSummary = previewMode ? (activeReconciliation ? MOCK_RECONCILIATION_SUMMARY : null) : activeReconciliation ? await getReconciliationSummary(companyId, activeReconciliation.id) : null;

  const manualEntries = entries.filter((e) => e.entrySource === "Manual" && e.captureStatus !== "Cancelled");
  const draftCount = entries.filter((e) => e.captureStatus === "Draft" || e.captureStatus === "Submitted").length;
  const unprocessedImportedCount = entries.filter((e) => e.entrySource === "Imported" && e.journalId === null).length;
  const outstandingReconciliationCount = activeSummary?.outstandingItems.length ?? 0;

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
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Cashbook & Bank Reconciliation</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Cashbook</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Receipts, payments, bank transfers, and a full reconciliation workflow — the visible, auditable Cashbook every real accounting
              practice expects, posting through the same one Posting Engine every other module uses.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "manualEntries", label: "Cashbook Entries", value: String(manualEntries.length), icon: IconBanknote },
          { key: "draftCount", label: "Awaiting Post", value: String(draftCount), icon: IconSliders },
          { key: "unprocessedImported", label: "Unprocessed Bank Feed", value: String(unprocessedImportedCount), icon: IconImport },
          { key: "outstanding", label: "Outstanding to Reconcile", value: String(outstandingReconciliationCount), icon: IconReconcile },
          { key: "difference", label: "Reconciliation Difference", value: activeSummary ? money(activeSummary.difference) : "—", icon: IconReconcile },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample Cashbook data. Every action is disabled until Supabase is configured.
        </p>
      )}

      <CashbookTabs
        companyId={companyId}
        entries={entries}
        bankAccounts={bankAccounts}
        batches={batches}
        reconciliations={reconciliations}
        activeReconciliation={activeReconciliation}
        activeSummary={activeSummary}
        previewMode={previewMode}
      />
    </div>
  );
}
