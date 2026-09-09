import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BankAccountForm } from "@/components/financial/bank-account-form";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { listCurrencies } from "@/server/services/currency-service";
import { MOCK_CHART_OF_ACCOUNTS } from "@/lib/mock/general-ledger-data";
import { MOCK_CURRENCIES } from "@/lib/mock/company-management-data";

export const metadata: Metadata = {
  title: "Create Bank Account — VYRON FINANCE",
};

export default async function NewBankAccountPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const [chartOfAccounts, currencies] = previewMode
    ? [MOCK_CHART_OF_ACCOUNTS, MOCK_CURRENCIES]
    : await Promise.all([listChartOfAccounts(companyId), listCurrencies()]);

  return (
    <div className="w-full">
      <Card>
        <CardHeader>
          <CardTitle>Create Bank Account</CardTitle>
          <CardDescription>Set up a new bank account before importing statements against it.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <BankAccountForm companyId={companyId} mode="create" chartOfAccounts={chartOfAccounts} currencies={currencies} previewMode={previewMode} />
        </CardContent>
      </Card>
    </div>
  );
}
