"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { QuotationsTab } from "./quotations-tab";
import { SalesOrdersTab } from "./sales-orders-tab";
import { DeliveriesTab } from "./deliveries-tab";
import { InvoicesTab } from "./invoices-tab";
import { ReceiptsTab } from "./receipts-tab";
import type { Customer } from "@/server/customer-management/types";
import type { VatTreatment } from "@/server/company-management/types";
import type { CustomerReceipt, Delivery, Quotation, SalesInvoice, SalesOrder } from "@/server/sales/types";

const TABS = ["Quotations", "Sales Orders", "Deliveries", "Invoices", "Receipts"] as const;
type Tab = (typeof TABS)[number];

function tabFromSlug(slug: string | null): Tab {
  const found = TABS.find((t) => t.toLowerCase().replace(/\s+/g, "-") === slug);
  return found ?? "Quotations";
}

export function SalesTabs({
  companyId,
  previewMode,
  customers,
  vatTreatments,
  quotations,
  orders,
  deliveries,
  invoices,
  receipts,
}: {
  companyId: string;
  previewMode: boolean;
  customers: Customer[];
  vatTreatments: VatTreatment[];
  quotations: Quotation[];
  orders: SalesOrder[];
  deliveries: Delivery[];
  invoices: SalesInvoice[];
  receipts: CustomerReceipt[];
}) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => tabFromSlug(searchParams.get("tab")));

  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-vf-paper-border px-4 pt-3">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
            className={cn(
              "rounded-t-lg px-3.5 py-2 text-sm font-medium transition",
              activeTab === tab ? "border-b-2 border-vf-red-600 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <CardContent className="pt-5">
        {activeTab === "Quotations" && <QuotationsTab companyId={companyId} quotations={quotations} customers={customers} previewMode={previewMode} />}
        {activeTab === "Sales Orders" && (
          <SalesOrdersTab companyId={companyId} orders={orders} customers={customers} vatTreatments={vatTreatments} previewMode={previewMode} />
        )}
        {activeTab === "Deliveries" && <DeliveriesTab companyId={companyId} deliveries={deliveries} customers={customers} orders={orders} previewMode={previewMode} />}
        {activeTab === "Invoices" && (
          <InvoicesTab companyId={companyId} invoices={invoices} customers={customers} vatTreatments={vatTreatments} previewMode={previewMode} />
        )}
        {activeTab === "Receipts" && <ReceiptsTab companyId={companyId} receipts={receipts} customers={customers} invoices={invoices} previewMode={previewMode} />}
      </CardContent>
    </Card>
  );
}
