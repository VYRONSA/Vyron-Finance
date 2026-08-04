import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { InventoryTabs } from "@/components/financial/inventory/inventory-tabs";
import { IconAlertTriangle, IconArchive, IconBanknote, IconImport } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listWarehouses } from "@/server/services/warehouse-service";
import { listStockItems } from "@/server/services/stock-item-service";
import { listInventoryTransactions } from "@/server/services/inventory-transaction-service";
import { listStockTakes } from "@/server/services/stock-take-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { listIntegrationConnections } from "@/server/services/integration-service";
import { buildInventoryDashboardSummary } from "@/server/services/inventory-summary-service";
import { buildStockItemIntelligence } from "@/server/services/inventory-intelligence-service";
import { listCostLayers } from "@/server/repositories/stock-cost-layer-repository";
import {
  MOCK_INTEGRATION_CONNECTIONS,
  MOCK_INVENTORY_TRANSACTIONS,
  MOCK_STOCK_ITEMS,
  MOCK_STOCK_TAKES,
  MOCK_WAREHOUSES,
} from "@/lib/mock/inventory-data";
import { MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";

export const metadata: Metadata = {
  title: "Inventory — VYRON FINANCE",
};

export default async function InventoryPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const [warehouses, stockItems, transactions, stockTakes, vatTreatments, integrationConnections] = previewMode
    ? [MOCK_WAREHOUSES, MOCK_STOCK_ITEMS, MOCK_INVENTORY_TRANSACTIONS, MOCK_STOCK_TAKES, MOCK_VAT_TREATMENTS, MOCK_INTEGRATION_CONNECTIONS]
    : await Promise.all([
        listWarehouses(companyId),
        listStockItems(companyId),
        listInventoryTransactions(companyId),
        listStockTakes(companyId),
        listVatTreatments(companyId),
        listIntegrationConnections(companyId),
      ]);

  const today = new Date().toISOString().slice(0, 10);
  const summary = buildInventoryDashboardSummary(stockItems, transactions, today);

  const oldestLayerDateByItem = previewMode
    ? new Map<number, string | null>()
    : new Map(
        await Promise.all(
          stockItems.map(async (item): Promise<[number, string | null]> => {
            const layers = await listCostLayers(companyId, item.id);
            const oldest = layers.length > 0 ? [...layers].sort((a, b) => (a.receivedDate < b.receivedDate ? -1 : 1))[0].receivedDate : null;
            return [item.id, oldest];
          }),
        ),
      );

  const intelligenceSignals = stockItems.flatMap((item) =>
    buildStockItemIntelligence(item, transactions, today, oldestLayerDateByItem.get(item.id) ?? null).map((signal) => ({
      stockCode: item.stockCode,
      description: item.description,
      signal,
    })),
  );

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
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Inventory</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Real FIFO costing, automatic stock movements from Sales and Purchasing, and the Posting Engine for
              every Goods Received, Issue, Return, and Adjustment. Manufacturing stays with VYRON COST.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "inventory-value", label: "Inventory Value", value: money(summary.inventoryValue), icon: IconBanknote },
          { key: "stock-on-hand", label: "Stock on Hand (Units)", value: String(summary.stockOnHandUnits), icon: IconArchive },
          { key: "low-stock", label: "Low Stock", value: String(summary.lowStockCount), icon: IconAlertTriangle },
          { key: "out-of-stock", label: "Out of Stock", value: String(summary.outOfStockCount), icon: IconAlertTriangle },
          { key: "reorder-alerts", label: "Reorder Alerts", value: String(summary.reorderAlertCount), icon: IconAlertTriangle },
          { key: "dead-stock", label: "Dead Stock", value: String(summary.deadStockCount), icon: IconAlertTriangle },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample stock items, warehouses, and movements. Every action is disabled until
          Supabase is configured.
        </p>
      )}

      <InventoryTabs
        companyId={companyId}
        previewMode={previewMode}
        stockItems={stockItems}
        warehouses={warehouses}
        transactions={transactions}
        stockTakes={stockTakes}
        vatTreatments={vatTreatments}
        intelligenceSignals={intelligenceSignals}
        integrationConnections={integrationConnections}
      />
    </div>
  );
}
