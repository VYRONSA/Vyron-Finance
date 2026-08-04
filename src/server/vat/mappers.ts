import type {
  VatAdjustment,
  VatAdjustmentDirection,
  VatAdjustmentStatus,
  VatAdjustmentTarget,
  VatException,
  VatExceptionStatus,
  VatExceptionType,
  VatRateHistoryEntry,
  VatReturn,
  VatReturnStatus,
  VatSubmissionMethod,
} from "./types";

export type VatRateHistoryRow = {
  id: number;
  vat_treatment_id: number;
  rate: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  created_by: string;
};

export function vatRateHistoryFromRow(row: VatRateHistoryRow): VatRateHistoryEntry {
  return {
    id: row.id,
    vatTreatmentId: row.vat_treatment_id,
    rate: Number(row.rate),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export type VatReturnRow = {
  id: number;
  company_id: string;
  period_start: string;
  period_end: string;
  status: string;
  total_output_vat: number;
  total_input_vat: number;
  net_payable: number;
  settlement_journal_id: number | null;
  is_amendment: boolean;
  amended_return_id: number | null;
  sars_reference: string | null;
  submission_method: string;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  notes: string;
  generated_at: string;
  generated_by: string;
};

export function vatReturnFromRow(row: VatReturnRow): VatReturn {
  return {
    id: row.id,
    companyId: row.company_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status as VatReturnStatus,
    totalOutputVat: Number(row.total_output_vat),
    totalInputVat: Number(row.total_input_vat),
    netPayable: Number(row.net_payable),
    settlementJournalId: row.settlement_journal_id,
    isAmendment: row.is_amendment,
    amendedReturnId: row.amended_return_id,
    sarsReference: row.sars_reference,
    submissionMethod: row.submission_method as VatSubmissionMethod,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    notes: row.notes,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
  };
}

export type VatAdjustmentRow = {
  id: number;
  company_id: string;
  vat_return_id: number | null;
  vat_treatment_id: number | null;
  direction: string;
  target_account: string;
  amount: number;
  reason: string;
  adjustment_date: string;
  journal_id: number | null;
  status: string;
  created_by: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
};

export function vatAdjustmentFromRow(row: VatAdjustmentRow): VatAdjustment {
  return {
    id: row.id,
    companyId: row.company_id,
    vatReturnId: row.vat_return_id,
    vatTreatmentId: row.vat_treatment_id,
    direction: row.direction as VatAdjustmentDirection,
    targetAccount: row.target_account as VatAdjustmentTarget,
    amount: Number(row.amount),
    reason: row.reason,
    adjustmentDate: row.adjustment_date,
    journalId: row.journal_id,
    status: row.status as VatAdjustmentStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
  };
}

export type VatExceptionRow = {
  id: number;
  company_id: string;
  exception_type: string;
  document_type: string;
  document_id: number;
  reason: string;
  evidence: string;
  recommended_action: string;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

export function vatExceptionFromRow(row: VatExceptionRow): VatException {
  return {
    id: row.id,
    companyId: row.company_id,
    exceptionType: row.exception_type as VatExceptionType,
    documentType: row.document_type,
    documentId: row.document_id,
    reason: row.reason,
    evidence: row.evidence,
    recommendedAction: row.recommended_action,
    status: row.status as VatExceptionStatus,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
  };
}
