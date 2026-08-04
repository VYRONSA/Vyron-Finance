/**
 * Pure Disclosure Engine — no Supabase. Every builder takes data the
 * caller already fetched from an EXISTING service (Asset Dashboard
 * Summary, Inventory Dashboard Summary, VAT Dashboard Summary, Income
 * Statement) — nothing here recomputes a figure another module already
 * owns. "Use real data wherever available and clearly identify sections
 * that require user completion where no source data exists" — every
 * note returns both `facts` (real, computed) and `placeholders` (an
 * honest, labeled prompt for what a preparer must still supply); a note
 * `requiresUserInput` whenever it has at least one placeholder.
 *
 * Three note types (`RelatedPartyTransactions`/
 * `CommitmentsAndContingencies`/`EventsAfterReportingDate`) have no data
 * source anywhere in this codebase and are pure placeholders by
 * construction — not a gap in this engine, a real gap in what the
 * platform tracks today, disclosed rather than fabricated.
 */

import type { IncomeStatement } from "@/server/reporting/income-statement-engine";
import type { AssetDashboardSummary } from "@/server/services/asset-dashboard-summary-service";
import type { InventoryDashboardSummary } from "@/server/services/inventory-summary-service";
import type { VatDashboardSummary } from "@/server/services/vat-summary-service";
import type { FixedAsset } from "@/server/assets/types";
import type { VatReturn } from "@/server/vat/types";
import type { DisclosureNoteType } from "./types";

export type DisclosureNoteContent = { facts: string[]; placeholders: string[] };
export type DisclosureNoteResult = { noteType: DisclosureNoteType; title: string; content: DisclosureNoteContent; requiresUserInput: boolean };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function result(noteType: DisclosureNoteType, title: string, content: DisclosureNoteContent): DisclosureNoteResult {
  return { noteType, title, content, requiresUserInput: content.placeholders.length > 0 };
}

/** Real facts derived from what the platform actually has configured
 * (depreciation methods in use, inventory costing method, VAT basis) —
 * the narrative wording around them (basis of preparation, going
 * concern) is a genuine preparer judgement and stays a placeholder. */
export function buildAccountingPoliciesNote(depreciationMethodsInUse: string[], vatTreatmentBasisInUse: string[]): DisclosureNoteResult {
  const facts: string[] = ["Inventory is valued using the FIFO (first-in, first-out) costing method, applied consistently by the platform's Inventory costing engine."];
  if (depreciationMethodsInUse.length > 0) {
    facts.push(`Property, plant and equipment is depreciated using the following method(s), per the Fixed Asset Register: ${depreciationMethodsInUse.join(", ")}.`);
  }
  if (vatTreatmentBasisInUse.length > 0) {
    facts.push(`VAT is accounted for on the following basis, per the configured VAT treatments: ${vatTreatmentBasisInUse.join(", ")}.`);
  }
  const placeholders = [
    "Basis of preparation (e.g. IFRS for SMEs, historical cost convention) — confirm and complete.",
    "Going concern statement — confirm and complete.",
    "Any additional significant accounting policies not listed above — add as required.",
  ];
  return result("AccountingPolicies", "Accounting Policies", { facts, placeholders });
}

export function buildSignificantJudgementsNote(): DisclosureNoteResult {
  return result("SignificantJudgements", "Significant Judgements", {
    facts: [],
    placeholders: ["Significant judgements made by management in applying accounting policies this period — no such data source exists in this platform; describe any material judgement calls manually."],
  });
}

/** One real fact where a source exists (the useful-life range actually
 * configured across active assets); the rest of what a formal Estimates
 * note would cover (bad debt allowance, warranty provisions) has no
 * data source and stays a placeholder. */
export function buildEstimatesNote(activeAssetUsefulLifeMonths: number[]): DisclosureNoteResult {
  const facts: string[] = [];
  if (activeAssetUsefulLifeMonths.length > 0) {
    const min = Math.min(...activeAssetUsefulLifeMonths);
    const max = Math.max(...activeAssetUsefulLifeMonths);
    facts.push(`Depreciation is based on estimated useful lives ranging from ${min} to ${max} months across active fixed assets, per the Asset Register.`);
  }
  return result("Estimates", "Estimates", {
    facts,
    placeholders: ["Other significant estimates (e.g. impairment allowances, provisions) — no such data source exists in this platform yet; describe manually if applicable."],
  });
}

export function buildFixedAssetNotes(assets: FixedAsset[], assetSummary: AssetDashboardSummary): DisclosureNoteResult {
  const activeAssets = assets.filter((a) => a.status !== "WrittenOff");
  const byMethod = new Map<string, { count: number; cost: number }>();
  for (const asset of activeAssets) {
    const bucket = byMethod.get(asset.depreciationMethod) ?? { count: 0, cost: 0 };
    bucket.count += 1;
    bucket.cost = round2(bucket.cost + asset.cost);
    byMethod.set(asset.depreciationMethod, bucket);
  }
  const facts = [
    `Total cost of property, plant and equipment: ${assetSummary.totalAssetValue}.`,
    `Accumulated depreciation and impairment reduce this to a net book value of: ${assetSummary.netBookValue}.`,
    `Depreciation charged for the most recent posted month: ${assetSummary.depreciationThisMonth}.`,
    `${activeAssets.length} active asset(s) on the Register.`,
    ...[...byMethod.entries()].map(([method, b]) => `${b.count} asset(s) depreciated on the ${method} method, total cost ${b.cost}.`),
  ];
  const placeholders: string[] = [];
  if (assetSummary.impairmentAlertCount > 0) placeholders.push(`${assetSummary.impairmentAlertCount} open Impairment Indicator finding(s) exist in Asset Intelligence — confirm whether a formal impairment charge is required.`);
  return result("FixedAssetNotes", "Property, Plant and Equipment", { facts, placeholders });
}

export function buildInventoryNotes(inventorySummary: InventoryDashboardSummary): DisclosureNoteResult {
  const facts = [
    `Inventory is valued using the FIFO costing method.`,
    `Inventory value at period end: ${inventorySummary.inventoryValue}, across ${inventorySummary.stockOnHandUnits} unit(s) on hand and ${inventorySummary.activeItemCount} active item(s).`,
    `${inventorySummary.lowStockCount} item(s) below reorder level, ${inventorySummary.outOfStockCount} out of stock.`,
  ];
  const placeholders: string[] = [];
  if (inventorySummary.deadStockCount > 0) placeholders.push(`${inventorySummary.deadStockCount} dead-stock item(s) identified (no movement in 180+ days) — confirm whether a net realisable value write-down is required.`);
  return result("InventoryNotes", "Inventory", { facts, placeholders });
}

export function buildVatNotes(vatSummary: VatDashboardSummary, latestVatReturn: VatReturn | null): DisclosureNoteResult {
  const facts = [`VAT payable at period end: ${vatSummary.vatPayable}.`, `VAT Compliance Score: ${vatSummary.complianceScorePercent}%.`];
  if (latestVatReturn) facts.push(`Latest VAT return: ${latestVatReturn.periodStart} to ${latestVatReturn.periodEnd}, status ${latestVatReturn.status}, net payable ${latestVatReturn.netPayable}.`);
  const placeholders: string[] = [];
  if (vatSummary.openExceptionCount > 0) placeholders.push(`${vatSummary.openExceptionCount} open VAT exception(s) in the VAT Exception Centre — resolve or disclose before finalising.`);
  return result("VatNotes", "Value Added Tax", { facts, placeholders });
}

export function buildRevenueNotes(incomeStatement: IncomeStatement): DisclosureNoteResult {
  const facts = [
    `Total revenue for the period: ${incomeStatement.revenue.total}.`,
    ...incomeStatement.revenue.lines.map((l) => `${l.accountCode} — ${l.description}: ${l.amount}.`),
  ];
  return result("RevenueNotes", "Revenue", {
    facts,
    placeholders: ["Disaggregation of revenue by performance-obligation timing (point-in-time vs over-time, per IFRS 15) — no such classification exists in this platform yet; complete manually if required."],
  });
}

export function buildExpenseNotes(incomeStatement: IncomeStatement): DisclosureNoteResult {
  const facts = [
    `Cost of Sales for the period: ${incomeStatement.costOfSales.total}.`,
    `Operating Expenses for the period: ${incomeStatement.operatingExpenses.total}.`,
    ...incomeStatement.operatingExpenses.lines.slice(0, 10).map((l) => `${l.accountCode} — ${l.description}: ${l.amount}.`),
  ];
  return result("ExpenseNotes", "Expenses", {
    facts,
    placeholders: ["Employee costs breakdown — no Payroll module exists in this platform yet; complete manually if required."],
  });
}

export function buildRelatedPartyNote(): DisclosureNoteResult {
  return result("RelatedPartyTransactions", "Related Party Transactions", {
    facts: [],
    placeholders: ["No related-party transaction tracking exists in this platform yet — list any related-party transactions (e.g. director loans, intercompany balances) manually."],
  });
}

export function buildCommitmentsAndContingenciesNote(): DisclosureNoteResult {
  return result("CommitmentsAndContingencies", "Commitments and Contingencies", {
    facts: [],
    placeholders: ["No commitments/contingencies tracking exists in this platform yet — list any capital commitments, operating lease commitments, guarantees, or contingent liabilities manually."],
  });
}

export function buildEventsAfterReportingDateNote(periodEnd: string): DisclosureNoteResult {
  return result("EventsAfterReportingDate", "Events After the Reporting Date", {
    facts: [],
    placeholders: [`No automated tracking of post-period events exists — describe any material event occurring after ${periodEnd} and before these statements are authorised for issue.`],
  });
}
