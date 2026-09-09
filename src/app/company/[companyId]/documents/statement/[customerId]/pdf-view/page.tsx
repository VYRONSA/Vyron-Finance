import { notFound } from "next/navigation";
import { StatementDocumentPdfView } from "@/components/documents/statement-document-pdf-view";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getCustomerStatement } from "@/server/services/customer-matching-service";
import { getCustomer } from "@/server/services/customer-service";

/** Phase 24A — see `invoice/[invoiceId]/pdf-view/page.tsx`'s docstring;
 * the exact same reasoning applies here. Reuses `getCustomerStatement`
 * (itself `buildCustomerStatement` — the existing, pure statement
 * engine) exactly as the in-app Customer Matching workspace's own
 * "View Statement" already does — no independent recalculation.
 *
 * `getCustomerStatement` has no date-range/period parameter today — it
 * always returns the customer's full history of Posted invoices/
 * receipts (see its own docstring in `customer-statement-engine.ts`).
 * This page reflects that as-is rather than inventing period filtering
 * the existing engine doesn't support. */
export default async function StatementPdfViewPage({ params }: { params: Promise<{ companyId: string; customerId: string }> }) {
  const session = await requireSession();
  if (!session.ok) notFound();

  const { companyId, customerId } = await params;

  const check = await requirePermission(companyId, "Sales:View");
  if (!check.ok) notFound();

  const customer = await getCustomer(companyId, Number(customerId));
  if (!customer) notFound();

  const entries = await getCustomerStatement(companyId, Number(customerId));

  return (
    <StatementDocumentPdfView
      companyId={companyId}
      customer={{ id: customer.id, name: customer.name, vatNumber: customer.vatNumber, registrationNumber: customer.registrationNumber }}
      entries={entries}
    />
  );
}
