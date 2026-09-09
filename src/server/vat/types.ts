/**
 * Domain types for the VAT Intelligence & Tax Compliance Platform
 * (Migration Roadmap Module 8). See
 * `supabase/migrations/0015_vat_intelligence_platform.sql`. `VatType`
 * lives on `VatTreatment` itself (Company Management,
 * `server/company-management/types.ts`) — "One Business Object," not a
 * parallel type here.
 */

export type { VatType } from "@/server/company-management/types";
export { VAT_TYPES } from "@/server/company-management/types";

export type VatRateHistoryEntry = {
  id: number;
  vatTreatmentId: number;
  rate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  createdBy: string;
};

export type VatReturnStatus = "Draft" | "Review" | "Approved" | "Submitted";
export type VatSubmissionMethod = "Manual" | "SARS_eFiling";

export type VatReturn = {
  id: number;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  status: VatReturnStatus;
  totalOutputVat: number;
  totalInputVat: number;
  netPayable: number;
  /** Finding #202 — a VAT201-style Box 14 "brought forward" figure: the
   * prior period's own still-outstanding balance (its `netPayable` less
   * whatever `VatPayment`s have already settled it). Disclosure-only —
   * deliberately NOT included in `netPayable` itself, which must stay the
   * period's own Output/Input activity since that alone drives the real
   * settlement journal. See `vat-return-service.ts::computeBroughtForward`. */
  broughtForward: number;
  settlementJournalId: number | null;
  isAmendment: boolean;
  amendedReturnId: number | null;
  sarsReference: string | null;
  submissionMethod: VatSubmissionMethod;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string;
  generatedAt: string;
  generatedBy: string;
};

/** Finding #203 — a real settlement record against one specific
 * `VatReturn`, clearing the VAT Control (2300) liability that
 * `buildVatSettlementJournalLines` posted on Approve. See
 * `vat-payment-service.ts`. */
export type VatPayment = {
  id: number;
  companyId: string;
  vatReturnId: number;
  bankAccountId: number | null;
  paymentDate: string;
  amount: number;
  reference: string;
  notes: string;
  journalId: number | null;
  status: "Posted";
  createdBy: string;
  createdAt: string;
};

export type VatAdjustmentDirection = "Increase" | "Decrease";
export type VatAdjustmentTarget = "VATInput" | "VATOutput";
export type VatAdjustmentStatus = "Draft" | "Approved";

export type VatAdjustment = {
  id: number;
  companyId: string;
  vatReturnId: number | null;
  vatTreatmentId: number | null;
  direction: VatAdjustmentDirection;
  targetAccount: VatAdjustmentTarget;
  amount: number;
  reason: string;
  adjustmentDate: string;
  journalId: number | null;
  status: VatAdjustmentStatus;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
};

/** Exception Intelligence review (see this file's own change history) —
 * `MissingVatNumber`/`IncorrectVatCode`/`DuplicateVatClaim`/
 * `UnexpectedVatPercentage`/`LargeVatAdjustment` are raised automatically
 * (`vat-exception-scan-service.ts`/`vat-adjustment-service.ts`).
 * `VatRateConflict` is now also raised automatically —
 * `vat-intelligence.ts::detectVatRateConflict` resolves each document's
 * OWN effective rate on its OWN date (via the existing, already
 * general-purpose `resolveEffectiveRate`), catching a genuine gap
 * `UnexpectedVatPercentage` doesn't cover (that check compares every
 * document against today's rate only, so a legitimate historical
 * document predating a rate change would otherwise be flagged against
 * the wrong rate).
 *
 * `CrossPeriodVat` remains deliberately dormant, reachable only via a
 * manually-configured VAT Rule's `flag_for_review` action: implementing
 * it correctly would mean "this document's date falls outside the VAT
 * period it's being claimed in," but VAT Returns are computed purely
 * from GL account activity on the VAT Input/Output control accounts by
 * POSTING date (`vat-return-service.ts::computePeriodVat`) — there is no
 * existing link anywhere from a `VatDocument` to "the period it's
 * claimed in." Building one would mean inventing a document-to-period
 * association the accounting model doesn't have, not detecting an
 * existing fact — left dormant until a real one exists. */
export type VatExceptionType =
  | "MissingVatNumber" | "IncorrectVatCode" | "UnexpectedVatPercentage"
  | "LargeVatAdjustment" | "DuplicateVatClaim" | "VatRateConflict" | "CrossPeriodVat";

export type VatExceptionStatus = "Open" | "Resolved" | "Dismissed";

export type VatException = {
  id: number;
  companyId: string;
  exceptionType: VatExceptionType;
  documentType: string;
  documentId: number;
  reason: string;
  evidence: string;
  recommendedAction: string;
  status: VatExceptionStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
};
