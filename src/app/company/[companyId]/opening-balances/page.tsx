import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { OpeningBalancesCentre } from "@/components/financial/opening-balances/opening-balances-centre";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listOpeningBalanceEntries, getOpeningBalanceGovernance } from "@/server/services/opening-balance-service";
import { listBankAccounts } from "@/server/repositories/bank-account-repository";
import { listCustomers } from "@/server/services/customer-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";

export const metadata: Metadata = {
  title: "Opening Balances — VYRON FINANCE",
};

export default async function OpeningBalancesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const [entries, governance, bankAccounts, customers, suppliers, chartOfAccounts] = previewMode
    ? [[], { requiresGovernance: false, reasonRequired: false }, [], [], [], []]
    : await Promise.all([
        listOpeningBalanceEntries(companyId),
        getOpeningBalanceGovernance(companyId),
        listBankAccounts(companyId),
        listCustomers(companyId),
        listSuppliers(companyId),
        listChartOfAccounts(companyId),
      ]);

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
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Company Setup</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Opening Balances</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Every opening balance is posted through the same one Posting Engine every other module uses — a real,
              traceable journal, never a hidden number.
            </p>
          </div>
        </CardContent>
      </Card>

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-vf-md" />}>
        <OpeningBalancesCentre
          companyId={companyId}
          entries={entries}
          governance={governance}
          bankAccounts={bankAccounts}
          customers={customers}
          suppliers={suppliers}
          chartOfAccounts={chartOfAccounts}
          previewMode={previewMode}
        />
      </Suspense>
    </div>
  );
}
