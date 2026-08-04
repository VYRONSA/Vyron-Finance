"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { VatDashboardTab } from "./vat-dashboard-tab";
import { VatTransactionsTab } from "./vat-transactions-tab";
import { VatExceptionsTab } from "./vat-exceptions-tab";
import { VatAdjustmentsTab } from "./vat-adjustments-tab";
import { VatReturnsTab } from "./vat-returns-tab";
import { VatAuditTrailTab } from "./vat-audit-trail-tab";
import { VatIntelligenceTab } from "./vat-intelligence-tab";
import { VatReportsTab } from "./vat-reports-tab";
import type { VatDashboardSummary } from "@/server/services/vat-summary-service";
import type { VatAdjustment, VatException, VatReturn } from "@/server/vat/types";
import type { VatDocument, VatIntelligenceSignal } from "@/server/vat/vat-intelligence";
import type { AutomationAuditLogEntry } from "@/server/automation/types";
import type { VatTreatment } from "@/server/company-management/types";

const TABS = ["Dashboard", "Transactions", "Exceptions", "Adjustments", "Returns", "Audit Trail", "Intelligence", "Reports"] as const;
type Tab = (typeof TABS)[number];

function tabFromSlug(slug: string | null): Tab {
  const found = TABS.find((t) => t.toLowerCase().replace(/\s+/g, "-") === slug);
  return found ?? "Dashboard";
}

export function VatTabs({
  companyId,
  summary,
  documents,
  intelligenceSignals,
  exceptions,
  adjustments,
  vatReturns,
  auditLog,
  vatTreatments,
  previewMode,
}: {
  companyId: string;
  summary: VatDashboardSummary;
  documents: VatDocument[];
  intelligenceSignals: { document: VatDocument; signal: VatIntelligenceSignal }[];
  exceptions: VatException[];
  adjustments: VatAdjustment[];
  vatReturns: VatReturn[];
  auditLog: AutomationAuditLogEntry[];
  vatTreatments: VatTreatment[];
  previewMode: boolean;
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
        {activeTab === "Dashboard" && <VatDashboardTab summary={summary} exceptions={exceptions} vatReturns={vatReturns} />}
        {activeTab === "Transactions" && <VatTransactionsTab companyId={companyId} documents={documents} />}
        {activeTab === "Exceptions" && <VatExceptionsTab companyId={companyId} exceptions={exceptions} previewMode={previewMode} />}
        {activeTab === "Adjustments" && <VatAdjustmentsTab companyId={companyId} adjustments={adjustments} vatTreatments={vatTreatments} previewMode={previewMode} />}
        {activeTab === "Returns" && <VatReturnsTab companyId={companyId} vatReturns={vatReturns} previewMode={previewMode} />}
        {activeTab === "Audit Trail" && <VatAuditTrailTab auditLog={auditLog} />}
        {activeTab === "Intelligence" && <VatIntelligenceTab companyId={companyId} signals={intelligenceSignals} previewMode={previewMode} />}
        {activeTab === "Reports" && <VatReportsTab documents={documents} vatTreatments={vatTreatments} vatReturns={vatReturns} />}
      </CardContent>
    </Card>
  );
}
