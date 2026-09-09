/**
 * Placeholder data for the Financial Workspace Dashboard. The checklist
 * mirrors the reference implementation's RecoveryStatus computation
 * (finance_recovery_tool/recovery/status.py) item-for-item, per the
 * Product Review Board's "users familiar with Version 1.x should
 * immediately recognise the software" instruction. Replace with a real
 * status API call once the Dashboard module is migrated — see
 * ARCHITECTURE.md's "Known Gap" note.
 */

export type ChecklistItem = {
  label: string;
  complete: boolean;
  detail?: string;
};

export const MOCK_COMPANY = {
  id: "co_2",
  name: "Harlow Retail Group",
  industry: "Retail",
  financialYear: "FY2025/26",
};

export const MOCK_CHECKLIST: ChecklistItem[] = [
  { label: "Bank Statements Imported", complete: true },
  { label: "Customer Invoices Imported", complete: true },
  { label: "Customer Credit Notes Imported", complete: true },
  { label: "Supplier Invoices Imported", complete: true },
  { label: "Customer Matching", complete: false, detail: "6 of 214 customer receipts still unmatched" },
  { label: "Supplier Matching", complete: false, detail: "41 of 302 supplier payments still unmatched" },
  { label: "Journals Generated", complete: false, detail: "47 transaction(s) not yet journaled" },
  { label: "Journals Posted", complete: false, detail: "12 approved journal(s) awaiting posting" },
  { label: "Trial Balance Balanced", complete: true },
  { label: "VAT Balanced", complete: true },
  { label: "Bank Reconciled", complete: false, detail: "Difference of 1,284.50" },
  { label: "Financial Statements Generated", complete: false },
];

export const MOCK_COMPLETION_PERCENT =
  Math.round((1000 * MOCK_CHECKLIST.filter((i) => i.complete).length) / MOCK_CHECKLIST.length) / 10;

export const MOCK_WARNINGS = [
  "6 customer receipts have been unmatched for over 21 days.",
  "VAT check passed with a rounding difference of 0.02 — below tolerance.",
];

export const MOCK_OUTSTANDING_TASKS = [
  "Review 41 unmatched supplier payments in Supplier Reconciliation.",
  "Approve 12 journals awaiting posting.",
  "Resolve the 1,284.50 bank reconciliation difference before period close.",
];

export type KpiTrend = {
  direction: "up" | "down" | "flat";
  label: string;
  tone: "good" | "bad" | "neutral";
};

export type KpiDatum = {
  key: string;
  label: string;
  value: string;
  trend?: KpiTrend;
};

/**
 * Headline KPI row — Product Review Board "Financial Density" directive:
 * every major card should tell the user something useful, not sit empty
 * in Preview Mode. Values are illustrative but internally consistent with
 * MOCK_CHECKLIST's own figures (e.g. Outstanding Transactions sums the
 * unmatched counts already implied by the checklist detail text).
 */
export const MOCK_KPIS: KpiDatum[] = [
  { key: "recovery", label: "Recovery Progress", value: `${MOCK_COMPLETION_PERCENT.toFixed(0)}%`, trend: { direction: "up", label: "+12% this week", tone: "good" } },
  { key: "recoveredValue", label: "Recovered Value", value: "R 1,842,600", trend: { direction: "up", label: "+R 148,200 this week", tone: "good" } },
  { key: "importedToday", label: "Imported Today", value: "184", trend: { direction: "flat", label: "3 statements", tone: "neutral" } },
  { key: "outstanding", label: "Outstanding Transactions", value: "53", trend: { direction: "down", label: "-19 vs yesterday", tone: "good" } },
  { key: "matchingAccuracy", label: "Matching Accuracy", value: "96.2%", trend: { direction: "up", label: "+0.4% this month", tone: "good" } },
  { key: "merchantRules", label: "Merchant Rules", value: "1,284", trend: { direction: "up", label: "+6 this week", tone: "neutral" } },
  { key: "supplierMatches", label: "Supplier Matches", value: "261 / 302", trend: { direction: "up", label: "86% matched", tone: "good" } },
  { key: "vatExceptions", label: "VAT Exceptions", value: "3", trend: { direction: "down", label: "-2 this week", tone: "good" } },
  { key: "journalStatus", label: "Journals Awaiting Posting", value: "12", trend: { direction: "down", label: "-5 vs last week", tone: "good" } },
];

/** 14-day Recovery Progress trend — a single series, magnitude over time.
 * Internally consistent with MOCK_COMPLETION_PERCENT: the last point equals
 * today's actual recovery percentage, not an arbitrary illustrative number. */
export const MOCK_RECOVERY_TREND: { date: string; value: number }[] = [
  { date: "2026-07-16", value: 52 },
  { date: "2026-07-17", value: 54 },
  { date: "2026-07-18", value: 55 },
  { date: "2026-07-19", value: 58 },
  { date: "2026-07-20", value: 58 },
  { date: "2026-07-21", value: 61 },
  { date: "2026-07-22", value: 63 },
  { date: "2026-07-23", value: 64 },
  { date: "2026-07-24", value: 66 },
  { date: "2026-07-25", value: 67 },
  { date: "2026-07-26", value: 68 },
  { date: "2026-07-27", value: 69 },
  { date: "2026-07-28", value: 70 },
  { date: "2026-07-29", value: MOCK_COMPLETION_PERCENT },
];

/** 7-day Import Activity — daily transaction counts. The final day matches
 * MOCK_KPIS's "Imported Today" figure for cross-panel consistency. */
export const MOCK_IMPORT_ACTIVITY: { date: string; count: number }[] = [
  { date: "2026-07-23", count: 42 },
  { date: "2026-07-24", count: 118 },
  { date: "2026-07-25", count: 36 },
  { date: "2026-07-26", count: 0 },
  { date: "2026-07-27", count: 0 },
  { date: "2026-07-28", count: 97 },
  { date: "2026-07-29", count: 184 },
];

export type RecoveryAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  message: string;
  impact: string;
  action: string;
  href?: string;
};

/** Recovery Alerts — the same underlying issues as MOCK_WARNINGS /
 * MOCK_OUTSTANDING_TASKS, restructured with severity + why it matters +
 * a concrete next action per the Product Review Board's "every alert
 * should answer why it's important, what happens if ignored, what to
 * do" instruction. */
export const MOCK_RECOVERY_ALERTS: RecoveryAlert[] = [
  {
    id: "alert-1",
    severity: "warning",
    message: "41 supplier payments have been unmatched for over 14 days.",
    impact: "Unmatched payments can't be journaled — the longer they sit, the harder they are to trace back to an invoice.",
    action: "Review in Supplier Reconciliation",
    href: "supplier-reconciliation",
  },
  {
    id: "alert-2",
    severity: "warning",
    message: "12 approved journals are awaiting posting.",
    impact: "Posting is what moves these into the General Ledger — the trial balance won't reflect them until posted.",
    action: "Post journals",
  },
  {
    id: "alert-3",
    severity: "critical",
    message: "Bank reconciliation difference of R 1,284.50 on Main Trading Account.",
    impact: "The books and the bank disagree — period close cannot happen until this is resolved.",
    action: "Investigate in Bank Accounts",
    href: "bank-accounts/1",
  },
  {
    id: "alert-4",
    severity: "info",
    message: "VAT check passed with a rounding difference of 0.02 — below tolerance.",
    impact: "No action required — flagged for visibility only.",
    action: "No action needed",
  },
];

export type AiInsight = {
  id: string;
  tone: "good" | "warn" | "info";
  message: string;
};

/** Executive Intelligence — plain-language observations *derived from*
 * the same numbers already on this page (checklist, trend, alerts), not
 * a separate invented data source. Per the Product Review Board: "surface
 * insights, don't replace accounting." */
export const MOCK_AI_INSIGHTS: AiInsight[] = [
  { id: "insight-1", tone: "good", message: "Recovery has improved 18 points over the last 14 days — on pace to clear 80% within a week at the current rate." },
  { id: "insight-2", tone: "good", message: "Matching accuracy is up 0.4% this month; automated coding is handling more of each day's import without review." },
  { id: "insight-3", tone: "warn", message: "3 suppliers account for 71% of outstanding unmatched payments — Fenwick, Netherfield, and Harrow are worth reviewing first." },
  { id: "insight-4", tone: "info", message: "Journal backlog has fallen from 17 to 12 awaiting posting since last week." },
  { id: "insight-5", tone: "warn", message: "Import volume dropped to zero for two consecutive days (Jul 26–27) before resuming — confirm no statements were missed." },
];

export type ActivityEntry = {
  id: string;
  category: "Import" | "Matching" | "Merchant Rules" | "Journals" | "Users" | "Recovery";
  message: string;
  timestamp: string;
};

/** Recent Activity — a live-feeling operational feed across every kind of
 * event this company has generated, not just journals (which get their
 * own dedicated table below). */
export const MOCK_RECENT_ACTIVITY: ActivityEntry[] = [
  { id: "act-1", category: "Import", message: "184 transactions imported from Main Trading Account", timestamp: "2026-07-29 09:14" },
  { id: "act-2", category: "Matching", message: "6 supplier payments auto-matched with 98%+ confidence", timestamp: "2026-07-29 09:16" },
  { id: "act-3", category: "Journals", message: "Journal J-10482 posted to 6100 — Office Supplies", timestamp: "2026-07-29 10:02" },
  { id: "act-4", category: "Merchant Rules", message: "Rule taught: \"NETHERFIELD FRT\" → Netherfield Freight Ltd", timestamp: "2026-07-29 10:31" },
  { id: "act-5", category: "Recovery", message: "Recovery progress crossed 50% for the first time this period", timestamp: "2026-07-29 11:05" },
  { id: "act-6", category: "Users", message: "Priya Shah reviewed 12 items in the Work Queue", timestamp: "2026-07-28 16:40" },
  { id: "act-7", category: "Import", message: "97 transactions imported from Payroll Account", timestamp: "2026-07-28 08:52" },
];
