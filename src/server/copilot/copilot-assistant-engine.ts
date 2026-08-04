/**
 * The AI Executive Copilot's Q&A engine — pure, deterministic,
 * evidence-backed answer builders for a FIXED catalog of supported
 * executive questions, matched from free text by real keyword scoring —
 * same architecture as `audit-assistant-engine.ts` (Module 10), which
 * this file deliberately mirrors rather than reinvents. This codebase
 * has no LLM/NLP engine to route free text through; fabricating one
 * would violate the platform's own AI Guardrails ("never invent...
 * never hide uncertainty"). Every answer states Executive Summary,
 * Confidence, Evidence, Calculations Used, Transactions/Journals/
 * Documents Consulted, Suggested Actions, and Alternative Explanations
 * where appropriate; an unmatched or currently-unbuildable question
 * returns an honest "not answerable yet" response rather than a guess.
 *
 * "This is a consumer of the existing intelligence layer — not a
 * replacement for it." Every builder here takes data the caller already
 * fetched from an EXISTING service (Income Statement/Balance Sheet/Cash
 * Flow from `financial-statements-service.ts`, forecasts from
 * `forecast-service.ts`, signals from `executive-intelligence-service.ts`)
 * — nothing here recomputes a figure another module already owns.
 */

import type { BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import type { CashFlowStatement } from "@/server/reporting/cash-flow-engine";
import type { IncomeStatement } from "@/server/reporting/income-statement-engine";
import type { ForecastResult } from "@/server/reporting/forecast-engine";

export type CopilotAnswer = {
  questionId: string;
  question: string;
  executiveSummary: string;
  confidence: number;
  evidence: string[];
  calculationsUsed: string;
  transactionsConsulted: { id: number; label: string; amount: number | null }[];
  journalsConsulted: { id: number; label: string }[];
  documentsConsulted: string[];
  suggestedActions: string[];
  alternativeExplanations: string[];
};

export type SupportedCopilotQuestion = { id: string; label: string; keywords: string[] };

export const SUPPORTED_COPILOT_QUESTIONS: SupportedCopilotQuestion[] = [
  { id: "profit-decrease", label: "Why did profit decrease this month?", keywords: ["profit", "decrease", "why", "down"] },
  { id: "cash-flow-movements", label: "Explain cash flow movements.", keywords: ["cash", "flow", "movements", "explain"] },
  { id: "customer-credit-risk", label: "Which customers present the highest credit risk?", keywords: ["customers", "credit", "risk"] },
  { id: "supplier-renegotiation", label: "Which suppliers should we renegotiate with?", keywords: ["suppliers", "renegotiate"] },
  { id: "inventory-increase", label: "Why has inventory increased?", keywords: ["inventory", "increased", "why"] },
  { id: "journals-for-balance", label: "Which journals contributed to this balance?", keywords: ["journals", "contributed", "balance"] },
  { id: "what-changed", label: "What changed compared with last month?", keywords: ["changed", "compared", "last", "month"] },
  { id: "biggest-risks", label: "What are my biggest financial risks today?", keywords: ["biggest", "financial", "risks", "today"] },
  { id: "cash-flow-pressure", label: "Where am I likely to experience cash-flow pressure?", keywords: ["cash-flow", "pressure", "likely"] },
  { id: "profitability-actions", label: "What actions would improve profitability?", keywords: ["actions", "improve", "profitability"] },
  { id: "matching-review", label: "What needs my review today?", keywords: ["review", "queue", "matching", "unmatched", "today"] },
];

export function matchCopilotQuestion(freeText: string): string | null {
  const words = freeText.toLowerCase().split(/[^a-z-]+/).filter(Boolean);
  let best: { id: string; score: number } | null = null;
  for (const q of SUPPORTED_COPILOT_QUESTIONS) {
    const score = q.keywords.filter((k) => words.includes(k)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: q.id, score };
  }
  return best ? best.id : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function unavailableAnswer(questionId: string, question: string, reason: string): CopilotAnswer {
  return {
    questionId,
    question,
    executiveSummary: `Not answerable yet: ${reason}`,
    confidence: 0,
    evidence: [],
    calculationsUsed: "None — no underlying data source exists for this yet.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: [],
    suggestedActions: [],
    alternativeExplanations: [],
  };
}

export function answerUnmatched(freeText: string): CopilotAnswer {
  return unavailableAnswer(
    "unmatched",
    freeText,
    `this doesn't match any of the ${SUPPORTED_COPILOT_QUESTIONS.length} supported executive questions today. The Copilot answers from a fixed, evidence-backed catalog — not free-text natural language — to avoid presenting an unsupported conclusion.`,
  );
}

// ---------------------------------------------------------------------
// Real answer builders.
// ---------------------------------------------------------------------

export function answerProfitDecrease(current: IncomeStatement, prior: IncomeStatement): CopilotAnswer {
  const delta = round2(current.netProfit - prior.netProfit);
  if (delta >= 0) {
    return {
      questionId: "profit-decrease",
      question: "Why did profit decrease this month?",
      executiveSummary: `Net Profit did not decrease — it moved from ${prior.netProfit} to ${current.netProfit} (${delta >= 0 ? "+" : ""}${delta}).`,
      confidence: 0.9,
      evidence: [`Prior period Net Profit: ${prior.netProfit}`, `Current period Net Profit: ${current.netProfit}`],
      calculationsUsed: "Reused financial-statements-service.ts::getIncomeStatement for both periods — no second profit calculation.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["Income Statement (current period)", "Income Statement (prior period)"],
      suggestedActions: [],
      alternativeExplanations: [],
    };
  }

  const currentByAccount = new Map([...current.revenue.lines, ...current.costOfSales.lines, ...current.operatingExpenses.lines, ...current.otherIncome.lines, ...current.otherExpense.lines].map((l) => [l.accountId, l]));
  const priorByAccount = new Map([...prior.revenue.lines, ...prior.costOfSales.lines, ...prior.operatingExpenses.lines, ...prior.otherIncome.lines, ...prior.otherExpense.lines].map((l) => [l.accountId, l]));

  const movements = [...currentByAccount.entries()]
    .map(([accountId, line]) => ({ accountId, accountCode: line.accountCode, description: line.description, change: round2(line.amount - (priorByAccount.get(accountId)?.amount ?? 0)) }))
    .sort((a, b) => a.change - b.change)
    .slice(0, 3);

  return {
    questionId: "profit-decrease",
    question: "Why did profit decrease this month?",
    executiveSummary: `Net Profit fell by ${Math.abs(delta)} (from ${prior.netProfit} to ${current.netProfit}). The largest contributing movements were: ${movements.map((m) => `${m.accountCode} ${m.description} (${m.change})`).join(", ")}.`,
    confidence: 0.75,
    evidence: movements.map((m) => `${m.accountCode} — ${m.description} moved ${m.change} period-over-period.`),
    calculationsUsed: "Diffed each Income Statement line between the current and prior period (both from financial-statements-service.ts) and ranked by largest negative movement.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Income Statement (current period)", "Income Statement (prior period)"],
    suggestedActions: movements.map((m) => `Review ${m.accountCode} — ${m.description} for the cause of its movement.`),
    alternativeExplanations: ["A large movement can reflect legitimate seasonal or one-off activity rather than a structural decline — corroborate against the business narrative for the period."],
  };
}

export function answerCashFlowMovements(cashFlow: CashFlowStatement): CopilotAnswer {
  return {
    questionId: "cash-flow-movements",
    question: "Explain cash flow movements.",
    executiveSummary: `Cash moved from ${cashFlow.openingCash} to ${cashFlow.closingCash} this period (${cashFlow.netChangeInCash >= 0 ? "+" : ""}${cashFlow.netChangeInCash}). Operating activities contributed ${cashFlow.operatingActivities.total}, investing ${cashFlow.investingActivities.total}, and financing ${cashFlow.financingActivities.total}.`,
    confidence: cashFlow.reconciliationVariance === 0 ? 0.95 : 0.6,
    evidence: [
      `Operating Activities: ${cashFlow.operatingActivities.total}`,
      `Investing Activities: ${cashFlow.investingActivities.total}`,
      `Financing Activities: ${cashFlow.financingActivities.total}`,
      `Reconciliation variance vs. the direct cash movement: ${cashFlow.reconciliationVariance}`,
    ],
    calculationsUsed: "Reused financial-statements-service.ts::getCashFlowStatement (the indirect method, reconciled against the direct bank movement) — no second cash flow calculation.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Cash Flow Statement"],
    suggestedActions: cashFlow.reconciliationVariance !== 0 ? ["Investigate the reconciliation variance — it should always be zero in a balanced ledger."] : [],
    alternativeExplanations: [],
  };
}

export type CustomerRiskEntry = { customerId: number; customerName: string; outstandingBalance: number; overdueAmount: number; averagePaymentDays: number | null };

export function answerHighestCreditRisk(entries: CustomerRiskEntry[]): CopilotAnswer {
  const ranked = [...entries].filter((e) => e.overdueAmount > 0).sort((a, b) => b.overdueAmount - a.overdueAmount).slice(0, 5);
  if (ranked.length === 0) {
    return {
      questionId: "customer-credit-risk",
      question: "Which customers present the highest credit risk?",
      executiveSummary: "No customers currently have overdue balances.",
      confidence: 0.85,
      evidence: [],
      calculationsUsed: "Reused customer-financial-service.ts's aging computation for every customer — no second risk model.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["Customer Aging"],
      suggestedActions: [],
      alternativeExplanations: [],
    };
  }
  return {
    questionId: "customer-credit-risk",
    question: "Which customers present the highest credit risk?",
    executiveSummary: `The highest credit risk is ${ranked[0].customerName}, with ${ranked[0].overdueAmount} overdue.`,
    confidence: 0.7,
    evidence: ranked.map((r) => `${r.customerName}: ${r.overdueAmount} overdue of ${r.outstandingBalance} outstanding${r.averagePaymentDays !== null ? `, averages ${r.averagePaymentDays} days to pay` : ""}.`),
    calculationsUsed: "Ranked every customer by overdue balance, reusing customer-financial-service.ts's existing aging buckets and average-payment-days calculation per customer.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Customer Aging", "Sales Invoices"],
    suggestedActions: ranked.slice(0, 3).map((r) => `Follow up with ${r.customerName} on the overdue balance.`),
    alternativeExplanations: ["A large outstanding balance can reflect a large, healthy account rather than genuine risk — consider it alongside average payment days, not in isolation."],
  };
}

export type SupplierConcentrationEntry = { supplierId: number; supplierName: string; lifetimePurchases: number; sharePercent: number };

export function answerSupplierRenegotiation(entries: SupplierConcentrationEntry[], concentrationThresholdPercent = 20): CopilotAnswer {
  const ranked = [...entries].filter((e) => e.sharePercent >= concentrationThresholdPercent).sort((a, b) => b.sharePercent - a.sharePercent);
  if (ranked.length === 0) {
    return {
      questionId: "supplier-renegotiation",
      question: "Which suppliers should we renegotiate with?",
      executiveSummary: `No supplier currently accounts for ${concentrationThresholdPercent}% or more of total purchases — no concentrated renegotiation target identified.`,
      confidence: 0.6,
      evidence: [],
      calculationsUsed: `Ranked every supplier by share of total lifetime purchases; ${concentrationThresholdPercent}% is the concentration threshold used to flag renegotiation candidates.`,
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["Purchase Bills"],
      suggestedActions: [],
      alternativeExplanations: ["This only considers spend concentration — a supplier could still be worth renegotiating on price/quality even below this threshold."],
    };
  }
  return {
    questionId: "supplier-renegotiation",
    question: "Which suppliers should we renegotiate with?",
    executiveSummary: `${ranked[0].supplierName} accounts for ${ranked[0].sharePercent}% of total purchases — the strongest renegotiation candidate by spend concentration.`,
    confidence: 0.65,
    evidence: ranked.map((r) => `${r.supplierName}: ${r.sharePercent}% of total purchases (${r.lifetimePurchases}).`),
    calculationsUsed: "Reused the same supplier concentration computation executive-intelligence-service.ts::detectSupplierRisk already performs, ranked across every supplier rather than just the top one.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Purchase Bills"],
    suggestedActions: ranked.slice(0, 3).map((r) => `Open pricing/terms discussions with ${r.supplierName} given ${r.sharePercent}% spend concentration.`),
    alternativeExplanations: ["Spend concentration alone doesn't confirm unfavorable pricing — corroborate against market rates before renegotiating."],
  };
}

export function answerInventoryIncrease(currentValue: number, priorValue: number, forecastConfidence: number): CopilotAnswer {
  const delta = round2(currentValue - priorValue);
  if (delta <= 0) {
    return {
      questionId: "inventory-increase",
      question: "Why has inventory increased?",
      executiveSummary: `Inventory value did not increase — it moved from ${priorValue} to ${currentValue} (${delta}).`,
      confidence: 0.85,
      evidence: [`Prior inventory value: ${priorValue}`, `Current inventory value: ${currentValue}`],
      calculationsUsed: "Reused inventory-summary-service.ts::buildInventoryDashboardSummary for both periods — no second inventory valuation.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["Inventory Dashboard Summary"],
      suggestedActions: [],
      alternativeExplanations: [],
    };
  }
  const changePercent = priorValue !== 0 ? round2((delta / priorValue) * 100) : null;
  return {
    questionId: "inventory-increase",
    question: "Why has inventory increased?",
    executiveSummary: `Inventory value rose by ${delta}${changePercent !== null ? ` (${changePercent}%)` : ""}, from ${priorValue} to ${currentValue}.`,
    confidence: Math.min(0.8, 0.4 + forecastConfidence * 0.4),
    evidence: [`Prior inventory value: ${priorValue}`, `Current inventory value: ${currentValue}`, `Change: ${delta}${changePercent !== null ? ` (${changePercent}%)` : ""}`],
    calculationsUsed: "Compared inventory-summary-service.ts::buildInventoryDashboardSummary's inventoryValue across two periods; the trend's confidence reuses forecast-service.ts::getInventoryForecast's own R²-derived confidence.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Inventory Dashboard Summary", "Inventory Forecast"],
    suggestedActions: ["Review the Inventory workspace's Top Moving Products and recent Goods Received transactions for the specific items driving the increase."],
    alternativeExplanations: ["An increase can reflect planned stock-building ahead of demand rather than a problem — corroborate against sales forecasts before concluding overstocking."],
  };
}

export type AccountTransaction = { id: number; postingDate: string; description: string; debit: number; credit: number; journalId: number; journalNumber: string };

export function answerJournalsForBalance(accountCode: string, transactions: AccountTransaction[]): CopilotAnswer {
  if (transactions.length === 0) {
    return {
      questionId: "journals-for-balance",
      question: `Which journals contributed to the balance of ${accountCode}?`,
      executiveSummary: `No transactions were found on ${accountCode} for the requested period.`,
      confidence: 0.7,
      evidence: [],
      calculationsUsed: "Queried gl-inquiry-service.ts for the account over the requested period — no second GL query path.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: [],
      suggestedActions: [],
      alternativeExplanations: [],
    };
  }
  const journalIds = new Map(transactions.map((t) => [t.journalId, t.journalNumber]));
  const netMovement = round2(transactions.reduce((sum, t) => sum + t.debit - t.credit, 0));
  return {
    questionId: "journals-for-balance",
    question: `Which journals contributed to the balance of ${accountCode}?`,
    executiveSummary: `${journalIds.size} journal(s) posted to ${accountCode} this period, a net movement of ${netMovement}.`,
    confidence: 0.9,
    evidence: transactions.slice(0, 10).map((t) => `${t.journalNumber} on ${t.postingDate}: ${t.description} (debit ${t.debit}, credit ${t.credit})`),
    calculationsUsed: "Listed every GL transaction on this account for the period via gl-inquiry-service.ts — the same drill-through chain General Ledger's own Account Activity page uses.",
    transactionsConsulted: transactions.map((t) => ({ id: t.id, label: `${t.journalNumber} — ${t.description}`, amount: t.debit || t.credit })),
    journalsConsulted: [...journalIds.entries()].map(([id, number]) => ({ id, label: number })),
    documentsConsulted: [],
    suggestedActions: [],
    alternativeExplanations: [],
  };
}

export function answerWhatChanged(currentIS: IncomeStatement, priorIS: IncomeStatement, currentBS: BalanceSheet, priorBS: BalanceSheet): CopilotAnswer {
  const profitDelta = round2(currentIS.netProfit - priorIS.netProfit);
  const assetsDelta = round2(currentBS.totalAssets - priorBS.totalAssets);
  return {
    questionId: "what-changed",
    question: "What changed compared with last month?",
    executiveSummary: `Net Profit ${profitDelta >= 0 ? "increased" : "decreased"} by ${Math.abs(profitDelta)}; Total Assets ${assetsDelta >= 0 ? "increased" : "decreased"} by ${Math.abs(assetsDelta)}.`,
    confidence: 0.8,
    evidence: [
      `Net Profit: ${priorIS.netProfit} -> ${currentIS.netProfit}`,
      `Revenue: ${priorIS.revenue.total} -> ${currentIS.revenue.total}`,
      `Total Assets: ${priorBS.totalAssets} -> ${currentBS.totalAssets}`,
      `Total Liabilities: ${priorBS.liabilities.total} -> ${currentBS.liabilities.total}`,
    ],
    calculationsUsed: "Diffed the same Income Statement and Balance Sheet figures financial-statements-service.ts already computes for both periods — no new comparison logic.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Income Statement", "Balance Sheet"],
    suggestedActions: [],
    alternativeExplanations: [],
  };
}

export type RiskItem = { label: string; confidence: number; source: string };

export function answerBiggestRisks(items: RiskItem[]): CopilotAnswer {
  const ranked = [...items].sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  if (ranked.length === 0) {
    return {
      questionId: "biggest-risks",
      question: "What are my biggest financial risks today?",
      executiveSummary: "No significant risks are currently flagged across Financial, Audit, or Asset Intelligence.",
      confidence: 0.7,
      evidence: [],
      calculationsUsed: "Composed open signals from executive-intelligence-service.ts, audit-finding-service.ts, and asset-intelligence-service.ts — no new risk detector.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: [],
      suggestedActions: [],
      alternativeExplanations: [],
    };
  }
  return {
    questionId: "biggest-risks",
    question: "What are my biggest financial risks today?",
    executiveSummary: `The highest-confidence risk today is: ${ranked[0].label}.`,
    confidence: ranked[0].confidence,
    evidence: ranked.map((r) => `[${r.source}] ${r.label} (${Math.round(r.confidence * 100)}% confidence)`),
    calculationsUsed: "Composed and ranked open signals from Financial Intelligence, Audit Findings, and Asset Findings by confidence — the platform's existing Intelligence Layer, not a new risk model.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: [],
    suggestedActions: ranked.slice(0, 3).map((r) => `Review: ${r.label}`),
    alternativeExplanations: [],
  };
}

export function answerCashFlowPressure(forecast: ForecastResult): CopilotAnswer {
  if (forecast.forecast.length === 0) {
    return {
      questionId: "cash-flow-pressure",
      question: "Where am I likely to experience cash-flow pressure?",
      executiveSummary: "Not enough historical data to project a cash-flow trend yet.",
      confidence: 0,
      evidence: [],
      calculationsUsed: "Reused forecast-service.ts::getCashflowForecast.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: [],
      suggestedActions: [],
      alternativeExplanations: [],
    };
  }
  const declining = forecast.forecast[forecast.forecast.length - 1].value < forecast.forecast[0].value;
  return {
    questionId: "cash-flow-pressure",
    question: "Where am I likely to experience cash-flow pressure?",
    executiveSummary: declining
      ? `The cash forecast trends downward through ${forecast.forecast[forecast.forecast.length - 1].period}, reaching ${forecast.forecast[forecast.forecast.length - 1].value}.`
      : "The cash forecast trends flat-to-upward over the projected periods — no near-term pressure indicated by the trend.",
    confidence: forecast.confidence,
    evidence: forecast.forecast.map((p) => `${p.period}: ${p.value}`),
    calculationsUsed: "Reused forecast-service.ts::getCashflowForecast — the same real linear-regression Forecast Engine every other forecast in the platform uses.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Cashflow Forecast"],
    suggestedActions: declining ? ["Review upcoming payables and collection timing against the projected shortfall period."] : [],
    alternativeExplanations: forecast.assumptions,
  };
}

export function answerProfitabilityActions(incomeStatement: IncomeStatement): CopilotAnswer {
  const allExpenseLines = [...incomeStatement.operatingExpenses.lines, ...incomeStatement.costOfSales.lines].sort((a, b) => b.amount - a.amount);
  const largest = allExpenseLines[0];
  const grossMarginPercent = incomeStatement.revenue.total !== 0 ? round2((incomeStatement.grossProfit / incomeStatement.revenue.total) * 100) : null;

  const actions: string[] = [];
  if (largest) actions.push(`Review ${largest.accountCode} — ${largest.description} (${largest.amount}), the largest cost line this period.`);
  if (grossMarginPercent !== null && grossMarginPercent < 30) actions.push(`Gross margin is ${grossMarginPercent}% — review pricing or cost of sales.`);

  return {
    questionId: "profitability-actions",
    question: "What actions would improve profitability?",
    executiveSummary: largest
      ? `The largest cost line this period is ${largest.accountCode} — ${largest.description} (${largest.amount})${grossMarginPercent !== null ? `; gross margin is ${grossMarginPercent}%` : ""}.`
      : "No expense lines recorded this period.",
    confidence: 0.55,
    evidence: allExpenseLines.slice(0, 5).map((l) => `${l.accountCode} — ${l.description}: ${l.amount}`),
    calculationsUsed: "Ranked Income Statement expense lines by amount (financial-statements-service.ts) and computed gross margin from the same revenue/gross profit figures — no new cost model.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Income Statement"],
    suggestedActions: actions,
    alternativeExplanations: ["Largest doesn't always mean most controllable — a large cost line can still be efficient relative to the revenue it supports."],
  };
}

export type MatchingQueueSummaryItem = { itemType: string; description: string; confidence: number | null };

/** Matching Platform's "AI Review" requirement: "AI Copilot consumes
 * Matching. Never duplicate matching logic." This builder takes the ONE
 * Review Queue's own already-computed items (`matching-queue-service.ts`)
 * — it never re-detects anything; it only explains what the shared
 * engine already found, with real confidence and evidence, exactly the
 * same "consumer of the existing intelligence layer" discipline every
 * other Copilot answer in this file follows. */
export function answerMatchingReview(items: MatchingQueueSummaryItem[]): CopilotAnswer {
  if (items.length === 0) {
    return {
      questionId: "matching-review",
      question: "What needs my review today?",
      executiveSummary: "Nothing is currently awaiting review in the Matching workspace's Review Queue.",
      confidence: 0.85,
      evidence: [],
      calculationsUsed: "Reused matching-queue-service.ts::getMatchingQueue — no second detection pass.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: [],
      suggestedActions: [],
      alternativeExplanations: [],
    };
  }

  const byType = new Map<string, number>();
  for (const item of items) byType.set(item.itemType, (byType.get(item.itemType) ?? 0) + 1);
  const topByType = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  const withConfidence = items.filter((i): i is MatchingQueueSummaryItem & { confidence: number } => i.confidence !== null);
  const avgConfidence = withConfidence.length > 0 ? round2(withConfidence.reduce((sum, i) => sum + i.confidence, 0) / withConfidence.length) : null;

  return {
    questionId: "matching-review",
    question: "What needs my review today?",
    executiveSummary: `${items.length} item(s) are awaiting review in the Matching workspace — mostly ${topByType[0][0]} (${topByType[0][1]}).`,
    confidence: 0.8,
    evidence: topByType.map(([type, count]) => `${type}: ${count} item(s).`),
    calculationsUsed: `Composed from the ONE Review Queue (matching-queue-service.ts), which itself reuses the Matching Engine, Banking Exceptions, and the Auditor Workspace's own duplicate-party test — no new detection logic.${avgConfidence !== null ? ` Average confidence across items that carry one: ${avgConfidence}%.` : ""}`,
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Matching Review Queue"],
    suggestedActions: [`Open the Matching workspace's Review Queue tab to resolve the ${items.length} outstanding item(s), starting with ${topByType[0][0]}.`],
    alternativeExplanations: ["A large queue can reflect a busy import/trading period rather than a process failure — check the trend over several days before concluding something is broken."],
  };
}
