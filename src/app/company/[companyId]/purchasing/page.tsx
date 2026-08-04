import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { PurchasingTabs } from "@/components/financial/purchasing/purchasing-tabs";
import { IconBanknote, IconClock, IconFileText, IconImport, IconUsers } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { listPurchaseRequisitions } from "@/server/services/purchase-requisition-service";
import { listPurchaseOrders } from "@/server/services/purchase-order-service";
import { listGoodsReceivedNotes } from "@/server/services/goods-received-note-service";
import { listAllBills } from "@/server/services/purchase-bill-service";
import { listSupplierPayments } from "@/server/services/supplier-payment-service";
import { buildPurchasingDashboardSummary } from "@/server/services/purchasing-summary-service";
import { MOCK_SUPPLIERS, MOCK_BILLS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";
import {
  MOCK_GOODS_RECEIVED_NOTES,
  MOCK_PURCHASE_BILLS,
  MOCK_PURCHASE_ORDERS,
  MOCK_PURCHASE_REQUISITIONS,
  MOCK_SUPPLIER_PAYMENTS,
} from "@/lib/mock/purchasing-data";

export const metadata: Metadata = {
  title: "Purchasing — VYRON FINANCE",
};

export default async function PurchasingPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const [suppliers, vatTreatments, requisitions, orders, grns, bills, payments] = previewMode
    ? [
        MOCK_SUPPLIERS,
        MOCK_VAT_TREATMENTS,
        MOCK_PURCHASE_REQUISITIONS,
        MOCK_PURCHASE_ORDERS,
        MOCK_GOODS_RECEIVED_NOTES,
        [...MOCK_BILLS, ...MOCK_PURCHASE_BILLS],
        MOCK_SUPPLIER_PAYMENTS,
      ]
    : await Promise.all([
        listSuppliers(companyId),
        listVatTreatments(companyId),
        listPurchaseRequisitions(companyId),
        listPurchaseOrders(companyId),
        listGoodsReceivedNotes(companyId),
        listAllBills(companyId),
        listSupplierPayments(companyId),
      ]);

  const today = new Date().toISOString().slice(0, 10);
  const summary = buildPurchasingDashboardSummary(bills, orders, suppliers, today, payments);

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
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Purchasing</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Requisitions through to payment — every Bill, Credit Note, and Debit Note posts automatically through
              the one Posting Engine. Nothing here bypasses the General Ledger.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "purchases-today", label: "Purchases Today", value: money(summary.purchasesToday), icon: IconBanknote },
          { key: "bills-month", label: "Bills This Month", value: String(summary.billsThisMonth), icon: IconFileText },
          { key: "creditors", label: "Outstanding Creditors", value: money(summary.outstandingCreditors), icon: IconUsers },
          { key: "awaiting", label: "Orders Awaiting Approval", value: String(summary.ordersAwaitingApproval), icon: IconClock },
          { key: "payments-month", label: "Payments This Month", value: String(summary.paymentsThisMonth), icon: IconClock },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample requisitions, orders, GRNs, bills, and payments. Every action is disabled
          until Supabase is configured.
        </p>
      )}

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-vf-md" />}>
        <PurchasingTabs
          companyId={companyId}
          previewMode={previewMode}
          suppliers={suppliers}
          vatTreatments={vatTreatments}
          requisitions={requisitions}
          orders={orders}
          grns={grns}
          bills={bills}
          payments={payments}
        />
      </Suspense>
    </div>
  );
}
