import type { Metadata } from "next";
import { FindAndRecode } from "@/components/financial/transaction-explorer/find-and-recode";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listBankAccounts } from "@/server/repositories/bank-account-repository";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { sortByGlAccountCode } from "@/server/general-ledger/types";
import { listSuppliers } from "@/server/repositories/supplier-reconciliation-repository";
import { listCustomers } from "@/server/repositories/customer-repository";
import { listVatTreatments } from "@/server/repositories/vat-treatment-repository";
import { getCurrentUserId } from "@/server/auth/require-session";
import { listPresets } from "@/server/services/find-and-recode-preset-service";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import { MOCK_CHART_OF_ACCOUNTS } from "@/lib/mock/general-ledger-data";
import { MOCK_SUPPLIERS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";
import { MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";

export const metadata: Metadata = {
  title: "Find & Recode — VYRON FINANCE",
};

export default async function FindAndRecodePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const bankAccounts = previewMode
    ? MOCK_BANK_ACCOUNT_SUMMARIES.map((s) => ({ id: s.account.id, accountName: s.account.accountName }))
    : (await listBankAccounts(companyId)).map((a) => ({ id: a.id, accountName: a.accountName }));
  // Phase 30 — same reasoning as the Transaction Explorer page: guarantee
  // numeric GL-code order regardless of preview vs. real data source.
  const chartOfAccounts = sortByGlAccountCode(previewMode ? MOCK_CHART_OF_ACCOUNTS : await listChartOfAccounts(companyId));
  const suppliers = previewMode ? MOCK_SUPPLIERS : await listSuppliers(companyId);
  const customers = previewMode ? MOCK_CUSTOMERS : await listCustomers(companyId);
  const vatTreatments = previewMode ? MOCK_VAT_TREATMENTS : await listVatTreatments(companyId);
  // Cheap by construction — this table's own small rows only, never
  // transaction data (see find-and-recode-preset-repository.ts).
  const presets = previewMode ? [] : await listPresets(companyId, await getCurrentUserId());

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-4 overflow-y-auto">
      <div>
        <h1 className="text-xl font-medium text-vf-ink">Find &amp; Recode</h1>
        <p className="text-sm text-vf-ink-faint">
          Search transactions with precise filters, review your results, then recode the GL account, supplier, customer, or VAT
          treatment for some or all of them in one reviewed, confirmed action.
        </p>
      </div>

      {previewMode && (
        <p className="text-xs text-vf-ink-faint">Preview Mode — Find &amp; Recode is disabled until Supabase is configured.</p>
      )}

      <FindAndRecode
        companyId={companyId}
        previewMode={previewMode}
        bankAccounts={bankAccounts}
        chartOfAccounts={chartOfAccounts}
        suppliers={suppliers}
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        vatTreatments={vatTreatments}
        initialPresets={presets.map((p) => ({ id: p.id, name: p.name, filters: p.filters }))}
      />
    </div>
  );
}
