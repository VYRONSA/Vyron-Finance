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
import type { BusinessSituation, Finding } from "@/server/financial-intelligence/types";
import type { VyronAiStructuredResponse } from "@/server/ai/types";

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
  /** Phase 12 — VYRON Ask. A short bulleted restatement of the answer,
   * distinct from the narrative `executiveSummary` prose. Optional and
   * left undefined by every pre-existing answer builder — only the new
   * Financial-Intelligence-aware questions below populate it. */
  keyPoints?: string[];
  /** Phase 12 — VYRON Ask. Real, existing routes only (sourced from
   * `Finding.actionHref`, which is itself never fabricated — see
   * financial-intelligence-engine.ts). Optional; when absent, the UI
   * falls back to displaying `suggestedActions` as plain text with no
   * button, rather than ever inventing a route. */
  actionLinks?: { label: string; href: string }[];
  /** Phase 15 — VYRON AI. Which layer actually answered this question —
   * lets the UI distinguish the fixed deterministic catalog from an
   * LLM-generated explanation (brief, section 21). Stamped once, by
   * `copilot-assistant-service.ts::askCopilot`, never by an individual
   * answer builder — every existing builder is unaware this field
   * exists. `undefined` only for answers built directly by a test
   * fixture rather than through `askCopilot`. */
  answeredBy?: "VyronIntelligence" | "VyronAI";
  /** Phase 15 — VYRON AI. A user-friendly, clickable source reference
   * per factual claim (brief, section 12 — "Based on VYRON Intelligence
   * — Cash Collection Pressure."), distinct from the raw `evidence`
   * strings above. `href: null` means a real reference with no linkable
   * route. Optional; every deterministic builder leaves this undefined
   * (its own `evidence`/`actionLinks` already serve this role). */
  evidenceReferences?: { label: string; href: string | null }[];
  /** Phase 15 — VYRON AI. Honest gaps the model itself flagged — "if the
   * evidence is insufficient, say so" (brief, section 8) made visible to
   * the user rather than silently dropped. Optional; only ever populated
   * for an `answeredBy: "VyronAI"` answer. */
  uncertainties?: string[];
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
  // Phase 12 — VYRON Ask. Grounded in the Financial Intelligence Engine
  // (financial-intelligence-engine.ts) rather than the financial
  // statements this file's other questions use.
  { id: "needs-attention", label: "What needs my attention?", keywords: ["needs", "attention"] },
  { id: "banking-warnings", label: "Why are there banking warnings?", keywords: ["banking", "warnings"] },
  { id: "next-actions", label: "What should I do next?", keywords: ["should", "next"] },
  { id: "data-quality-warnings", label: "Why is my company showing Data Quality warnings?", keywords: ["data", "quality", "warnings"] },
  // Phase 13 — expanded Financial Intelligence: Cash Flow, Customers,
  // Suppliers, Profitability, General Ledger, VAT, and a second phrasing
  // of Data Quality. Each keyword set is deliberately distinct from
  // every question above it so `matchCopilotQuestion`'s max-score
  // matcher never ties (verified directly in copilot-assistant-engine.test.ts).
  { id: "cash-status", label: "What is happening with my cash?", keywords: ["happening", "cash"] },
  { id: "customers-paying-late", label: "Are customers paying late?", keywords: ["paying", "late"] },
  { id: "supplier-payments-attention", label: "Do I have supplier payments that need attention?", keywords: ["payments", "attention"] },
  { id: "profitability-status", label: "How is profitability looking?", keywords: ["profitability", "looking"] },
  { id: "gl-issues", label: "What GL issues has VYRON found?", keywords: ["gl", "issues"] },
  { id: "vat-issues", label: "What VAT issues need attention?", keywords: ["vat", "issues"] },
  { id: "missing-data", label: "What data is missing from my financial picture?", keywords: ["missing", "data"] },
  // Phase 14 — Business Situations (business-situation-engine.ts).
  // Keyword sets verified by hand against every entry above (and
  // asserted directly in copilot-assistant-engine.test.ts) so none of
  // these ties with an existing question for its own exact phrasing —
  // e.g. "concerned"/"cash" beats cash-status's "happening"/"cash" only
  // on the word "cash" (score 1), because "concerned" adds a second
  // matching keyword (score 2). "What are my biggest financial
  // problems?" deliberately gets NO new entry — it already routes
  // cleanly to the existing "biggest-risks" (score 2 on
  // "biggest"/"financial") with nothing else scoring above 0.
  { id: "situations-attention", label: "What situations need my attention?", keywords: ["situations", "need"] },
  { id: "related-warnings", label: "Are any of the warnings related?", keywords: ["related", "warnings"] },
  { id: "cash-concern-why", label: "Why is VYRON concerned about cash?", keywords: ["concerned", "cash"] },
  { id: "main-risks", label: "What are the main risks in my business?", keywords: ["main", "risks"] },
  { id: "deal-with-first", label: "What should I deal with first?", keywords: ["deal", "first"] },
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

/** Phase 13. Matches the same "R X,XXX.XX" formatting
 * `financial-intelligence-engine.ts`'s own `money()` already produces —
 * used here so a raw number VYRON Ask states (e.g. total cash) reads
 * consistently alongside a Finding's own already-formatted evidence
 * string, not as a jarring unformatted number beside a formatted one. */
function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

// ---------------------------------------------------------------------
// VYRON Ask (Phase 12) — grounded in the Financial Intelligence Engine's
// own `Finding[]` (financial-intelligence-engine.ts), the SAME data the
// VYRON Intelligence Centre shows. No new detection: every builder below
// only reads, groups, and restates fields a `Finding` already carries.
// ---------------------------------------------------------------------

/** Only the fields these builders actually read — lets callers pass a
 * real `Finding[]` (or a test fixture) without importing the full type
 * graph. */
export type AskableFinding = Pick<Finding, "severity" | "category" | "title" | "description" | "evidence" | "recommendedAction" | "actionHref">;

const SEVERITY_RANK: Record<AskableFinding["severity"], number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

/** Real routes only — one link per distinct `actionHref`, in finding
 * order. Never invents a label or a route: both come straight from the
 * Finding the caller supplied. */
function findingActionLinks(findings: AskableFinding[]): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = [];
  const seenHrefs = new Set<string>();
  for (const f of findings) {
    if (f.recommendedAction && f.actionHref && !seenHrefs.has(f.actionHref)) {
      seenHrefs.add(f.actionHref);
      links.push({ label: f.recommendedAction, href: f.actionHref });
    }
  }
  return links;
}

function findingSuggestedActions(findings: AskableFinding[]): string[] {
  return [...new Set(findings.map((f) => f.recommendedAction).filter((a): a is string => a !== null))];
}

export function answerNeedsAttention(findings: AskableFinding[]): CopilotAnswer {
  if (findings.length === 0) {
    return {
      questionId: "needs-attention",
      question: "What needs my attention?",
      executiveSummary: "Nothing currently needs your attention — VYRON Intelligence has no active findings.",
      confidence: 0.9,
      keyPoints: [],
      evidence: [],
      calculationsUsed: "Reused financial-intelligence-engine.ts::buildFinancialIntelligenceSummary — the same findings shown on the VYRON Intelligence Centre, not a new detector.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["VYRON Intelligence Centre"],
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  const sorted = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const top = sorted.slice(0, 5);
  return {
    questionId: "needs-attention",
    question: "What needs my attention?",
    executiveSummary: `${findings.length} item(s) currently need attention. The most urgent is [${sorted[0].severity}] ${sorted[0].title}.`,
    confidence: 0.85,
    keyPoints: top.map((f) => `[${f.severity}] ${f.title}`),
    evidence: top.map((f) => f.evidence),
    calculationsUsed: "Reused financial-intelligence-engine.ts::buildFinancialIntelligenceSummary, sorted by its own Critical -> High -> Medium -> Low severity order — no new detector.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["VYRON Intelligence Centre"],
    suggestedActions: findingSuggestedActions(top),
    actionLinks: findingActionLinks(top),
    alternativeExplanations: [],
  };
}

export function answerBankingWarnings(findings: AskableFinding[]): CopilotAnswer {
  const banking = findings.filter((f) => f.category === "Banking").sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  if (banking.length === 0) {
    return {
      questionId: "banking-warnings",
      question: "Why are there banking warnings?",
      executiveSummary: "There are no banking warnings right now.",
      confidence: 0.9,
      keyPoints: [],
      evidence: [],
      calculationsUsed: "Reused financial-intelligence-engine.ts::findBankingFindings — no second detector.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["Banking Exceptions"],
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  return {
    questionId: "banking-warnings",
    question: "Why are there banking warnings?",
    executiveSummary: `VYRON has flagged ${banking.length} banking finding(s): ${banking.map((f) => f.title).join("; ")}.`,
    confidence: 0.85,
    keyPoints: banking.map((f) => `[${f.severity}] ${f.title}`),
    evidence: banking.map((f) => f.evidence),
    calculationsUsed: "Reused financial-intelligence-engine.ts::findBankingFindings — sourced from real open Banking Exceptions and reconciliation status, no new detector.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Banking Exceptions", "Bank Reconciliation"],
    suggestedActions: findingSuggestedActions(banking),
    actionLinks: findingActionLinks(banking),
    alternativeExplanations: [],
  };
}

export function answerNextActions(findings: AskableFinding[]): CopilotAnswer {
  const actionable = findings.filter((f) => f.recommendedAction !== null).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  if (actionable.length === 0) {
    return {
      questionId: "next-actions",
      question: "What should I do next?",
      executiveSummary: findings.length === 0 ? "There's nothing to act on right now — no active findings." : "There's nothing actionable right now — every active finding is informational.",
      confidence: 0.85,
      keyPoints: [],
      evidence: [],
      calculationsUsed: "Reused financial-intelligence-engine.ts::buildFinancialIntelligenceSummary.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["VYRON Intelligence Centre"],
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  const top = actionable.slice(0, 3);
  return {
    questionId: "next-actions",
    question: "What should I do next?",
    executiveSummary: `Start with: ${top[0].recommendedAction} (${top[0].title}).`,
    confidence: 0.8,
    keyPoints: top.map((f) => `${f.recommendedAction} — ${f.title}`),
    evidence: top.map((f) => f.evidence),
    calculationsUsed: "Ranked active findings by financial-intelligence-engine.ts's own Critical -> High -> Medium -> Low severity order and listed each one's real recommended action.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["VYRON Intelligence Centre"],
    suggestedActions: findingSuggestedActions(top),
    actionLinks: findingActionLinks(top),
    alternativeExplanations: [],
  };
}

export function answerDataQualityWarnings(findings: AskableFinding[]): CopilotAnswer {
  const dataQuality = findings.filter((f) => f.category === "DataQuality");
  if (dataQuality.length === 0) {
    return {
      questionId: "data-quality-warnings",
      question: "Why is my company showing Data Quality warnings?",
      executiveSummary: "There are no Data Quality warnings right now — VYRON's picture of your business is complete.",
      confidence: 0.9,
      keyPoints: [],
      evidence: [],
      calculationsUsed: "Reused financial-intelligence-engine.ts::findDataQualityFindings.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: [],
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  return {
    questionId: "data-quality-warnings",
    question: "Why is my company showing Data Quality warnings?",
    executiveSummary: `VYRON has ${dataQuality.length} Data Quality note(s). These don't mean something is financially wrong — they mean VYRON's picture of your business is still incomplete: ${dataQuality.map((f) => f.title).join("; ")}.`,
    confidence: 0.9,
    keyPoints: dataQuality.map((f) => f.title),
    evidence: dataQuality.map((f) => f.evidence),
    calculationsUsed: "Reused financial-intelligence-engine.ts::findDataQualityFindings — presence checks over already-fetched real data, not a financial calculation.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: [],
    suggestedActions: findingSuggestedActions(dataQuality),
    actionLinks: findingActionLinks(dataQuality),
    alternativeExplanations: ["Data Quality findings are about setup completeness, not business performance — they will stop appearing once the relevant data exists."],
  };
}

// ---------------------------------------------------------------------
// Phase 13 — expanded Financial Intelligence questions. Same
// "consumer of the existing intelligence layer" discipline as every
// builder above: each of these only reads, filters, and restates real
// `Finding`s the engine already produced — nothing here recalculates a
// figure or invents a trend claim.
// ---------------------------------------------------------------------

/** Shared shape for the four questions that are simply "show me every
 * finding in category X" — cash/customers/suppliers/VAT/GL warnings all
 * follow this exact pattern, so it's factored out once rather than
 * copy-pasted five times. */
function answerCategoryFindings(
  findings: AskableFinding[],
  category: AskableFinding["category"],
  questionId: string,
  question: string,
  noneSummary: string,
  documentsConsulted: string[],
): CopilotAnswer {
  const matches = findings.filter((f) => f.category === category).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  if (matches.length === 0) {
    return {
      questionId,
      question,
      executiveSummary: noneSummary,
      confidence: 0.9,
      keyPoints: [],
      evidence: [],
      calculationsUsed: `Reused financial-intelligence-engine.ts's real ${category} findings — no second detector.`,
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted,
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  return {
    questionId,
    question,
    executiveSummary: `VYRON has ${matches.length} ${category} finding(s): ${matches.map((f) => f.title).join("; ")}.`,
    confidence: 0.85,
    keyPoints: matches.map((f) => `[${f.severity}] ${f.title}`),
    evidence: matches.map((f) => f.evidence),
    calculationsUsed: `Reused financial-intelligence-engine.ts's real ${category} findings — no second detector.`,
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted,
    suggestedActions: findingSuggestedActions(matches),
    actionLinks: findingActionLinks(matches),
    alternativeExplanations: [],
  };
}

export function answerCustomersPayingLate(findings: AskableFinding[]): CopilotAnswer {
  return answerCategoryFindings(
    findings,
    "Customers",
    "customers-paying-late",
    "Are customers paying late?",
    "No customers currently show a payment concern — nothing overdue past 90 days, and no slow-paying trend has been flagged.",
    ["Customer Aging"],
  );
}

export function answerSupplierPaymentsAttention(findings: AskableFinding[]): CopilotAnswer {
  return answerCategoryFindings(
    findings,
    "Suppliers",
    "supplier-payments-attention",
    "Do I have supplier payments that need attention?",
    "No supplier payments currently need attention.",
    ["Supplier Aging"],
  );
}

export function answerVatIssues(findings: AskableFinding[]): CopilotAnswer {
  return answerCategoryFindings(findings, "VAT", "vat-issues", "What VAT issues need attention?", "No VAT issues currently need attention.", ["VAT Dashboard"]);
}

export function answerGlIssues(findings: AskableFinding[]): CopilotAnswer {
  return answerCategoryFindings(
    findings,
    "GeneralLedger",
    "gl-issues",
    "What GL issues has VYRON found?",
    "VYRON hasn't found any General Ledger issues right now (no possible duplicate journals, and nothing stuck as Draft or unposted beyond the usual threshold).",
    ["Financial Intelligence"],
  );
}

/** "What data is missing from my financial picture?" — a second, more
 * general phrasing of the same real Data Quality findings
 * `answerDataQualityWarnings` already reports. Delegates entirely to
 * that builder (zero duplicated logic) and only overrides the echoed
 * question text so the answer matches what was actually asked. */
export function answerMissingData(findings: AskableFinding[]): CopilotAnswer {
  return { ...answerDataQualityWarnings(findings), questionId: "missing-data", question: "What data is missing from my financial picture?" };
}

export function answerCashStatus(findings: AskableFinding[], totalCash: number | null): CopilotAnswer {
  if (totalCash === null) {
    return {
      questionId: "cash-status",
      question: "What is happening with my cash?",
      executiveSummary: "Not answerable yet: no bank account data is available for this company.",
      confidence: 0,
      keyPoints: [],
      evidence: [],
      calculationsUsed: "None — no underlying data source exists for this yet.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: [],
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  const cashFindings = findings.filter((f) => f.category === "CashFlow").sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return {
    questionId: "cash-status",
    question: "What is happening with my cash?",
    executiveSummary:
      cashFindings.length > 0
        ? `Total cash across your active bank accounts is ${money(totalCash)}. VYRON has flagged: ${cashFindings.map((f) => f.title).join("; ")}.`
        : `Total cash across your active bank accounts is ${money(totalCash)}. No cash-flow findings are currently flagged.`,
    confidence: 0.85,
    keyPoints: cashFindings.map((f) => `[${f.severity}] ${f.title}`),
    evidence: [`Total cash: ${money(totalCash)}.`, ...cashFindings.map((f) => f.evidence)],
    calculationsUsed: "Reused bank-account-service.ts's real account balances and financial-intelligence-engine.ts's CashFlow findings — no new cash calculation.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Bank Accounts"],
    suggestedActions: findingSuggestedActions(cashFindings),
    actionLinks: findingActionLinks(cashFindings),
    alternativeExplanations: [
      "This is the current total balance, not a trend — VYRON only reports a cash-flow trend where a real forecast (the Cashflow Forecast) already provides one; see 'Where am I likely to experience cash-flow pressure?'.",
    ],
  };
}

export function answerProfitabilityStatus(findings: AskableFinding[], netProfit: number | null): CopilotAnswer {
  if (netProfit === null) {
    return {
      questionId: "profitability-status",
      question: "How is profitability looking?",
      executiveSummary: "Not answerable yet: no Income Statement data is available for the current period.",
      confidence: 0,
      keyPoints: [],
      evidence: [],
      calculationsUsed: "None — no underlying data source exists for this yet.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: [],
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  const profitFindings = findings.filter((f) => f.category === "Profitability").sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return {
    questionId: "profitability-status",
    question: "How is profitability looking?",
    executiveSummary:
      profitFindings.length > 0
        ? `Net Profit this period is ${money(netProfit)}. VYRON has flagged: ${profitFindings.map((f) => f.title).join("; ")}.`
        : `Net Profit this period is ${money(netProfit)}. No profitability findings are currently flagged.`,
    confidence: 0.85,
    keyPoints: profitFindings.map((f) => `[${f.severity}] ${f.title}`),
    evidence: [`Net Profit: ${money(netProfit)}.`, ...profitFindings.map((f) => f.evidence)],
    calculationsUsed: "Reused financial-statements-service.ts's real Income Statement and financial-intelligence-engine.ts's Profitability findings — no new profit calculation.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Income Statement"],
    suggestedActions: findingSuggestedActions(profitFindings),
    actionLinks: findingActionLinks(profitFindings),
    alternativeExplanations: [
      "This is the current period's figure, not a trend — VYRON only reports a period-over-period profitability trend where the Margin Reduction signal already provides one.",
    ],
  };
}

// ---------------------------------------------------------------------
// Phase 14 — Business Situation-aware questions. Grounded in
// business-situation-engine.ts::buildBusinessSituations, which itself
// only correlates `Finding[]` the Financial Intelligence Engine already
// produced — nothing below detects a new relationship or invents a
// numeric risk score. Every summary uses the same honest,
// non-causal language the engine itself is required to use ("VYRON
// identified related conditions," never "X is causing Y").
// ---------------------------------------------------------------------

/** Real routes only, deduplicated by href across every situation in the
 * given order — mirrors `findingActionLinks` above but over a
 * situation's already-deduplicated-per-situation `recommendedActions`,
 * since two DIFFERENT situations can still point at the same real
 * route. */
function situationActionLinks(situations: BusinessSituation[]): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = [];
  const seenHrefs = new Set<string>();
  for (const s of situations) {
    for (const action of s.recommendedActions) {
      if (!seenHrefs.has(action.href)) {
        seenHrefs.add(action.href);
        links.push(action);
      }
    }
  }
  return links;
}

export function answerSituationsAttention(situations: BusinessSituation[]): CopilotAnswer {
  if (situations.length === 0) {
    return {
      questionId: "situations-attention",
      question: "What situations need my attention?",
      executiveSummary: "VYRON hasn't identified any related conditions among your current findings — see 'What needs my attention?' for individual findings.",
      confidence: 0.85,
      keyPoints: [],
      evidence: [],
      calculationsUsed: "Reused business-situation-engine.ts::buildBusinessSituations over the same findings the VYRON Intelligence Centre shows — no new detector.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["VYRON Intelligence Centre"],
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  const top = situations.slice(0, 5);
  return {
    questionId: "situations-attention",
    question: "What situations need my attention?",
    executiveSummary: `VYRON identified ${situations.length} situation(s) — related conditions across your findings, not a claim that one caused another. The most significant is "${situations[0].title}" (${situations[0].severity}).`,
    confidence: 0.85,
    keyPoints: top.map((s) => `[${s.severity}] ${s.title} — ${s.contributingFindings.length} related finding(s)`),
    evidence: top.flatMap((s) => s.evidence),
    calculationsUsed: "Reused business-situation-engine.ts::buildBusinessSituations, already ordered by severity, then by how many real findings support it, then by whether a real action exists — no invented risk score.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["VYRON Intelligence Centre"],
    suggestedActions: [...new Set(top.flatMap((s) => s.recommendedActions.map((a) => a.label)))],
    actionLinks: situationActionLinks(top),
    alternativeExplanations: ["A situation groups findings that occur together — it is not a claim that one caused another."],
  };
}

export function answerRelatedWarnings(situations: BusinessSituation[]): CopilotAnswer {
  if (situations.length === 0) {
    return {
      questionId: "related-warnings",
      question: "Are any of the warnings related?",
      executiveSummary: "No — VYRON hasn't identified any related conditions among your current findings. Each active finding currently stands on its own.",
      confidence: 0.85,
      keyPoints: [],
      evidence: [],
      calculationsUsed: "Reused business-situation-engine.ts::buildBusinessSituations — checks a fixed set of known real relationships between findings, not a fabricated correlation.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["VYRON Intelligence Centre"],
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  return {
    questionId: "related-warnings",
    question: "Are any of the warnings related?",
    executiveSummary: `Yes — VYRON identified ${situations.length} related condition(s): ${situations.map((s) => s.title).join("; ")}. These are findings observed occurring together, not one causing another.`,
    confidence: 0.85,
    keyPoints: situations.map((s) => `${s.title}: ${s.contributingFindings.map((f) => f.title).join(" + ")}`),
    evidence: situations.flatMap((s) => s.evidence),
    calculationsUsed: "Reused business-situation-engine.ts::buildBusinessSituations, which only fires when a fixed, real set of finding ids co-occur — never a fabricated correlation.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["VYRON Intelligence Centre"],
    suggestedActions: [...new Set(situations.flatMap((s) => s.recommendedActions.map((a) => a.label)))],
    actionLinks: situationActionLinks(situations),
    alternativeExplanations: ["'Related' means these findings were observed together, not that one caused another."],
  };
}

export function answerCashConcernWhy(findings: AskableFinding[], situations: BusinessSituation[], totalCash: number | null): CopilotAnswer {
  const cashFindings = findings.filter((f) => f.category === "CashFlow").sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const cashSituations = situations.filter((s) => s.contributingFindings.some((f) => f.category === "CashFlow"));

  if (cashFindings.length === 0) {
    return {
      questionId: "cash-concern-why",
      question: "Why is VYRON concerned about cash?",
      executiveSummary:
        totalCash !== null
          ? `VYRON isn't currently concerned about cash — total cash across your active bank accounts is ${money(totalCash)} and no cash-flow findings are flagged.`
          : "VYRON isn't currently concerned about cash — no cash-flow findings are flagged (bank account data isn't available to state a total).",
      confidence: 0.85,
      keyPoints: [],
      evidence: [],
      calculationsUsed: "Reused financial-intelligence-engine.ts's CashFlow findings — no new detector.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["Bank Accounts"],
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  return {
    questionId: "cash-concern-why",
    question: "Why is VYRON concerned about cash?",
    executiveSummary: `VYRON has flagged: ${cashFindings.map((f) => f.title).join("; ")}.${totalCash !== null ? ` Total cash across your active bank accounts is ${money(totalCash)}.` : ""}${cashSituations.length > 0 ? ` This is also part of a broader situation VYRON identified: ${cashSituations.map((s) => s.title).join("; ")}.` : ""}`,
    confidence: 0.85,
    keyPoints: cashFindings.map((f) => `[${f.severity}] ${f.title}`),
    evidence: [...(totalCash !== null ? [`Total cash: ${money(totalCash)}.`] : []), ...cashFindings.map((f) => f.evidence)],
    calculationsUsed: "Reused financial-intelligence-engine.ts's CashFlow findings and, where relevant, business-situation-engine.ts's related-condition grouping — no new cash calculation.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["Bank Accounts"],
    suggestedActions: findingSuggestedActions(cashFindings),
    actionLinks: findingActionLinks(cashFindings),
    alternativeExplanations: cashSituations.length > 0 ? ["A related situation means these conditions were observed together, not that one caused the other."] : [],
  };
}

export function answerMainRisks(findings: AskableFinding[], situations: BusinessSituation[]): CopilotAnswer {
  if (findings.length === 0) {
    return {
      questionId: "main-risks",
      question: "What are the main risks in my business?",
      executiveSummary: "VYRON currently has no active findings — no risks to report.",
      confidence: 0.85,
      keyPoints: [],
      evidence: [],
      calculationsUsed: "Reused financial-intelligence-engine.ts::buildFinancialIntelligenceSummary — the same findings shown on the VYRON Intelligence Centre.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["VYRON Intelligence Centre"],
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  const sorted = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const top = sorted.slice(0, 5);
  return {
    questionId: "main-risks",
    question: "What are the main risks in my business?",
    executiveSummary: `The main risk right now is [${sorted[0].severity}] ${sorted[0].title}.${situations.length > 0 ? ` VYRON also identified ${situations.length} related condition(s) across these findings — see "Are any of the warnings related?" for details.` : ""}`,
    confidence: 0.85,
    keyPoints: top.map((f) => `[${f.severity}] ${f.title}`),
    evidence: top.map((f) => f.evidence),
    calculationsUsed: "Reused financial-intelligence-engine.ts::buildFinancialIntelligenceSummary, sorted by its own Critical -> High -> Medium -> Low severity order — no new detector or invented risk score.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["VYRON Intelligence Centre"],
    suggestedActions: findingSuggestedActions(top),
    actionLinks: findingActionLinks(top),
    alternativeExplanations: [],
  };
}

/** Deterministic prioritization (brief, section 14): a Business
 * Situation — already the most severe, best-evidenced, most-actionable
 * grouping `buildBusinessSituations` could find — outranks any single
 * standalone finding, since it represents multiple corroborating real
 * conditions rather than one. Only when no situation exists does this
 * fall back to the single most severe actionable finding, the same
 * ranking `answerNextActions` already uses. */
export function answerDealWithFirst(findings: AskableFinding[], situations: BusinessSituation[]): CopilotAnswer {
  if (situations.length > 0) {
    const top = situations[0];
    return {
      questionId: "deal-with-first",
      question: "What should I deal with first?",
      executiveSummary: `Deal with "${top.title}" first — VYRON identified ${top.contributingFindings.length} related condition(s): ${top.contributingFindings.map((f) => f.title).join("; ")}.`,
      confidence: 0.85,
      keyPoints: top.contributingFindings.map((f) => `[${f.severity}] ${f.title}`),
      evidence: top.evidence,
      calculationsUsed: "Reused business-situation-engine.ts::buildBusinessSituations, which orders situations by severity, then by how many real findings support them, then by whether a real recommended action exists.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["VYRON Intelligence Centre"],
      suggestedActions: top.recommendedActions.map((a) => a.label),
      actionLinks: top.recommendedActions,
      alternativeExplanations: ["This is the highest-priority related situation, not necessarily a single largest number — a well-evidenced situation can outrank a standalone finding of the same severity."],
    };
  }

  const actionable = findings.filter((f) => f.recommendedAction !== null).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  if (actionable.length === 0) {
    return {
      questionId: "deal-with-first",
      question: "What should I deal with first?",
      executiveSummary: findings.length === 0 ? "There's nothing to deal with right now — no active findings." : "There's nothing actionable to deal with first — every active finding is informational.",
      confidence: 0.85,
      keyPoints: [],
      evidence: [],
      calculationsUsed: "Reused financial-intelligence-engine.ts::buildFinancialIntelligenceSummary.",
      transactionsConsulted: [],
      journalsConsulted: [],
      documentsConsulted: ["VYRON Intelligence Centre"],
      suggestedActions: [],
      actionLinks: [],
      alternativeExplanations: [],
    };
  }
  const top = actionable[0];
  return {
    questionId: "deal-with-first",
    question: "What should I deal with first?",
    executiveSummary: `Deal with "${top.title}" first: ${top.recommendedAction}.`,
    confidence: 0.85,
    keyPoints: [`[${top.severity}] ${top.title}`],
    evidence: [top.evidence],
    calculationsUsed: "Reused financial-intelligence-engine.ts's own Critical -> High -> Medium -> Low severity order — the single most severe finding with a real recommended action.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["VYRON Intelligence Centre"],
    suggestedActions: top.recommendedAction ? [top.recommendedAction] : [],
    actionLinks: top.recommendedAction && top.actionHref ? [{ label: top.recommendedAction, href: top.actionHref }] : [],
    alternativeExplanations: [],
  };
}

// ---------------------------------------------------------------------
// Phase 15 — VYRON AI. Only two functions live here: one maps the LLM's
// already-validated-and-sanitized `VyronAiStructuredResponse`
// (src/server/ai/vyron-ai-engine.ts) into this file's own `CopilotAnswer`
// contract, so the entire rest of this codebase (the API route, the
// service dispatcher, VYRON Ask's UI) keeps working against ONE answer
// shape regardless of which layer actually answered; the other is the
// honest fallback when VYRON AI itself is unavailable — mirroring
// `answerUnmatched`'s own "unavailable" pattern rather than inventing a
// new one.
// ---------------------------------------------------------------------

/** `questionId` is always `"vyron-ai"` here (there is no fixed catalog
 * entry for an open-ended question) — `question` carries the user's
 * real free text so the conversation still reads naturally. `confidence`
 * is a required legacy field on `CopilotAnswer` that the UI never
 * renders (see `vyron-ask-view.ts::toVyronAskAnswer`); it is not an
 * "AI confidence score" (that pattern was explicitly banned in Phase 10)
 * — it is fixed the same way several pre-existing deterministic
 * builders already fix theirs. */
export function toCopilotAnswerFromVyronAi(freeText: string, structured: VyronAiStructuredResponse): CopilotAnswer {
  return {
    questionId: "vyron-ai",
    question: freeText,
    executiveSummary: structured.answer,
    confidence: 0.75,
    keyPoints: structured.keyPoints,
    evidence: [],
    calculationsUsed: "Explained by VYRON AI from the Evidence Package built by financial-intelligence-engine.ts and business-situation-engine.ts — VYRON AI computes nothing itself.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["VYRON Intelligence Centre"],
    suggestedActions: structured.recommendedActions.map((a) => a.label),
    actionLinks: structured.recommendedActions,
    alternativeExplanations: [],
    answeredBy: "VyronAI",
    evidenceReferences: structured.evidenceReferences,
    uncertainties: structured.uncertainties,
  };
}

export function answerVyronAiUnavailable(freeText: string): CopilotAnswer {
  return {
    ...unavailableAnswer(
      "vyron-ai-unavailable",
      freeText,
      `VYRON AI is temporarily unavailable, so this question couldn't be answered right now. VYRON's deterministic questions (see the ${SUPPORTED_COPILOT_QUESTIONS.length} suggested prompts above) still work normally.`,
    ),
    answeredBy: "VyronAI",
  };
}
