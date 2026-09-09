/**
 * Application Service for the Disclosure Engine — fetches real data from
 * EXISTING services (Asset Register/Intelligence, Inventory Summary, VAT
 * Treatments/Returns/Summary, Income Statement) and hands it to the pure
 * builders in `disclosure-engine.ts`, then persists each note. Every
 * note type's real data source is read once here; nothing is
 * recalculated.
 */

import { listFixedAssets } from "@/server/services/asset-register-service";
import { listAssetFindings } from "@/server/services/asset-intelligence-service";
import { buildAssetDashboardSummary } from "@/server/services/asset-dashboard-summary-service";
import { listDepreciationRuns } from "@/server/services/depreciation-run-service";
import { listStockItems } from "@/server/services/stock-item-service";
import { listInventoryTransactions } from "@/server/services/inventory-transaction-service";
import { buildInventoryDashboardSummary } from "@/server/services/inventory-summary-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { listVatReturns } from "@/server/services/vat-return-service";
import { listVatExceptions } from "@/server/services/vat-exception-service";
import { buildVatDashboardSummary } from "@/server/services/vat-summary-service";
import { getIncomeStatement } from "@/server/services/financial-statements-service";
import {
  buildAccountingPoliciesNote,
  buildCommitmentsAndContingenciesNote,
  buildEstimatesNote,
  buildEventsAfterReportingDateNote,
  buildExpenseNotes,
  buildFixedAssetNotes,
  buildInventoryNotes,
  buildRelatedPartyNote,
  buildRevenueNotes,
  buildSignificantJudgementsNote,
  buildVatNotes,
  type DisclosureNoteResult,
} from "@/server/disclosures/disclosure-engine";
import * as repo from "@/server/repositories/disclosure-note-repository";
import type { DisclosureNote } from "@/server/disclosures/types";

export const listDisclosureNotes = repo.listDisclosureNotes;
export const updateDisclosureNoteUserNotes = repo.updateDisclosureNoteUserNotes;

/** Runs every Disclosure Engine builder against real, freshly fetched
 * data and upserts each result — one row per note type per period,
 * preserving any existing `user_notes` (see the repository). */
export async function generateDisclosureNotes(companyId: string, periodStart: string, periodEnd: string, financialYearStartDate: string, generatedBy = "System"): Promise<DisclosureNote[]> {
  const [assets, openAssetFindings, depreciationRuns, stockItems, inventoryTransactions, vatTreatments, vatReturns, openVatExceptions, incomeStatement] = await Promise.all([
    listFixedAssets(companyId),
    listAssetFindings(companyId, { status: "Open" }),
    listDepreciationRuns(companyId),
    listStockItems(companyId),
    listInventoryTransactions(companyId),
    listVatTreatments(companyId),
    listVatReturns(companyId),
    listVatExceptions(companyId, "Open"),
    getIncomeStatement(companyId, periodStart, periodEnd),
  ]);

  const latestPostedRun = [...depreciationRuns].filter((r) => r.status === "Posted").sort((a, b) => (a.runDate < b.runDate ? 1 : -1))[0] ?? null;
  const assetSummary = buildAssetDashboardSummary(assets, openAssetFindings, latestPostedRun?.totalAmount ?? 0);
  const inventorySummary = buildInventoryDashboardSummary(stockItems, inventoryTransactions, periodEnd);
  const latestVatReturn = [...vatReturns].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0] ?? null;
  const vatSummary = buildVatDashboardSummary(latestVatReturn, vatReturns, openVatExceptions, 0);

  const activeAssets = assets.filter((a) => a.status !== "WrittenOff");
  const depreciationMethodsInUse = [...new Set(activeAssets.map((a) => a.depreciationMethod))];
  const vatTypesInUse = [...new Set(vatTreatments.filter((t) => t.isActive).map((t) => t.vatType))];
  const usefulLifeMonths = activeAssets.map((a) => a.usefulLifeMonths);

  const results: DisclosureNoteResult[] = [
    buildAccountingPoliciesNote(depreciationMethodsInUse, vatTypesInUse),
    buildSignificantJudgementsNote(),
    buildEstimatesNote(usefulLifeMonths),
    buildFixedAssetNotes(assets, assetSummary),
    buildInventoryNotes(inventorySummary),
    buildVatNotes(vatSummary, latestVatReturn),
    buildRevenueNotes(incomeStatement),
    buildExpenseNotes(incomeStatement),
    buildRelatedPartyNote(),
    buildCommitmentsAndContingenciesNote(),
    buildEventsAfterReportingDateNote(periodEnd),
  ];

  return Promise.all(
    results.map((r) =>
      repo.upsertGeneratedDisclosureNote(companyId, {
        noteType: r.noteType,
        periodStart,
        periodEnd,
        title: r.title,
        generatedContent: r.content,
        requiresUserInput: r.requiresUserInput,
        generatedBy,
      }),
    ),
  );
}
