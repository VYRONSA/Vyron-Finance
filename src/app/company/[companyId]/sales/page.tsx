import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { SalesTabs } from "@/components/financial/sales/sales-tabs";
import { IconBanknote, IconClock, IconFileText, IconImport, IconUsers } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listCustomers } from "@/server/services/customer-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { listQuotations } from "@/server/services/quotation-service";
import { listSalesOrders } from "@/server/services/sales-order-service";
import { listDeliveries } from "@/server/services/delivery-service";
import { listSalesInvoices } from "@/server/services/sales-invoice-service";
import { listCustomerReceipts } from "@/server/services/customer-receipt-service";
import { buildSalesDashboardSummary } from "@/server/services/sales-summary-service";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";
import { MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";
import { MOCK_CUSTOMER_RECEIPTS, MOCK_DELIVERIES, MOCK_QUOTATIONS, MOCK_SALES_INVOICES, MOCK_SALES_ORDERS } from "@/lib/mock/sales-data";

export const metadata: Metadata = {
  title: "Sales — VYRON FINANCE",
};

export default async function SalesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const [customers, vatTreatments, quotations, orders, deliveries, invoices, receipts] = previewMode
    ? [MOCK_CUSTOMERS, MOCK_VAT_TREATMENTS, MOCK_QUOTATIONS, MOCK_SALES_ORDERS, MOCK_DELIVERIES, MOCK_SALES_INVOICES, MOCK_CUSTOMER_RECEIPTS]
    : await Promise.all([
        listCustomers(companyId),
        listVatTreatments(companyId),
        listQuotations(companyId),
        listSalesOrders(companyId),
        listDeliveries(companyId),
        listSalesInvoices(companyId),
        listCustomerReceipts(companyId),
      ]);

  const today = new Date().toISOString().slice(0, 10);
  const summary = buildSalesDashboardSummary(invoices, orders, customers, today);

  function money(value: number): string {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

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
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
              Commercial Platform
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Sales</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Quotations through to cash — every Invoice, Credit Note, and Debit Note posts automatically through the
              one Posting Engine. Nothing here bypasses the General Ledger.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "sales-today", label: "Sales Today", value: money(summary.salesToday), icon: IconBanknote },
          { key: "invoices-month", label: "Invoices This Month", value: String(summary.invoicesThisMonth), icon: IconFileText },
          { key: "debtors", label: "Outstanding Debtors", value: money(summary.outstandingDebtors), icon: IconUsers },
          { key: "open-orders", label: "Open Orders", value: String(summary.openOrders), icon: IconClock },
          { key: "awaiting", label: "Awaiting Approval", value: String(summary.awaitingApproval), icon: IconClock },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample quotations, orders, deliveries, invoices, and receipts. Every action is
          disabled until Supabase is configured.
        </p>
      )}

      <SalesTabs
        companyId={companyId}
        previewMode={previewMode}
        customers={customers}
        vatTreatments={vatTreatments}
        quotations={quotations}
        orders={orders}
        deliveries={deliveries}
        invoices={invoices}
        receipts={receipts}
      />
    </div>
  );
}
