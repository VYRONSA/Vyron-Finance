import { BillingInvoicesTab } from "@/components/financial/billing/billing-invoices-tab";
import type { BillingCredit, Invoice, InvoiceLine, Payment } from "@/server/billing-platform/types";

/** Platform-wide reuse of the Customer Portal's own invoices/payments/
 * credits table — same real data, same component, no second
 * implementation. The only difference here is scope: every billing
 * account's rows, not one company's. */
export function ConsolePaymentsTab({
  invoices,
  invoiceLinesById,
  payments,
  credits,
}: {
  invoices: Invoice[];
  invoiceLinesById?: Record<string, InvoiceLine[]>;
  payments: Payment[];
  credits: BillingCredit[];
}) {
  return <BillingInvoicesTab invoices={invoices} invoiceLinesById={invoiceLinesById} payments={payments} credits={credits} />;
}
