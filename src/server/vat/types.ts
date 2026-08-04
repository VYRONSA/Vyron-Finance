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
