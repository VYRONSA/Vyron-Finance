import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BankAccountForm } from "@/components/financial/bank-account-form";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getBankAccountSummary } from "@/server/services/bank-account-service";
import { getOpeningBalanceGovernance } from "@/server/services/opening-balance-service";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { listCurrencies } from "@/server/services/currency-service";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import { MOCK_CHART_OF_ACCOUNTS } from "@/lib/mock/general-ledger-data";
import { MOCK_CURRENCIES } from "@/lib/mock/company-management-data";

export const metadata: Metadata = {
  title: "Edit Bank Account — VYRON FINANCE",
};

export default async function EditBankAccountPage({
  params,
}: {
  params: Promise<{ companyId: string; accountId: string }>;
}) {
  const { companyId, accountId } = await params;
  const previewMode = !isSupabaseConfigured();
  const id = Number(accountId);

  const summary = previewMode
    ? MOCK_BANK_ACCOUNT_SUMMARIES.find((s) => s.account.id === id)
    : await getBankAccountSummary(companyId, id);

  if (!summary) notFound();

  const governance = previewMode ? { requiresGovernance: false, reasonRequired: false } : await getOpeningBalanceGovernance(companyId);
  const [chartOfAccounts, currencies] = previewMode
    ? [MOCK_CHART_OF_ACCOUNTS, MOCK_CURRENCIES]
    : await Promise.all([listChartOfAccounts(companyId), listCurrencies()]);

  return (
    <div className="w-full">
      <Card>
        <CardHeader>
          <CardTitle>Edit {summary.account.accountName}</CardTitle>
          <CardDescription>Account number cannot be changed after creation.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <BankAccountForm companyId={companyId} mode="edit" account={summary.account} chartOfAccounts={chartOfAccounts} currencies={currencies} previewMode={previewMode} governance={governance} />
        </CardContent>
      </Card>
    </div>
  );
}
