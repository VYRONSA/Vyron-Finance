import type { Metadata } from "next";
import { XeroImportPanel } from "@/components/financial/xero-import/xero-import-panel";

export const metadata: Metadata = {
  title: "Xero Migration — VYRON FINANCE",
};

/**
 * Xero Client Import — the guided entry point for migrating a client
 * from Xero into an existing VYRON company (create the company first via
 * the normal Company Creation flow, then land here). Distinct from
 * Import Centre's own single-shot Bills/Bank Statement uploads: this
 * runs the FULL migration (Contacts, Sales Invoices, Bills, Bank
 * Transactions, Chart of Accounts) in one pass via
 * `xero-import-service.ts::runXeroImport`.
 */
export default async function XeroImportPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-vf-ink">Xero Migration</h1>
        <p className="text-sm text-vf-ink-soft">Import a client&apos;s Contacts, Sales Invoices, Bills, and Bank Transactions directly from their Xero export.</p>
      </div>
      <XeroImportPanel companyId={companyId} />
    </div>
  );
}
