"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { CaptureTab } from "./capture-tab";
import { CashbookLedgerTab } from "./cashbook-ledger-tab";
import { BatchesTab } from "./batches-tab";
import { ReconciliationTab } from "./reconciliation-tab";
import { EnquiryTab } from "./enquiry-tab";
import { useUrlParam } from "@/hooks/use-url-param";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { BankReconciliation, CashbookBatch } from "@/server/banking/types";
import type { ReconciliationSummary } from "@/server/banking/reconciliation-engine";
import type { ChartOfAccount } from "@/server/general-ledger/types";

const TABS = ["Capture", "Receipts Cashbook", "Payments Cashbook", "Batches", "Reconciliation", "Enquiry"] as const;
type Tab = (typeof TABS)[number];

function slugFromTab(tab: Tab): string {
  return tab.toLowerCase().replace(/\s+/g, "-");
}

function tabFromSlug(slug: string): Tab {
  const found = TABS.find((t) => slugFromTab(t) === slug);
  return found ?? "Capture";
}

export function CashbookTabs({
  companyId,
  entries,
  bankAccounts,
  batches,
  reconciliations,
  activeReconciliation,
  activeSummary,
  chartOfAccounts,
  previewMode,
  entriesCapped,
}: {
  companyId: string;
  entries: BankTransactionRecord[];
  bankAccounts: { id: number; accountName: string; currency: string }[];
  batches: CashbookBatch[];
  reconciliations: BankReconciliation[];
  activeReconciliation: BankReconciliation | null;
  activeSummary: ReconciliationSummary | null;
  chartOfAccounts: ChartOfAccount[];
  previewMode: boolean;
  entriesCapped?: boolean;
}) {
  // Finding #142 (RC-5) — the active tab survives a refresh and
  // participates in Back/Forward instead of resetting to Capture.
  const [tabSlug, setTabSlug] = useUrlParam("tab", slugFromTab("Capture"));
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
        {activeTab === "Capture" && <CaptureTab companyId={companyId} entries={entries} bankAccounts={bankAccounts} chartOfAccounts={chartOfAccounts} previewMode={previewMode} />}
        {activeTab === "Receipts Cashbook" && <CashbookLedgerTab title="Receipts Cashbook" direction="credit" entries={entries} bankAccounts={bankAccounts} entriesCapped={entriesCapped} />}
        {activeTab === "Payments Cashbook" && <CashbookLedgerTab title="Payments Cashbook" direction="debit" entries={entries} bankAccounts={bankAccounts} entriesCapped={entriesCapped} />}
        {activeTab === "Batches" && <BatchesTab companyId={companyId} batches={batches} previewMode={previewMode} />}
        {activeTab === "Reconciliation" && (
          <ReconciliationTab
            companyId={companyId}
            bankAccounts={bankAccounts}
            reconciliations={reconciliations}
            activeReconciliation={activeReconciliation}
            activeSummary={activeSummary}
            previewMode={previewMode}
          />
        )}
        {activeTab === "Enquiry" && <EnquiryTab companyId={companyId} entries={entries} bankAccounts={bankAccounts} entriesCapped={entriesCapped} />}
      </CardContent>
    </Card>
  );
}
