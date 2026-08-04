import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { IconAlertTriangle, IconBank, IconBanknote, IconImport, IconPlus } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listBankAccountSummaries, maskAccountNumber } from "@/server/services/bank-account-service";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import type { BankAccountSummary, BankAccountStatus } from "@/server/accounting/types";

export const metadata: Metadata = {
  title: "Bank Accounts — VYRON FINANCE",
};

const STATUS_TONE: Record<BankAccountStatus, "good" | "warn" | "muted"> = {
  Active: "good",
  Inactive: "warn",
  Archived: "muted",
};

function money(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

export default async function BankAccountsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const summaries = previewMode ? MOCK_BANK_ACCOUNT_SUMMARIES : await listBankAccountSummaries(companyId);

  const activeAccounts = summaries.filter((s) => s.account.status !== "Archived");
  const totalBalance = activeAccounts.reduce((sum, s) => sum + s.account.currentBalance, 0);
  const needingReconciliation = activeAccounts.filter((s) => {
    const days = daysSince(s.account.lastReconciliationDate);
    return days === null || days > 30;
  }).length;
  const recentImportCount = activeAccounts.filter((s) => {
    const days = daysSince(s.lastImport);
    return days !== null && days <= 14;
  }).length;
  const importHealthPct = activeAccounts.length > 0 ? Math.round((recentImportCount / activeAccounts.length) * 100) : 0;

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
      {/* Executive Hero */}
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
              Financial Workspace
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Bank Accounts</h1>
            <p className="mt-1.5 max-w-[52ch] text-sm text-vf-on-dark-soft">
              The foundation of the financial workspace — every account this company banks with, its
              balance, and its recovery status, in one place.
            </p>
          </div>
          <Button href={`/company/${companyId}/bank-accounts/new`} variant="ghostDark">
            <IconPlus className="h-4 w-4" />
            Create Bank Account
          </Button>
        </CardContent>
      </Card>

      {/* Executive Summary — same white bar used on the Dashboard */}
      <ExecutiveSummaryBar
        items={[
          { key: "accounts", label: "Bank Accounts", value: String(activeAccounts.length), icon: IconBank },
          { key: "balance", label: "Total Balance", value: money(totalBalance, "ZAR"), icon: IconBanknote },
          {
            key: "reconciliation",
            label: "Needing Reconciliation",
            value: String(needingReconciliation),
            trend: needingReconciliation > 0 ? "↓ Over 30 days" : undefined,
            icon: IconAlertTriangle,
          },
          { key: "importHealth", label: "Import Health", value: `${importHealthPct}%`, icon: IconImport },
        ]}
      />

      {/* Primary Workspace */}
      {summaries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconBank className="h-5 w-5" />}
            title="No bank accounts have been set up yet."
            description="Bank accounts are required before statements can be imported or transactions matched — create your first account to begin the recovery process."
            action={
              <Button href={`/company/${companyId}/bank-accounts/new`} variant="primary" size="sm">
                Create Bank Account
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((summary) => (
            <AccountCard key={summary.account.id} summary={summary} companyId={companyId} />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountCard({ summary, companyId }: { summary: BankAccountSummary; companyId: string }) {
  const { account } = summary;
  return (
    <Link href={`/company/${companyId}/bank-accounts/${account.id}`}>
      <Card className="flex h-full flex-col justify-between p-5 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-vf-paper-lg">
        <CardContent className="flex h-full flex-col justify-between gap-4 p-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-sans text-sm font-semibold text-vf-ink">{account.accountName}</p>
              <p className="text-xs text-vf-ink-faint">{account.bankName}</p>
            </div>
            <Badge tone={STATUS_TONE[account.status]}>{account.status}</Badge>
          </div>

          <div>
            <p className="font-mono text-2xl font-semibold tabular-nums text-vf-ink">
              {money(account.currentBalance, account.currency)}
            </p>
            <p className="mt-0.5 font-mono text-xs text-vf-ink-faint">{maskAccountNumber(account.accountNumber)}</p>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-vf-paper-border pt-3 text-xs">
            <dt className="text-vf-ink-faint">Transactions</dt>
            <dd className="text-right font-mono tabular-nums text-vf-ink-soft">{summary.transactionCount}</dd>
            <dt className="text-vf-ink-faint">Last Import</dt>
            <dd className="text-right text-vf-ink-soft">{summary.lastImport ?? "Never"}</dd>
            <dt className="text-vf-ink-faint">Last Reconciled</dt>
            <dd className="text-right text-vf-ink-soft">{account.lastReconciliationDate ?? "Never"}</dd>
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}
