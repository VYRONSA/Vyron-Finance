import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CustomerDetailTabs } from "@/components/financial/customers/customer-detail-tabs";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCustomer, listCustomerAddresses, listCustomerContacts } from "@/server/services/customer-service";
import { buildCustomerFinancialSummary, buildCustomerIntelligence, getCustomerFinancialSummary } from "@/server/services/customer-financial-service";
import { listSalesInvoicesByCustomer } from "@/server/services/sales-invoice-service";
import { MOCK_CUSTOMERS, MOCK_CUSTOMER_ADDRESSES, MOCK_CUSTOMER_CONTACTS } from "@/lib/mock/customer-management-data";
import { MOCK_CUSTOMER_RECEIPTS, MOCK_QUOTATIONS, MOCK_SALES_INVOICES, MOCK_SALES_ORDERS } from "@/lib/mock/sales-data";
import type { RiskRating } from "@/server/customer-management/types";

export const metadata: Metadata = {
  title: "Customer — VYRON FINANCE",
};

const RISK_TONE: Record<RiskRating, "good" | "warn" | "danger"> = { Low: "good", Medium: "warn", High: "danger" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ companyId: string; customerId: string }> }) {
  const { companyId, customerId } = await params;
  const previewMode = !isSupabaseConfigured();
  const id = Number(customerId);

  const customer = previewMode ? (MOCK_CUSTOMERS.find((c) => c.id === id) ?? null) : await getCustomer(companyId, id);
  if (!customer) notFound();

  const today = new Date().toISOString().slice(0, 10);

  const [contacts, addresses, invoices] = previewMode
    ? [
        MOCK_CUSTOMER_CONTACTS[id] ?? [],
        MOCK_CUSTOMER_ADDRESSES[id] ?? [],
        MOCK_SALES_INVOICES.filter((i) => i.customerId === id),
      ]
    : await Promise.all([listCustomerContacts(id), listCustomerAddresses(id), listSalesInvoicesByCustomer(companyId, id)]);

  const financialSummary = previewMode
    ? buildCustomerFinancialSummary(
        customer,
        invoices,
        MOCK_CUSTOMER_RECEIPTS.filter((r) => r.customerId === id),
        MOCK_QUOTATIONS,
        MOCK_SALES_ORDERS,
        today,
      )
    : await getCustomerFinancialSummary(companyId, customer);

  const intelligence = buildCustomerIntelligence(customer, invoices, today);

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
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
                {customer.customerCode} · {customer.customerType}
              </span>
              <Badge tone={customer.isActive ? "good" : "muted"}>{customer.isActive ? "Active" : "Inactive"}</Badge>
              <Badge tone={RISK_TONE[customer.riskRating]}>{customer.riskRating} Risk</Badge>
            </div>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">{customer.name}</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              {customer.customerGroup || "No group"} · {customer.industry || "No industry set"}
            </p>
          </div>
        </CardContent>
      </Card>

      <CustomerDetailTabs
        companyId={companyId}
        customer={customer}
        contacts={contacts}
        addresses={addresses}
        financialSummary={financialSummary}
        intelligence={intelligence}
        invoices={invoices}
        previewMode={previewMode}
      />
    </div>
  );
}
