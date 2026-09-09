"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ImportEntityResult = {
  found: number;
  imported: number;
  skipped: number;
  duplicatesPrevented: number;
  errors: { identifier: string; reason: string }[];
  warnings: { identifier: string; reason: string }[];
};

type ChartReconciliationResult = { created: string[]; updated: string[]; unchanged: string[] };

type XeroImportOutcome = {
  chartOfAccounts: ChartReconciliationResult;
  contacts: ImportEntityResult;
  salesInvoices: ImportEntityResult;
  bills: ImportEntityResult;
  bankAccounts: ImportEntityResult;
  bankTransactions: ImportEntityResult;
};

function EntitySummary({ title, result }: { title: string; result: ImportEntityResult }) {
  return (
    <div className="rounded-lg border border-vf-paper-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-vf-ink">{title}</h3>
        <div className="flex gap-2 text-xs">
          <Badge tone="muted">Found {result.found}</Badge>
          <Badge tone="good">Imported {result.imported}</Badge>
          <Badge tone="muted">Duplicates prevented {result.duplicatesPrevented}</Badge>
          {result.skipped > 0 && <Badge tone="warn">Skipped {result.skipped}</Badge>}
          {result.errors.length > 0 && <Badge tone="danger">Errors {result.errors.length}</Badge>}
        </div>
      </div>
      {result.errors.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-vf-danger">
          {result.errors.map((e, i) => (
            <li key={i}>
              <span className="font-medium">{e.identifier}:</span> {e.reason}
            </li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <details className="mt-2 text-xs text-vf-ink-soft">
          <summary className="cursor-pointer">Warnings ({result.warnings.length})</summary>
          <ul className="mt-1 space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i}>
                <span className="font-medium">{w.identifier}:</span> {w.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function XeroImportPanel({ companyId }: { companyId: string }) {
  const [contactsFiles, setContactsFiles] = useState<FileList | null>(null);
  const [salesInvoicesFile, setSalesInvoicesFile] = useState<File | null>(null);
  const [billsFile, setBillsFile] = useState<File | null>(null);
  const [bankTransactionsFile, setBankTransactionsFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [outcome, setOutcome] = useState<XeroImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasAnyFile = Boolean(contactsFiles?.length || salesInvoicesFile || billsFile || bankTransactionsFile);

  async function handleImport() {
    setImporting(true);
    setError(null);
    setOutcome(null);
    try {
      const formData = new FormData();
      if (contactsFiles) Array.from(contactsFiles).forEach((f) => formData.append("contacts", f));
      if (salesInvoicesFile) formData.append("salesInvoices", salesInvoicesFile);
      if (billsFile) formData.append("bills", billsFile);
      if (bankTransactionsFile) formData.append("bankTransactions", bankTransactionsFile);

      const response = await fetch(`/api/companies/${companyId}/xero-import`, { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Import failed.");
      setOutcome(body.outcome as XeroImportOutcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Xero Migration — Upload Source Files</CardTitle>
          <CardDescription>Upload the exact CSV/XLSX exports from Xero. Nothing is imported until you click Import.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block text-sm font-medium text-vf-ink">
            Contacts CSV (one or more exports — overlapping contacts are reconciled automatically)
            <input type="file" accept=".csv" multiple onChange={(e) => setContactsFiles(e.target.files)} className="mt-1 block w-full text-sm" />
          </label>
          <label className="block text-sm font-medium text-vf-ink">
            Sales Invoices CSV
            <input type="file" accept=".csv" onChange={(e) => setSalesInvoicesFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
          </label>
          <label className="block text-sm font-medium text-vf-ink">
            Bills CSV
            <input type="file" accept=".csv" onChange={(e) => setBillsFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
          </label>
          <label className="block text-sm font-medium text-vf-ink">
            Bank Transactions XLSX (Xero &ldquo;Account Transactions by date&rdquo; export — may contain multiple bank accounts)
            <input type="file" accept=".xlsx" onChange={(e) => setBankTransactionsFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
          </label>
          <Button onClick={handleImport} disabled={!hasAnyFile || importing}>
            {importing ? "Importing…" : "Import"}
          </Button>
          {error && <p className="text-sm text-vf-danger">{error}</p>}
        </CardContent>
      </Card>

      {outcome && (
        <Card>
          <CardHeader>
            <CardTitle>Import Results</CardTitle>
            <CardDescription>Client Ready — review any errors/warnings below before using this company.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-vf-paper-border p-4">
              <h3 className="font-semibold text-vf-ink">Chart of Accounts</h3>
              <div className="mt-2 flex gap-2 text-xs">
                <Badge tone="good">Created {outcome.chartOfAccounts.created.length}</Badge>
                <Badge tone="warn">Corrected {outcome.chartOfAccounts.updated.length}</Badge>
                <Badge tone="muted">Unchanged {outcome.chartOfAccounts.unchanged.length}</Badge>
              </div>
            </div>
            <EntitySummary title="Contacts (Customers / Suppliers)" result={outcome.contacts} />
            <EntitySummary title="Sales Invoices" result={outcome.salesInvoices} />
            <EntitySummary title="Bills" result={outcome.bills} />
            <EntitySummary title="Bank Accounts" result={outcome.bankAccounts} />
            <EntitySummary title="Bank Transactions" result={outcome.bankTransactions} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
