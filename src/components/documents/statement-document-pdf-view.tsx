"use client";

import { StatementDocument, type StatementCustomer } from "./statement-document";
import type { StatementEntry } from "@/server/matching/customer-statement-engine";

/** Phase 24A — see `invoice-document-pdf-view.tsx`'s docstring; the exact
 * same reasoning applies here, for `StatementDocument`. */
export function StatementDocumentPdfView({ companyId, customer, entries }: { companyId: string; customer: StatementCustomer; entries: StatementEntry[] }) {
  return <StatementDocument companyId={companyId} customer={customer} entries={entries} open onClose={() => {}} />;
}
