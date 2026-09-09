# Existing Intelligence Inventory — Phase 10 audit

Written before any Financial Intelligence Engine code was added, per the
phase brief's explicit instruction ("Before writing code, inspect the
existing codebase... Create a written inventory of what already exists.
Do NOT duplicate an existing calculation."). Every rule in
`financial-intelligence-engine.ts` either normalizes one of these
existing systems verbatim, or computes something genuinely new from
already-fetched real data — nothing below was recalculated.

## Already-existing intelligence/analysis systems

| System | File | What it produces | Persisted? |
|---|---|---|---|
| Executive Alerts | `server/reporting/types.ts`, `server/services/executive-intelligence-service.ts` | 10 real threshold detectors (`DecliningCash`, `IncreasingDebtors`, `SlowPayingCustomers`, `SupplierRisk`, `MarginReduction`, `InventoryProblems`, `ComplianceIssues`, `AutomationFailures`, `LargeUnusualTransactions`, `DuplicateTrends`), each with `priority` ("Low"/"Medium"/"High"/"Critical"), `reason`, `evidence`, `recommendedAction` | Yes — `executive_alerts` table, idempotent `raiseAlert` |
| Financial Intelligence (GL-level) | `server/services/financial-intelligence-service.ts` | Largest postings, possible duplicate journals, missing/stale postings, unusual account growth — all GL-transaction-level | No — computed on request |
| Scoring Engine | `server/reporting/scoring-engine.ts` | `financialHealthScore`, `businessRiskScore`, `auditReadinessScore` — transparent point-deduction formulas over real inputs | No |
| Banking Intelligence | `server/banking-rules/banking-intelligence.ts` | Duplicate payments, new merchants, unusual spending, cash-flow impact, suspicious patterns — explicitly documented as deterministic, not ML | No — feeds Banking Exceptions at import/rule-processing time |
| Banking Exceptions | `server/banking-rules/types.ts::BankingException` | 8 real exception types incl. `PossibleDuplicate`, `LargeUnusualPayment`, `UnknownMerchant`, `MissingSupplier`, `UnbalancedAllocation`, `MissingInvoice`, `UnexpectedVAT`, `PeriodConflict` | Yes — `banking_exceptions` table |
| Banking Automation Summary | `server/services/banking-summary-service.ts` | `automationRatePercent`, `exceptionsAwaitingReview`, `unknownMerchantCount`, `duplicateDetectionCount` | No |
| Matching Summary | `server/services/matching-summary-service.ts` | `matchingAccuracyPercent`, `manualQueueCount`, `duplicateRiskCount`, `ruleSuccessRatePercent` | No |
| Transaction Explorer Summary | `server/services/transaction-explorer-service.ts::getSummary` | `totalTransactions`, `matched`, `unmatched`, `awaitingReview`, DB-computed via `fn_transaction_explorer_summary` | No |
| Customer/Supplier Aging | `server/shared/aging.ts::computeAgingBuckets` | Real current/30/60/90/120+ day buckets, shared by both modules | No |
| VAT Summary | `server/services/vat-summary-service.ts` | `vatPayable`, `vatReceivable`, `draftReturnCount`, `openExceptionCount`, `complianceScorePercent` | No |
| VAT Exceptions | `server/vat/types.ts::VatException` | 7 real exception types with severity-weighted compliance scoring | Yes |
| Sales/Purchasing Summaries | `sales-summary-service.ts`, `purchasing-summary-service.ts` | `outstandingDebtors`/`outstandingCreditors`, top customers/suppliers | No |
| Audit Findings | `server/audit/types.ts::AuditFinding` | `severity: "Low"\|"Medium"\|"High"\|"Critical"` (same scale as Executive Alerts) | Yes |
| Notifications | `server/automation/types.ts` | `NotificationSeverity: "info"\|"warning"\|"critical"` | Yes |
| Operations Events | `server/operations/types.ts` | `EventSeverity: "info"\|"warning"\|"high"\|"critical"` | Yes |
| Opening Balances | `server/services/opening-balance-service.ts::listOpeningBalanceEntries` | Real entry list — presence check only, no new calculation | Yes |

## Existing severity conventions found (why `FindingSeverity` reuses one instead of inventing a fifth)

- `ExecutiveAlertPriority` = `"Low" | "Medium" | "High" | "Critical"` (`server/reporting/types.ts`)
- `AuditFindingSeverity` = `"Low" | "Medium" | "High" | "Critical"` (`server/audit/types.ts`) — **identical** to the above
- `NotificationSeverity` = `"info" | "warning" | "critical"` (`server/automation/types.ts`)
- `EventSeverity` = `"info" | "warning" | "high" | "critical"` (`server/operations/types.ts`)

Two independent, already-real systems (Executive Alerts, Audit Findings)
already converged on the same four-value Title-Case scale for exactly
this kind of business-level finding — `Finding.severity` reuses that
scale directly rather than introducing a fifth. The phase brief's own
suggested wording (Critical/Warning/Attention/Info) is honoured as a
**presentation label only** — `FINDING_SEVERITY_LABEL` in `types.ts`.

## What Finding actually adds (not a duplicate of any of the above)

1. **One common shape** across all of the systems above, so the
   Executive Dashboard can render "3 items require attention" without
   knowing whether the underlying signal came from Banking Exceptions,
   Executive Alerts, or a fresh VAT check.
2. **New categories the existing systems don't cover as findings**:
   Data Quality/Setup (no bank account, no bank transactions, opening
   balances never entered, no customers, no suppliers, no financial
   year configured), Banking-Exceptions-as-findings, Customer/Supplier
   aging-based overdue findings, and direct VAT-liability/return-status
   findings — none of these exist as a "finding" anywhere today, only as
   raw counts/badges scattered across different pages.
3. **No new detection logic.** Every new rule in
   `financial-intelligence-engine.ts` is a presence/threshold check
   (`count > 0`, `list.length === 0`) over data another real service
   already computed — never a re-derivation of an accounting figure.

## Explicitly NOT built (per the brief's own "don't force it" instructions)

- **"Large outstanding customer/supplier balance"** — no existing
  threshold for "large" exists anywhere in the codebase (confirmed by
  search). Per section 11's explicit instruction ("Do NOT invent
  thresholds... don't create arbitrary thresholds in this phase"), this
  finding was intentionally omitted. "Overdue" findings ARE included,
  using the aging-bucket boundary the Scoring Engine's own
  `BusinessRiskInputs.overdueDebtorsCount` comment already documents as
  the real convention ("debtors aged past 90 days" = the `days120Plus`
  bucket, despite its name).
- **Any new VAT/accounting calculation.** VAT findings only ever read
  `VatDashboardSummary`'s already-computed fields.
- **Persistence.** `Finding` is never written to the database — every
  Finding is computed on request from already-fetched or freshly-fetched
  existing-service data, per section 2's explicit instruction.
