"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { RequisitionsTab } from "./requisitions-tab";
import { PurchaseOrdersTab } from "./purchase-orders-tab";
import { GrnsTab } from "./grns-tab";
import { BillsTab } from "./bills-tab";
import { PaymentsTab } from "./payments-tab";
import type { ImportedBill, Supplier } from "@/server/accounting/types";
import type { CostCentre, Department, Project, VatTreatment } from "@/server/company-management/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { GoodsReceivedNote, PurchaseOrder, PurchaseRequisition, SupplierPayment } from "@/server/purchasing/types";

const TABS = ["Requisitions", "Purchase Orders", "GRNs", "Bills", "Payments"] as const;
type Tab = (typeof TABS)[number];

function tabFromSlug(slug: string | null): Tab {
  const found = TABS.find((t) => t.toLowerCase().replace(/\s+/g, "-") === slug);
  return found ?? "Requisitions";
}

export function PurchasingTabs({
  companyId,
  previewMode,
  suppliers,
  vatTreatments,
  requisitions,
  orders,
  grns,
  bills,
  payments,
  chartOfAccounts,
  costCentres,
  projects,
  departments,
}: {
  companyId: string;
  previewMode: boolean;
  suppliers: Supplier[];
  vatTreatments: VatTreatment[];
  requisitions: PurchaseRequisition[];
  orders: PurchaseOrder[];
  grns: GoodsReceivedNote[];
  bills: ImportedBill[];
  payments: SupplierPayment[];
  chartOfAccounts: ChartOfAccount[];
  costCentres: CostCentre[];
  projects: Project[];
  departments: Department[];
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
        {activeTab === "Requisitions" && <RequisitionsTab companyId={companyId} requisitions={requisitions} suppliers={suppliers} previewMode={previewMode} />}
        {activeTab === "Purchase Orders" && (
          <PurchaseOrdersTab
            companyId={companyId}
            orders={orders}
            suppliers={suppliers}
            vatTreatments={vatTreatments}
            chartOfAccounts={chartOfAccounts}
            costCentres={costCentres}
            projects={projects}
            departments={departments}
            previewMode={previewMode}
          />
        )}
        {activeTab === "GRNs" && <GrnsTab companyId={companyId} grns={grns} suppliers={suppliers} orders={orders} previewMode={previewMode} />}
        {activeTab === "Bills" && (
          <BillsTab
            companyId={companyId}
            bills={bills}
            suppliers={suppliers}
            vatTreatments={vatTreatments}
            chartOfAccounts={chartOfAccounts}
            costCentres={costCentres}
            projects={projects}
            departments={departments}
            previewMode={previewMode}
          />
        )}
        {activeTab === "Payments" && <PaymentsTab companyId={companyId} payments={payments} suppliers={suppliers} bills={bills} previewMode={previewMode} />}
      </CardContent>
    </Card>
  );
}
