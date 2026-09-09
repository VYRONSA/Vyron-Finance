"use client";

import { useUrlParam } from "@/hooks/use-url-param";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { StockItemsTab } from "./stock-items-tab";
import { WarehousesTab } from "./warehouses-tab";
import { TransactionsTab } from "./transactions-tab";
import { StockTakesTab } from "./stock-takes-tab";
import { IntelligenceTab } from "./intelligence-tab";
import { IntegrationCentreTab } from "./integration-centre-tab";
import type { VatTreatment } from "@/server/company-management/types";
import type {
  IntegrationConnection,
  InventoryTransaction,
  StockItem,
  StockTake,
  Warehouse,
} from "@/server/inventory/types";
import type { StockItemIntelligenceSignal } from "@/server/services/inventory-intelligence-service";

const TABS = ["Stock Items", "Warehouses", "Transactions", "Stock Takes", "Intelligence", "Integration Centre"] as const;
type Tab = (typeof TABS)[number];

function slugFromTab(tab: Tab): string {
  return tab.toLowerCase().replace(/\s+/g, "-");
}

function tabFromSlug(slug: string): Tab {
  const found = TABS.find((t) => slugFromTab(t) === slug);
  return found ?? "Stock Items";
}

export function InventoryTabs({
  companyId,
  previewMode,
  stockItems,
  stockItemsCapped,
  warehouses,
  transactions,
  stockTakes,
  vatTreatments,
  intelligenceSignals,
  integrationConnections,
}: {
  companyId: string;
  previewMode: boolean;
  stockItems: StockItem[];
  stockItemsCapped?: boolean;
  warehouses: Warehouse[];
  transactions: InventoryTransaction[];
  stockTakes: StockTake[];
  vatTreatments: VatTreatment[];
  intelligenceSignals: { stockCode: string; description: string; signal: StockItemIntelligenceSignal }[];
  integrationConnections: IntegrationConnection[];
}) {
  // Finding #196 (RC-5) — the active tab survives a refresh and
  // participates in Back/Forward instead of resetting on every navigation.
  const [tabSlug, setTabSlug] = useUrlParam("tab", slugFromTab("Stock Items"));
  const activeTab = tabFromSlug(tabSlug);
  const setActiveTab = (tab: Tab) => setTabSlug(slugFromTab(tab));

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
        {activeTab === "Stock Items" && (
          <StockItemsTab companyId={companyId} stockItems={stockItems} stockItemsCapped={stockItemsCapped} warehouses={warehouses} vatTreatments={vatTreatments} previewMode={previewMode} />
        )}
        {activeTab === "Warehouses" && <WarehousesTab companyId={companyId} warehouses={warehouses} previewMode={previewMode} />}
        {activeTab === "Transactions" && (
          <TransactionsTab companyId={companyId} transactions={transactions} stockItems={stockItems} warehouses={warehouses} previewMode={previewMode} />
        )}
        {activeTab === "Stock Takes" && (
          <StockTakesTab companyId={companyId} stockTakes={stockTakes} stockItems={stockItems} warehouses={warehouses} previewMode={previewMode} />
        )}
        {activeTab === "Intelligence" && <IntelligenceTab signals={intelligenceSignals} />}
        {activeTab === "Integration Centre" && <IntegrationCentreTab connections={integrationConnections} />}
      </CardContent>
    </Card>
  );
}
