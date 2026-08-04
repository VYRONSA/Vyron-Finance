/**
 * Application Service for What-If Scenarios — fetches real baseline
 * figures from `financial-statements-service.ts` (and, for Asset
 * Replacement, the real asset from `asset-register-service.ts`), hands
 * them to the pure simulators in `scenario-engine.ts`, and persists the
 * scenario's inputs/outputs. Never touches a live accounting table —
 * the simulators are pure and `copilot_scenarios` is a read-only record
 * of what was modeled.
 */

import { getIncomeStatement, getCashFlowStatement } from "@/server/services/financial-statements-service";
import { getFixedAsset, withNetBookValue } from "@/server/services/asset-register-service";
import { computeMonthlyDepreciationAmount } from "@/server/assets/depreciation-engine";
import {
  simulateAssetReplacement,
  simulateHiring,
  simulateOpexReduction,
  simulateReceiptDelay,
  simulateSalesIncrease,
  simulateSupplierPriceIncrease,
  type ScenarioImpact,
  type ScenarioIncomeBaseline,
} from "@/server/copilot/scenario-engine";
import * as repo from "@/server/repositories/copilot-scenario-repository";
import type { CopilotScenario, ScenarioType } from "@/server/copilot/types";

export class ValidationError extends Error {}

export const listCopilotScenarios = repo.listCopilotScenarios;
export const deleteCopilotScenario = repo.deleteCopilotScenario;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type ScenarioParameters = {
  percent?: number;
  delayDays?: number;
  averageDailyReceipts?: number;
  assetId?: number;
  newAssetCost?: number;
  newAssetResidualValue?: number;
  newAssetUsefulLifeMonths?: number;
  annualSalaryCost?: number;
};

export async function runScenario(
  companyId: string,
  performedBy: string,
  name: string,
  scenarioType: ScenarioType,
  parameters: ScenarioParameters,
  periodStart: string,
  periodEnd: string,
): Promise<CopilotScenario> {
  if (!name?.trim()) throw new ValidationError("Scenario name is required.");

  let impact: ScenarioImpact;

  switch (scenarioType) {
    case "SalesIncrease":
    case "SupplierPriceIncrease":
    case "OpexReduction": {
      if (parameters.percent === undefined) throw new ValidationError("percent is required for this scenario type.");
      const incomeStatement = await getIncomeStatement(companyId, periodStart, periodEnd);
      const baseline: ScenarioIncomeBaseline = {
        revenue: incomeStatement.revenue.total,
        costOfSales: incomeStatement.costOfSales.total,
        operatingExpenses: incomeStatement.operatingExpenses.total,
        otherIncome: incomeStatement.otherIncome.total,
        otherExpense: incomeStatement.otherExpense.total,
        netProfit: incomeStatement.netProfit,
      };
      impact = scenarioType === "SalesIncrease" ? simulateSalesIncrease(baseline, parameters.percent) : scenarioType === "SupplierPriceIncrease" ? simulateSupplierPriceIncrease(baseline, parameters.percent) : simulateOpexReduction(baseline, parameters.percent);
      break;
    }
    case "ReceiptDelay": {
      if (parameters.delayDays === undefined) throw new ValidationError("delayDays is required for this scenario type.");
      const cashFlow = await getCashFlowStatement(companyId, periodStart, periodEnd);
      const periodDays = Math.max(1, Math.round((Date.parse(periodEnd) - Date.parse(periodStart)) / 86_400_000) + 1);
      const incomeStatement = await getIncomeStatement(companyId, periodStart, periodEnd);
      const averageDailyReceipts = parameters.averageDailyReceipts ?? round2(incomeStatement.revenue.total / periodDays);
      impact = simulateReceiptDelay(cashFlow.closingCash, parameters.delayDays, averageDailyReceipts);
      break;
    }
    case "AssetReplacement": {
      if (!parameters.newAssetCost || !parameters.newAssetUsefulLifeMonths) throw new ValidationError("newAssetCost and newAssetUsefulLifeMonths are required for this scenario type.");
      let oldAssetNetBookValue = 0;
      let oldAssetMonthlyDepreciation = 0;
      if (parameters.assetId) {
        const asset = await getFixedAsset(companyId, parameters.assetId);
        if (!asset) throw new ValidationError(`No fixed asset with id ${parameters.assetId}.`);
        const withNbv = withNetBookValue(asset);
        oldAssetNetBookValue = withNbv.netBookValue;
        oldAssetMonthlyDepreciation = computeMonthlyDepreciationAmount(asset, withNbv.netBookValue);
      }
      impact = simulateAssetReplacement(oldAssetNetBookValue, oldAssetMonthlyDepreciation, parameters.newAssetCost, parameters.newAssetResidualValue ?? 0, parameters.newAssetUsefulLifeMonths);
      break;
    }
    case "Hiring": {
      if (!parameters.annualSalaryCost) throw new ValidationError("annualSalaryCost is required for this scenario type.");
      impact = simulateHiring(parameters.annualSalaryCost);
      break;
    }
    default:
      throw new ValidationError(`Unsupported scenario type: ${scenarioType}`);
  }

  return repo.createCopilotScenario(companyId, { name: name.trim(), scenarioType, parameters, results: impact, createdBy: performedBy });
}
