/**
 * Preview Mode seed data for the VAT Intelligence & Tax Compliance
 * Platform (Migration Roadmap Module 8). Field shapes match the real
 * domain types exactly.
 */

import type { VatAdjustment, VatException, VatRateHistoryEntry, VatReturn } from "@/server/vat/types";
import type { VatDocument } from "@/server/vat/vat-intelligence";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_VAT_RETURNS: VatReturn[] = [
  {
    id: 1, companyId: COMPANY_ID, periodStart: "2026-04-01", periodEnd: "2026-05-31", status: "Submitted",
    totalOutputVat: 42500, totalInputVat: 18200, netPayable: 24300, settlementJournalId: 301,
    isAmendment: false, amendedReturnId: null, sarsReference: "VAT201-2026-04", submissionMethod: "Manual",
    submittedAt: "2026-06-25T09:00:00Z", approvedBy: "T. Naidoo", approvedAt: "2026-06-20T09:00:00Z",
    notes: "", generatedAt: "2026-06-15T09:00:00Z", generatedBy: "System",
  },
  {
    id: 2, companyId: COMPANY_ID, periodStart: "2026-06-01", periodEnd: "2026-07-31", status: "Draft",
    totalOutputVat: 38900, totalInputVat: 21100, netPayable: 17800, settlementJournalId: null,
    isAmendment: false, amendedReturnId: null, sarsReference: null, submissionMethod: "Manual",
    submittedAt: null, approvedBy: null, approvedAt: null,
    notes: "Awaiting review of two large purchase bills before approval.", generatedAt: "2026-08-01T09:00:00Z", generatedBy: "System",
  },
];

export const MOCK_VAT_ADJUSTMENTS: VatAdjustment[] = [
  {
    id: 1, companyId: COMPANY_ID, vatReturnId: 1, vatTreatmentId: 1, direction: "Decrease", targetAccount: "VATInput",
    amount: 850, reason: "Correction — VAT claimed twice on invoice INV-3381.", adjustmentDate: "2026-05-20",
    journalId: 302, status: "Approved", createdBy: "T. Naidoo", createdAt: "2026-05-20T09:00:00Z",
    approvedBy: "T. Naidoo", approvedAt: "2026-05-20T10:00:00Z",
  },
];

export const MOCK_VAT_EXCEPTIONS: VatException[] = [
  {
    id: 1, companyId: COMPANY_ID, exceptionType: "MissingVatNumber", documentType: "Supplier Bill", documentId: 501,
    reason: "Supplier Bill #501 from Unregistered Cleaning Co claims VAT but no VAT number is on file.",
    evidence: "VAT amount of 240.00 recorded with no party VAT registration number.",
    recommendedAction: "Confirm the party's VAT registration number before this document is included in a VAT Return.",
    status: "Open", resolvedBy: null, resolvedAt: null, resolutionNote: null, createdAt: "2026-08-01T09:00:00Z",
  },
  {
    id: 2, companyId: COMPANY_ID, exceptionType: "UnexpectedVatPercentage", documentType: "Supplier Bill", documentId: 498,
    reason: "Supplier Bill #498 — VAT amount doesn't reconcile with the 15% rate for \"Standard Rated\".",
    evidence: "Expected VAT of 130.43 on a gross of 1000.00 at 15%, but 95.00 is recorded.",
    recommendedAction: "Recalculate this document's VAT amount, or confirm the correct rate was in effect on its date.",
    status: "Open", resolvedBy: null, resolvedAt: null, resolutionNote: null, createdAt: "2026-07-30T09:00:00Z",
  },
  {
    id: 3, companyId: COMPANY_ID, exceptionType: "DuplicateVatClaim", documentType: "Supplier Bill", documentId: 496,
    reason: "Possible duplicate VAT claim: two Supplier Bill documents from Netherfield Freight Ltd for the same amount within 5 days.",
    evidence: "Documents #496 and #500 share the same party, gross amount (4200.00), and VAT amount (547.83).",
    recommendedAction: "Confirm both documents are genuinely separate transactions before claiming VAT on both.",
    status: "Resolved", resolvedBy: "T. Naidoo", resolvedAt: "2026-07-31T09:00:00Z",
    resolutionNote: "Confirmed as two genuinely separate freight runs — not a duplicate.", createdAt: "2026-07-29T09:00:00Z",
  },
];

export const MOCK_VAT_RATE_HISTORY: VatRateHistoryEntry[] = [
  { id: 1, vatTreatmentId: 1, rate: 14, effectiveFrom: "2018-01-01", effectiveTo: "2018-03-31", createdAt: "2025-01-14T09:00:00Z", createdBy: "System" },
  { id: 2, vatTreatmentId: 1, rate: 15, effectiveFrom: "2018-04-01", effectiveTo: null, createdAt: "2025-01-14T09:00:00Z", createdBy: "System" },
];

export const MOCK_VAT_DOCUMENTS: VatDocument[] = [
  { id: 501, documentType: "Supplier Bill", partyId: 4, partyName: "Unregistered Cleaning Co", partyVatNumber: null, date: "2026-08-01", vatTreatmentCode: "Standard Rated", vatType: "Standard", grossAmount: 1840, vatAmount: 240 },
  { id: 498, documentType: "Supplier Bill", partyId: 3, partyName: "Harrow Print & Design", partyVatNumber: "4198765432", date: "2026-07-30", vatTreatmentCode: "Standard Rated", vatType: "Standard", grossAmount: 1000, vatAmount: 95 },
  { id: 1008, documentType: "Customer Invoice", partyId: 1, partyName: "Meridian Traders", partyVatNumber: null, date: "2026-08-01", vatTreatmentCode: "Standard Rated", vatType: "Standard", grossAmount: 9775, vatAmount: 1275 },
];
