/**
 * SD-3E — how supplier statements and their reconciliations are described in
 * the interface: inbox stages, status and category labels, the "what is
 * stopping this" list, and which reconciliation actions make sense for an
 * item.
 *
 * Presentation only. Every action is enforced again by the API (permission
 * checked before any lookup) and by the database (0114/0115 guards); hiding a
 * control here is never what prevents it.
 */

export type StatementStatus = "Queued" | "Processing" | "ManualEntry" | "NeedsReview" | "Ready" | "Reconciled" | "Duplicate" | "Failed" | "Rejected";

export type StatementStage = "inbox" | "to-enter" | "needs-review" | "ready" | "reconciled" | "closed";

export const STATEMENT_STAGES: { key: StatementStage; label: string; description: string }[] = [
  { key: "inbox", label: "Inbox", description: "Received and waiting to be read. Reading happens after the upload, so you can leave the page." },
  { key: "to-enter", label: "To enter", description: "Scanned statements and files that could not be read. Enter them by hand from the original." },
  { key: "needs-review", label: "Needs review", description: "Read and checked. Correct anything read wrongly, confirm the supplier, then mark it ready." },
  { key: "ready", label: "Ready", description: "Checked, supplier confirmed — ready to be reconciled against the supplier ledger." },
  { key: "reconciled", label: "Reconciled", description: "Reconciled at least once. Review the differences, explain or link them, and reconcile again." },
  { key: "closed", label: "Duplicates & rejected", description: "Copies of statements already received, and statements that were rejected. Kept, never deleted." },
];

export function statementStage(status: StatementStatus): StatementStage {
  switch (status) {
    case "Queued":
    case "Processing":
      return "inbox";
    case "ManualEntry":
    case "Failed":
      return "to-enter";
    case "NeedsReview":
      return "needs-review";
    case "Ready":
      return "ready";
    case "Reconciled":
      return "reconciled";
    default:
      return "closed";
  }
}

export const STATEMENT_STATUS_LABEL: Record<StatementStatus, string> = {
  Queued: "Waiting to be read",
  Processing: "Being read",
  ManualEntry: "Entering by hand",
  NeedsReview: "Needs review",
  Ready: "Ready to reconcile",
  Reconciled: "Reconciled",
  Duplicate: "Duplicate",
  Failed: "Could not be read",
  Rejected: "Rejected",
};

export const STATEMENT_STATUS_TONE: Record<StatementStatus, "good" | "warn" | "info" | "danger" | "muted"> = {
  Queued: "muted",
  Processing: "info",
  ManualEntry: "warn",
  NeedsReview: "warn",
  Ready: "good",
  Reconciled: "good",
  Duplicate: "muted",
  Failed: "danger",
  Rejected: "muted",
};

export const SOURCE_LABEL: Record<string, string> = {
  pdf: "PDF",
  "pdf-text": "PDF",
  "pdf-scanned": "Scanned PDF",
  "pdf-mixed": "PDF (some pages scanned)",
  image: "Image",
  csv: "CSV",
  xlsx: "Excel",
};

export const MATCH_TIER_LABEL: Record<string, string> = {
  vat: "proposed from the VAT number",
  registration: "proposed from the registration number",
  "supplier-code": "proposed from the supplier code",
  "account-number": "proposed from our account number",
  "exact-name": "proposed from the name",
  "normalised-name": "proposed from the name",
  learned: "proposed from earlier documents",
  manual: "chosen by a reviewer",
};

export const TRANSACTION_TYPES = ["invoice", "credit-note", "debit-note", "payment", "interest", "adjustment", "other", "unknown"] as const;
export const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  invoice: "Invoice",
  "credit-note": "Credit note",
  "debit-note": "Debit note",
  payment: "Payment",
  opening: "Opening",
  interest: "Interest",
  adjustment: "Adjustment",
  other: "Other",
  unknown: "Not stated",
};

export const EXCLUSION_LABEL: Record<string, string> = {
  "brought-forward": "Brought forward",
  "carried-forward": "Carried forward",
  "page-total": "Page total",
  subtotal: "Sub-total",
  "period-total": "Period total",
  "statement-total": "Statement totals",
  "closing-balance": "Closing balance",
};

export const UNRESOLVED_LABEL: Record<string, string> = {
  transaction_date: "date",
  reference_text: "reference",
  debit: "amount",
  credit: "amount",
  running_balance: "balance",
  transaction_type: "type",
};

export type StatementReadiness = {
  status: StatementStatus;
  validationStatus: string;
  supplierId: number | null;
  supplierConfirmed: boolean;
  currencySupported: boolean;
  /** Unread values on invoice, debit-note, credit-note or unknown-type lines
   * (payments are out of scope and never block). */
  unreadLines: number;
  statementDate: string | null;
};

/** Plain-language reasons a statement in review cannot be marked ready yet
 * (the database refuses the same things). */
export function readinessBlockers(s: StatementReadiness): string[] {
  const out: string[] = [];
  if (s.validationStatus === "Pending") out.push("It has not been checked since the last change.");
  if (s.validationStatus === "Incomplete") out.push("The statement does not add up yet — see the checks below.");
  if (s.unreadLines > 0) out.push(`${s.unreadLines} line${s.unreadLines === 1 ? " has a value" : "s have values"} that could not be read reliably.`);
  if (!s.statementDate) out.push("The statement date is missing.");
  if (s.supplierId === null) out.push("Choose the supplier this statement is from.");
  else if (!s.supplierConfirmed) out.push("Confirm the supplier. A proposed match — even by VAT number — is never used on its own.");
  if (!s.currencySupported) out.push("Unsupported currency — manual review required. Only the company's base currency can be reconciled.");
  return out;
}

// ---------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------

/** Display order. "Credit Note", "Payment" and "Opening Balance Difference"
 * appear only in SD-3D balance runs (before SD-3G). */
export const CATEGORY_ORDER = [
  "Opening Balance Difference",
  "Potential Duplicate",
  "Unclassified",
  "Missing in PRECISIA",
  "Missing on Statement",
  "Amount Difference",
  "Credit Note",
  "Payment",
  "Matched",
  "Out of Scope",
] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  "Out of Scope": "Out of Scope — Payment",
};

/** SD-3G: the basis of a document reconciliation run. */
export const DOCUMENT_BASIS = "supplier-statement-documents";

export const CATEGORY_TONE: Record<string, "good" | "warn" | "info" | "danger" | "muted"> = {
  Matched: "good",
  "Amount Difference": "warn",
  "Missing in PRECISIA": "warn",
  "Missing on Statement": "warn",
  "Potential Duplicate": "danger",
  "Credit Note": "info",
  Payment: "info",
  Unclassified: "danger",
  "Opening Balance Difference": "danger",
  "Out of Scope": "muted",
};

export const SUB_STATUS_LABEL: Record<string, string> = {
  posted: "Posted in PRECISIA",
  "not-posted": "In PRECISIA — not posted",
  "captured-not-converted": "Captured — not yet a bill",
  "same-number-different-amount": "Same document number, different amount",
  "precisia-duplicate-number": "Same document number twice in PRECISIA",
  exact: "Exact reference",
  normalised: "Same reference, different punctuation",
  manual: "Linked by a reviewer",
  "payment-evidence": "Amount, date and reference",
  difference: "Amounts differ",
  "vat-hint": "Difference looks like VAT",
  "not-captured": "Not captured",
  "captured-draft": "Captured — draft",
  "imported-not-posted": "Imported — not posted",
  "in-period": "In the period",
  timing: "Timing (near the statement date)",
  payment: "Payment",
  "payment-timing": "Payment — timing",
  "opening-balance-entry": "Opening balance entry",
  "statement-repeat": "Printed twice on the statement",
  "multiple-precisia": "Several possible PRECISIA records",
  "double-recorded-payment": "Payment recorded twice in PRECISIA",
  matched: "Matched",
  "amount-difference": "Amounts differ",
  "missing-on-statement": "Not on the statement",
  suggested: "Possible match suggested",
  unmatched: "Not in PRECISIA",
  interest: "Interest",
  adjustment: "Adjustment",
  other: "Other",
  "unknown-credit": "Credit of unknown type",
  "manual-link-unavailable": "Linked record unavailable",
  opening: "Opening balance",
};

export const REF_TYPE_LABEL: Record<string, string> = {
  bill: "Bill",
  "credit-note": "Credit note",
  "debit-note": "Debit note",
  "supplier-payment": "Supplier payment",
  "bank-transaction": "Bank payment",
  "opening-balance": "Opening balance",
  capture: "Captured invoice",
  "unposted-bill": "Unposted bill",
};

/** SD-3G: a manual link or an explanation names a supplier DOCUMENT only. */
export const LINKABLE_REF_TYPES = new Set(["bill", "credit-note", "debit-note"]);

export const RECON_TIER_LABEL: Record<string, string> = {
  manual: "linked by a reviewer",
  exact: "exact reference",
  normalised: "same reference, different punctuation",
  "zero-padded": "same number, zero-padded on the statement",
  "payment-evidence": "amount, date and reference",
};

export type ReconItemView = {
  order: number;
  statementLineId: number | null;
  category: string;
  subStatus: string;
  refType: string | null;
  refId: number | null;
  relatedRefs: { refType: string; refId: number }[];
  explained: boolean;
  explainedByResolutionId: number | null;
};

/** What an "Explain" decision should name for an item: its statement line,
 * the opening difference, or the PRECISIA record it is about. */
export function explanationTarget(item: ReconItemView): { statementLineId?: number; refType?: string; refId?: number } | null {
  if (item.category === "Out of Scope") return null; // payments are not reconciled
  if (item.statementLineId !== null) return { statementLineId: item.statementLineId };
  if (item.category === "Opening Balance Difference") return { refType: "opening-difference" };
  if (item.refType && item.refId !== null && LINKABLE_REF_TYPES.has(item.refType)) return { refType: item.refType, refId: item.refId };
  const related = item.relatedRefs.find((r) => LINKABLE_REF_TYPES.has(r.refType));
  return related ? { refType: related.refType, refId: related.refId } : null;
}

/** A statement line that is not matched can be linked by hand. */
export function canLinkItem(item: ReconItemView): boolean {
  if (item.statementLineId === null) return false;
  if (item.category === "Out of Scope") return false;
  if (item.category === "Matched") return false;
  if (["Credit Note", "Payment"].includes(item.category) && ["matched", "amount-difference", "timing"].includes(item.subStatus)) return false;
  if (item.category === "Amount Difference") return false;
  return true;
}

export const EVENT_LABEL: Record<string, string> = {
  Uploaded: "Uploaded",
  DuplicateEvaluated: "Duplicate check",
  ProcessingStarted: "Reading started",
  Extracted: "Read",
  ExtractionFailed: "Could not be read",
  AiExtractionSkipped: "Automatic reading off",
  AiExtractionRefused: "Automatic reading not attempted",
  AiExtracted: "Read by AI (check against the original)",
  AiExtractionFailed: "Automatic reading failed",
  Reprocessed: "Read again with the current reader",
  ManualEntryRequired: "Needs entering by hand",
  ValidationEvaluated: "Checked",
  SupplierProposed: "Supplier proposed",
  SupplierConfirmed: "Supplier confirmed",
  SupplierUnconfirmed: "Supplier confirmation removed",
  SupplierAccountNumberSaved: "Account number saved on supplier",
  FieldCorrected: "Details corrected",
  LineCorrected: "Lines corrected",
  LineAdded: "Line added",
  LineRemoved: "Line removed",
  ManualEntryStarted: "Entering by hand",
  SubmittedForReview: "Submitted for review",
  MarkedReady: "Marked ready",
  Reopened: "Reopened for review",
  Rejected: "Rejected",
  ProcessingRequeued: "Queued to be read again",
  ReconciliationRun: "Reconciled",
  ResolutionRecorded: "Decision recorded",
  ResolutionRevoked: "Decision withdrawn",
};

/** A short, content-free summary of an event's detail (ids and counts only). */
export function statementEventSummary(type: string, detail: Record<string, unknown>): string | null {
  const n = (k: string) => (typeof detail[k] === "number" ? (detail[k] as number) : null);
  switch (type) {
    case "Extracted":
    case "AiExtracted":
      return n("transactions") !== null ? `${n("transactions")} transactions${n("unreadLines") ? `, ${n("unreadLines")} with unread values` : ""}` : null;
    case "AiExtractionRefused":
      return detail.decision === "circuit_open" ? "paused after provider failures" : detail.decision === "daily_cap" ? "daily budget used" : null;
    case "ValidationEvaluated":
      return typeof detail.status === "string" ? String(detail.status) : null;
    case "ReconciliationRun":
      return n("runNumber") !== null ? `run ${n("runNumber")}` : null;
    case "ExtractionFailed":
    case "AiExtractionFailed":
      return typeof detail.category === "string" ? String(detail.category) : null;
    case "FieldCorrected":
      return Array.isArray(detail.fields) ? `${(detail.fields as unknown[]).length} field(s)` : null;
    case "Rejected":
      return typeof detail.reason === "string" ? String(detail.reason) : null;
    default:
      return null;
  }
}
