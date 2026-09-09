/**
 * Domain types for the VYRON Financial Intelligence Engine (Phase 10).
 *
 * This is a NORMALIZATION layer, not a new detector. The codebase already
 * has several independent, real signal systems — Executive Alerts
 * (`server/reporting/types.ts::ExecutiveAlert`, 10 threshold-based
 * detectors in `executive-intelligence-service.ts`), Banking Exceptions
 * (`server/banking-rules/types.ts::BankingException`), VAT compliance
 * (`vat-summary-service.ts`), Transaction Explorer's own summary, and the
 * Aging buckets shared by Customer/Supplier Management
 * (`server/shared/aging.ts`). `executive-intelligence-service.ts` already
 * established the pattern this file follows at a smaller scope
 * (`normalizeFinancialIntelligence` turns `FinancialIntelligenceReport`'s
 * four bespoke shapes into one common `NormalizedIntelligenceSignal`
 * shape) — `Finding` is the same idea, generalised across every real
 * signal source in the app, not a competing engine.
 *
 * `FindingSeverity` deliberately reuses `ExecutiveAlertPriority`'s exact
 * four values ("Low" | "Medium" | "High" | "Critical") rather than the
 * PRB brief's own illustrative INFO/ATTENTION/WARNING/CRITICAL example —
 * the brief itself says "first inspect existing severity conventions...
 * if the application already has a severity type, reuse it," and this
 * codebase already has one, used identically by both Executive Alerts
 * AND Audit Findings (`server/audit/types.ts::AuditFindingSeverity` —
 * the exact same four values). Inventing a second, differently-worded
 * scale for Finding would be the "competing severity definition" the
 * brief explicitly warns against. The brief's own suggested wording
 * (Critical/Warning/Attention) is still honoured — see
 * `FINDING_SEVERITY_LABEL` below — but only as a presentation-layer
 * label over the real, reused value, the same pattern this session has
 * used for every other "don't overwhelm with raw terminology" ask
 * (Banking Exceptions' `EXCEPTION_LABEL`, Transaction Intelligence's
 * `REVIEW_GROUP_LABELS`).
 */

export type FindingSeverity = "Low" | "Medium" | "High" | "Critical";

/** Ordered most-severe first — the order `buildFinancialIntelligenceSummary`
 * sorts findings by, and the order the Executive Dashboard's "VYRON
 * Intelligence" section renders them in. */
export const FINDING_SEVERITY_ORDER: FindingSeverity[] = ["Critical", "High", "Medium", "Low"];

/** Presentation-only label — never used as the underlying data value.
 * Matches the brief's own section 9 dashboard example wording exactly
 * (Critical / Warning / Attention) without renaming the real
 * `FindingSeverity` values it's derived from. */
export const FINDING_SEVERITY_LABEL: Record<FindingSeverity, string> = {
  Critical: "Critical",
  High: "Warning",
  Medium: "Attention",
  Low: "Attention",
};

/**
 * Only categories the existing codebase can currently back with real
 * data — see FINDINGS_INVENTORY.md alongside this file for the full
 * audit. "Profitability"/"Compliance"/"Operations"/"Cash Flow" are
 * populated entirely by NORMALIZING already-persisted Executive Alerts
 * (zero new calculation); every other category is computed fresh from
 * already-fetched real summaries.
 */
export type FindingCategory =
  | "CashFlow"
  | "Banking"
  | "Transactions"
  | "Customers"
  | "Suppliers"
  | "VAT"
  | "Profitability"
  | "Compliance"
  | "Operations"
  | "DataQuality"
  // Phase 13 — General Ledger Intelligence: possible duplicate journals,
  // stale/missing postings, unusual account growth (all wrapped from the
  // existing financial-intelligence-service.ts, not a new detector).
  | "GeneralLedger";

export const FINDING_CATEGORY_LABEL: Record<FindingCategory, string> = {
  CashFlow: "Cash Flow",
  Banking: "Banking",
  Transactions: "Transactions",
  Customers: "Customers",
  Suppliers: "Suppliers",
  VAT: "VAT",
  Profitability: "Profitability",
  Compliance: "Compliance",
  Operations: "Operations",
  DataQuality: "Data Quality",
  GeneralLedger: "General Ledger",
};

/**
 * Phase 13, section 14 — the Intelligence Centre must be able to
 * distinguish Financial Risk / Operational Attention / Data Quality.
 * This is a presentation-only grouping of the real categories above —
 * it introduces no new severity system and no new finding.
 */
export type FindingMetaGroup = "Financial Risk" | "Operational Attention" | "Data Quality";

export const FINDING_META_GROUP: Record<FindingCategory, FindingMetaGroup> = {
  CashFlow: "Financial Risk",
  Customers: "Financial Risk",
  Suppliers: "Financial Risk",
  VAT: "Financial Risk",
  Profitability: "Financial Risk",
  Compliance: "Financial Risk",
  GeneralLedger: "Financial Risk",
  Banking: "Operational Attention",
  Transactions: "Operational Attention",
  Operations: "Operational Attention",
  DataQuality: "Data Quality",
};

/**
 * "Do NOT use AI confidence scores. Instead, distinguish: Deterministic /
 * Derived / Existing Intelligence Signal." (brief, section 7) —
 *   - Deterministic: computed directly from a raw, real value this rule
 *     read itself (e.g. counting open exceptions).
 *   - Derived: computed from an already-aggregated real summary another
 *     service produced (e.g. `VatDashboardSummary.vatPayable`).
 *   - ExistingIntelligenceSignal: this Finding is a normalized wrapper
 *     around an already-existing, independently-computed signal
 *     (`ExecutiveAlert`, `BankingException`, `NormalizedIntelligenceSignal`)
 *     — nothing was recalculated.
 */
export type FindingSource = "Deterministic" | "Derived" | "ExistingIntelligenceSignal";

/**
 * One VYRON Intelligence finding. Deliberately NOT persisted — the brief:
 * "Do not store findings in the database yet unless the existing
 * architecture already requires persistence. Prefer deterministic
 * computation first." `companyId`/`createdAt` are populated only when a
 * real one exists (e.g. wrapping an already-persisted `ExecutiveAlert`)
 * — never a fabricated "now" timestamp standing in for a real audit
 * trail entry that doesn't exist for a freshly-computed finding.
 */
export type Finding = {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  /** Answers "what made VYRON say this" — always a reference to a real,
   * already-computed value, never a vague characterisation. */
  evidence: string;
  /** `null` means genuinely informational — no meaningful next step
   * exists yet (brief, section 6: "If there is no meaningful action:
   * mark it informational"). */
  recommendedAction: string | null;
  /** Route to the existing workflow the recommended action points at,
   * when one exists — never a fabricated route. */
  actionHref: string | null;
  source: FindingSource;
  companyId?: string;
  createdAt?: string;
};

/**
 * Phase 14 — Business Situations. A Finding means "VYRON detected this
 * specific condition." A BusinessSituation means "several EXISTING
 * findings together indicate a broader situation" — see
 * `business-situation-engine.ts`'s own docstring for the exhaustive list
 * of the only relationships this codebase currently proves. Only
 * categories at least one real rule actually produces are declared here
 * (brief, section 6: "Do not create categories that have no current
 * use") — extend this union only when a new rule genuinely needs one.
 */
export type BusinessSituationCategory = "CashPressure" | "WorkingCapital" | "TransactionRisk";

export const BUSINESS_SITUATION_CATEGORY_LABEL: Record<BusinessSituationCategory, string> = {
  CashPressure: "Cash Pressure",
  WorkingCapital: "Working Capital",
  TransactionRisk: "Transaction Risk",
};

/**
 * Deliberately NOT persisted, same as `Finding` — recomputed on every
 * request from the current `Finding[]`. No `confidence`/`source` field:
 * every situation is, by construction, "correlated from existing
 * findings" — stating that identical fact on every instance would add
 * no information a reader doesn't already get from the type's own name
 * (brief, section 2: "Do not create unnecessary fields").
 */
export type BusinessSituation = {
  id: string;
  title: string;
  /** Honest, non-causal language only — "VYRON identified related
   * conditions," never "X is causing Y" (brief, sections 5 and 13). */
  summary: string;
  /** Never higher than the most severe contributing finding — see
   * `business-situation-engine.ts::maxSeverity`'s own docstring for the
   * exact, documented rule (brief, section 8). */
  severity: FindingSeverity;
  category: BusinessSituationCategory;
  /** The real evidence strings from each contributing finding, in the
   * same order as `contributingFindings` — never a synthesized or
   * paraphrased claim. */
  evidence: string[];
  /** The actual `Finding` objects this situation was built from — never
   * merged or deleted (brief, section 3: "the findings remain
   * independently available"). Lets the UI/VYRON Ask drill down from a
   * situation to the exact findings that produced it. */
  contributingFindings: Finding[];
  /** Deduplicated by `actionHref` across every contributing finding — no
   * new action is ever invented for a situation (brief, section 9). */
  recommendedActions: { label: string; href: string }[];
};
