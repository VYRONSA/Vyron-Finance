import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { ImportUploadCard } from "@/components/financial/import-upload-card";
import { StatementProcessingFlow } from "@/components/financial/import-centre/statement-processing-flow";
import { IconImport, IconFileText, IconListChecks, IconAlertTriangle } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listRecentImports } from "@/server/services/import-service";
import { listBankAccountSummaries } from "@/server/services/bank-account-service";
import { MOCK_IMPORT_BATCHES } from "@/lib/mock/import-centre-data";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import type { ImportBatch } from "@/server/accounting/types";

export const metadata: Metadata = {
  title: "Import Centre — VYRON FINANCE",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default async function ImportCentrePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  // Phase 8 — Intelligent Bank Statement Processing. `bankAccountSummaries`
  // is the same `listBankAccountSummaries` read the Banking Command
  // Centre already uses — reused here so the new guided flow's Reconcile
  // step can show a real, existing account's real reconciliation date,
  // not a fabricated one.
  const [batches, bankAccountSummaries] = previewMode
    ? [MOCK_IMPORT_BATCHES, MOCK_BANK_ACCOUNT_SUMMARIES]
    : await Promise.all([listRecentImports(companyId), listBankAccountSummaries(companyId)]);

  const rowsImported = batches.reduce((sum, b) => sum + b.importedCount, 0);
  const duplicatesSkipped = batches.reduce((sum, b) => sum + b.duplicateCount, 0);
  const exceptionsFlagged = batches.reduce((sum, b) => sum + b.exceptionCount, 0);

  return (
    <div className="flex w-full flex-col gap-6">
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
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Import Centre</h1>
            <p className="mt-1.5 max-w-[56ch] text-sm text-vf-on-dark-soft">
              Import supplier Bills / Credit Notes and bank statements using the Standard VYRON templates —
              every row is validated, duplicates are skipped automatically, and every file becomes a permanent
              import record.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Executive Summary — same white bar used across the Financial Workspace */}
      <ExecutiveSummaryBar
        items={[
          { key: "batches", label: "Import Batches", value: String(batches.length), icon: IconImport },
          { key: "rowsImported", label: "Rows Imported", value: String(rowsImported), icon: IconFileText },
          { key: "duplicates", label: "Duplicates Skipped", value: String(duplicatesSkipped), icon: IconListChecks },
          { key: "exceptions", label: "Exceptions Flagged", value: String(exceptionsFlagged), icon: IconAlertTriangle },
        ]}
      />

      {/* Upload — Bills/Credit Notes stays a simple one-shot card; Bank
          Statement gets the guided Upload → Analyse → Review →
          Allocate/Match → Reconcile experience (Phase 8). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ImportUploadCard
          companyId={companyId}
          kind="bills"
          title="Bills / Credit Notes"
          description="Xero-style CSV export — supplier, invoice number, and amount columns are matched by name automatically."
          templateHint="Any CSV with recognisable Supplier and Invoice Number columns is accepted; column order doesn't matter."
          previewMode={previewMode}
        />
        <StatementProcessingFlow companyId={companyId} previewMode={previewMode} bankAccountSummaries={bankAccountSummaries} />
      </div>

      {/* Onboarding a whole new client from Xero (Contacts, Sales
          Invoices, Bills, and Bank Transactions together, plus Chart of
          Accounts reconciliation) is a different, larger operation than
          the single-file uploads above — its own dedicated page. */}
      <Card>
        <CardHeader>
          <CardTitle>Migrating a new client from Xero?</CardTitle>
          <CardDescription>Import Contacts, Sales Invoices, Bills, and Bank Transactions together in one guided migration.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Link href={`/company/${companyId}/xero-import`} className="text-sm font-semibold text-vf-red-600 hover:underline">
            Go to Xero Migration →
          </Link>
        </CardContent>
      </Card>

      {/* Recent Imports */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Imports</CardTitle>
          <CardDescription>Your most recent imports for this company (up to the last 20), most recent first — not a full history.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {batches.length === 0 ? (
            <EmptyState
              icon={<IconImport className="h-5 w-5" />}
              title="No imports yet."
              description="Import a Bills/Credit Notes CSV or a bank statement above to see it here."
            />
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeadCell>File</TableHeadCell>
                  <TableHeadCell>Type</TableHeadCell>
                  <TableHeadCell className="text-right">Imported</TableHeadCell>
                  <TableHeadCell className="text-right">Duplicates</TableHeadCell>
                  <TableHeadCell className="text-right">Exceptions</TableHeadCell>
                  <TableHeadCell>When</TableHeadCell>
                </tr>
              </TableHead>
              <TableBody>
                {batches.map((batch) => (
                  <ImportBatchRow key={batch.id} batch={batch} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ImportBatchRow({ batch }: { batch: ImportBatch }) {
  return (
    <TableRow>
      <TableCell className="font-medium text-vf-ink">{batch.sourceFilename}</TableCell>
      <TableCell>
        <Badge tone="info">{batch.importType === "bills" ? "Bills / Credit Notes" : "Bank Statement"}</Badge>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">{batch.importedCount}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{batch.duplicateCount}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {batch.exceptionCount > 0 ? <Badge tone="warn">{batch.exceptionCount}</Badge> : "0"}
      </TableCell>
      <TableCell>{formatDateTime(batch.createdAt)}</TableCell>
    </TableRow>
  );
}
