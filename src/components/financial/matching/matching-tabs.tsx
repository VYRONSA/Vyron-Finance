"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { MatchingDashboardTab } from "./matching-dashboard-tab";
import { ReviewQueueTab } from "./review-queue-tab";
import { MerchantMatchingTab } from "./merchant-matching-tab";
import { DuplicateDetectionTab } from "./duplicate-detection-tab";
import { CustomerMatchingTab } from "./customer-matching-tab";
import { SupplierMatchingTab } from "./supplier-matching-tab";
import type { MatchingSummary } from "@/server/services/matching-summary-service";
import type { MatchingQueueItem } from "@/server/services/matching-queue-service";
import type { Merchant } from "@/server/banking-rules/types";
import type { CustomerMatchingWorkspaceData } from "@/server/services/customer-matching-service";
import type { SupplierMatchingWorkspaceData } from "@/server/services/supplier-matching-service";
import type { DuplicateFinding } from "@/server/services/duplicate-detection-service";

const TABS = ["Dashboard", "Review Queue", "Customer Matching", "Supplier Matching", "Merchant Matching", "Duplicate Detection"] as const;
type Tab = (typeof TABS)[number];

function tabFromSlug(slug: string | null): Tab {
  const found = TABS.find((t) => t.toLowerCase().replace(/\s+/g, "-") === slug);
  return found ?? "Dashboard";
}

export function MatchingTabs({
  companyId,
  summary,
  queue,
  merchants,
  duplicateFindings,
  customerMatching,
  supplierMatching,
  previewMode,
}: {
  companyId: string;
  summary: MatchingSummary;
  queue: MatchingQueueItem[];
  merchants: Merchant[];
  duplicateFindings: DuplicateFinding[];
  customerMatching: CustomerMatchingWorkspaceData;
  supplierMatching: SupplierMatchingWorkspaceData;
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
        {activeTab === "Dashboard" && <MatchingDashboardTab summary={summary} queue={queue} />}
        {activeTab === "Review Queue" && <ReviewQueueTab companyId={companyId} queue={queue} previewMode={previewMode} />}
        {activeTab === "Customer Matching" && <CustomerMatchingTab companyId={companyId} data={customerMatching} previewMode={previewMode} />}
        {activeTab === "Supplier Matching" && <SupplierMatchingTab companyId={companyId} data={supplierMatching} previewMode={previewMode} />}
        {activeTab === "Merchant Matching" && <MerchantMatchingTab companyId={companyId} merchants={merchants} previewMode={previewMode} />}
        {activeTab === "Duplicate Detection" && <DuplicateDetectionTab companyId={companyId} initialFindings={duplicateFindings} previewMode={previewMode} />}
      </CardContent>
    </Card>
  );
}
