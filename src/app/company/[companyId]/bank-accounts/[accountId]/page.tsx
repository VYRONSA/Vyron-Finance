import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconImport } from "@/components/ui/icons";
import { ArchiveAccountButton } from "@/components/financial/archive-account-button";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getBankAccountSummary, listRecentTransactionsForAccount, maskAccountNumber } from "@/server/services/bank-account-service";
import { listRecentImports } from "@/server/services/import-service";
import { MOCK_BANK_ACCOUNT_SUMMARIES, MOCK_RECENT_TRANSACTIONS_BY_ACCOUNT } from "@/lib/mock/bank-accounts-data";
import { MOCK_IMPORT_BATCHES } from "@/lib/mock/import-centre-data";
import type { BankAccountStatus } from "@/server/accounting/types";

export const metadata: Metadata = {
  title: "Bank Account — VYRON FINANCE",
};

const STATUS_TONE: Record<BankAccountStatus, "good" | "warn" | "muted"> = {
  Active: "good",
  Inactive: "warn",
  Archived: "muted",
};

function money(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function BankAccountDetailPage({
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

  const recentTransactions = previewMode
    ? (MOCK_RECENT_TRANSACTIONS_BY_ACCOUNT[id] ?? [])
    : await listRecentTransactionsForAccount(companyId, id);

  // Import batches aren't scoped to a single bank account (one statement
  // file can carry rows for several accounts), so this is the company's
  // recent bank-statement imports generally — not filtered to this
  // account specifically.
  const recentImports = (previewMode ? MOCK_IMPORT_BATCHES : await listRecentImports(companyId))
    .filter((b) => b.importType === "bank_transactions")
    .slice(0, 5);

  const { account } = summary;
  const netMovement = account.currentBalance - account.openingBalance;
  const recoveredPct = summary.transactionCount > 0 ? Math.round(((summary.matched + summary.suggested) / summary.transactionCount) * 100) : 0;

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
      {/* Executive Hero — Account Summary */}
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-10">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
                {account.bankName} · {account.accountType || "Bank Account"}
              </span>
              <Badge tone={STATUS_TONE[account.status]}>{account.status}</Badge>
            </div>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">{account.accountName}</h1>
            <p className="mt-1 font-mono text-sm text-vf-on-dark-soft">{maskAccountNumber(account.accountNumber)}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-4xl font-semibold tabular-nums text-vf-on-dark">
              {money(account.currentBalance, account.currency)}
            </p>
            <p className="mt-1 text-sm text-vf-on-dark-soft">Current Balance</p>
          </div>
        </CardContent>
      </Card>

      {/* Statistics — Recovery + Matching Progress, Level 2 dark cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card tone="dark">
          <CardContent className="p-5">
            <p className="font-mono text-2xl font-semibold tabular-nums text-vf-on-dark">{summary.transactionCount}</p>
            <p className="mt-1 text-xs text-vf-on-dark-faint">Transactions Imported</p>
          </CardContent>
        </Card>
        <Card tone="dark">
          <CardContent className="p-5">
            <p className="font-mono text-2xl font-semibold tabular-nums text-vf-on-dark">{summary.matched}</p>
            <p className="mt-1 text-xs text-vf-on-dark-faint">Matched</p>
          </CardContent>
        </Card>
        <Card tone="dark">
          <CardContent className="p-5">
            <p className="font-mono text-2xl font-semibold tabular-nums text-vf-on-dark">{summary.suggested + summary.unallocated}</p>
            <p className="mt-1 text-xs text-vf-on-dark-faint">Outstanding</p>
          </CardContent>
        </Card>
        <Card tone="dark">
          <CardContent className="p-5">
            <p className="font-mono text-2xl font-semibold tabular-nums text-vf-on-dark">{recoveredPct}%</p>
            <p className="mt-1 text-xs text-vf-on-dark-faint">Recovery Progress</p>
          </CardContent>
        </Card>
      </div>

      {/* Primary Workspace — Recent Transactions. Dark tone: every
          content row on this page stays blue, so no row of blocks is
          left plain white. */}
      <Card tone="dark">
        <CardHeader>
          <CardTitle className="text-vf-on-dark">Recent Transactions</CardTitle>
          <CardDescription className="text-vf-on-dark-faint">The 10 most recent transactions imported against this account.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {recentTransactions.length === 0 ? (
            <EmptyState
              icon={<IconImport className="h-5 w-5" />}
              title="No transactions have been imported for this account yet."
              description="Import a bank statement to begin matching and recovering transactions."
            />
          ) : (
            <Table tone="dark">
              <TableHead tone="dark">
                <tr>
                  <TableHeadCell>Date</TableHeadCell>
                  <TableHeadCell>Description</TableHeadCell>
                  <TableHeadCell>Beneficiary</TableHeadCell>
                  <TableHeadCell className="text-right">Debit</TableHeadCell>
                  <TableHeadCell className="text-right">Credit</TableHeadCell>
                  <TableHeadCell>Status</TableHeadCell>
                </tr>
              </TableHead>
              <TableBody tone="dark">
                {recentTransactions.map((t) => (
                  <TableRow key={t.id} tone="dark">
                    <TableCell tone="dark">{t.transactionDate ?? "—"}</TableCell>
                    <TableCell tone="dark" className="font-medium text-vf-on-dark">{t.description}</TableCell>
                    <TableCell tone="dark">{t.beneficiary}</TableCell>
                    <TableCell tone="dark" className="text-right font-mono tabular-nums">{t.debit > 0 ? t.debit.toFixed(2) : "—"}</TableCell>
                    <TableCell tone="dark" className="text-right font-mono tabular-nums">{t.credit > 0 ? t.credit.toFixed(2) : "—"}</TableCell>
                    <TableCell tone="dark">{t.allocationStatus}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Secondary Workspace */}
      <Card tone="dark">
        <CardHeader>
          <CardTitle className="text-vf-on-dark">Balance Movement</CardTitle>
          <CardDescription className="text-vf-on-dark-faint">Opening balance vs. current balance for this account.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-vf-on-dark-faint">Opening Balance</dt>
              <dd className="mt-1 font-mono tabular-nums text-vf-on-dark">{money(account.openingBalance, account.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-vf-on-dark-faint">Net Movement</dt>
              <dd className={`mt-1 font-mono tabular-nums ${netMovement >= 0 ? "text-vf-success" : "text-vf-danger"}`}>
                {netMovement >= 0 ? "+" : ""}
                {money(netMovement, account.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-vf-on-dark-faint">Current Balance</dt>
              <dd className="mt-1 font-mono tabular-nums text-vf-on-dark">{money(account.currentBalance, account.currency)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Recent Bank Statement Imports — company-wide, see note above */}
      <Card tone="dark">
        <CardHeader>
          <CardTitle className="text-vf-on-dark">Recent Bank Statement Imports</CardTitle>
          <CardDescription className="text-vf-on-dark-faint">The most recent Standard VYRON Bank Import Template files imported for this company.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {recentImports.length === 0 ? (
            <EmptyState
              icon={<IconImport className="h-5 w-5" />}
              title="No bank statements have been imported yet."
              description="Import a Standard VYRON bank statement CSV from the Import Centre to bring transactions into this account."
              action={
                <Button href={`/company/${companyId}/import-centre`} variant="primary" size="sm">
                  Open Import Centre
                </Button>
              }
            />
          ) : (
            <Table tone="dark">
              <TableHead tone="dark">
                <tr>
                  <TableHeadCell>File</TableHeadCell>
                  <TableHeadCell className="text-right">Imported</TableHeadCell>
                  <TableHeadCell className="text-right">Duplicates</TableHeadCell>
                  <TableHeadCell className="text-right">Exceptions</TableHeadCell>
                  <TableHeadCell>When</TableHeadCell>
                </tr>
              </TableHead>
              <TableBody tone="dark">
                {recentImports.map((batch) => (
                  <TableRow key={batch.id} tone="dark">
                    <TableCell tone="dark" className="font-medium text-vf-on-dark">{batch.sourceFilename}</TableCell>
                    <TableCell tone="dark" className="text-right font-mono tabular-nums">{batch.importedCount}</TableCell>
                    <TableCell tone="dark" className="text-right font-mono tabular-nums">{batch.duplicateCount}</TableCell>
                    <TableCell tone="dark" className="text-right font-mono tabular-nums">{batch.exceptionCount}</TableCell>
                    <TableCell tone="dark">{new Date(batch.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-vf-on-dark-faint">Quick Actions</p>
        <div className="flex flex-wrap gap-3">
          <Button href={`/company/${companyId}/bank-accounts/${account.id}/edit`} variant="outline" size="sm">
            Edit Bank Account
          </Button>
          <Button href={`/company/${companyId}/import-centre`} variant="outline" size="sm">
            Import Bank Statement
          </Button>
          <Button href={`/company/${companyId}/supplier-reconciliation`} variant="outline" size="sm">
            Open Supplier Reconciliation
          </Button>
          {account.status !== "Archived" && (
            <ArchiveAccountButton companyId={companyId} accountId={account.id} previewMode={previewMode} />
          )}
        </div>
      </div>
    </div>
  );
}
