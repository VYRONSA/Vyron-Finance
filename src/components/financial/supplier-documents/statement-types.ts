/**
 * SD-3E — the shapes the Supplier Statements screens receive from the server
 * page (taken from the SD-3C/SD-3D services; nothing here is computed in the
 * browser that the server did not already decide).
 */
import type { StatementStatus } from "@/lib/supplier-documents/statement-stages";

export type StatementFinding = {
  code: string;
  severity: "incomplete" | "review";
  message: string;
  lineOrder?: number;
  pageNumber?: number | null;
};

export type StatementHeaderValues = {
  statementDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  currencyCode: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  printedTotalDebits: number | null;
  printedTotalCredits: number | null;
  signConvention: "debit-increases-owed" | "credit-increases-owed";
};

export type StatementLineView = {
  id: number;
  lineOrder: number;
  pageNumber: number | null;
  rowOnPage: number | null;
  transactionDate: string | null;
  referenceText: string | null;
  description: string | null;
  transactionType: string;
  typeSource: string;
  debit: number | null;
  credit: number | null;
  runningBalance: number | null;
  rawText: string | null;
  unresolvedFields: string[];
  isExcluded: boolean;
  exclusionReason: string | null;
  corrected: boolean;
  /** SD-3F — who first wrote the line: the deterministic reader, the AI transcription, or a reviewer. */
  extractedBy?: "reader" | "ai" | "reviewer";
};

export type StatementEventView = { id: number; type: string; detail: Record<string, unknown>; performedBy: string; occurredAt: string };

export type SupplierCandidateView = { supplierId: number; supplierName: string; reason?: string };

export type StatementView = {
  id: number;
  status: StatementStatus;
  statusReason: string;
  sourceType: string;
  documentId: number;
  extractionMethod: string | null;
  supplierId: number | null;
  supplierConfirmed: boolean;
  supplierConfirmedBy: string | null;
  supplierConfirmedAt: string | null;
  supplierMatchTier: string | null;
  supplierCandidates: SupplierCandidateView[];
  supplierNameExtracted: string | null;
  supplierVatExtracted: string | null;
  supplierRegistrationExtracted: string | null;
  accountNumberExtracted: string | null;
  header: StatementHeaderValues;
  extractedHeader: Partial<StatementHeaderValues> | null;
  currencySupported: boolean;
  pageCount: number | null;
  validationStatus: string;
  validationFindings: StatementFinding[];
  warnings: string[];
  manualEntry: boolean;
  duplicateOfStatementId: number | null;
  createdAt: string;
};

export type ReconRunSummaryView = {
  id: number;
  runNumber: number;
  asAt: string;
  statementClosing: number | null;
  precisiaBalance: number | null;
  difference: number | null;
  explained: number | null;
  explainedByReviewer: number | null;
  unexplained: number | null;
  fingerprint: string;
  createdBy: string;
  createdAt: string;
};

export type RefLinkView = { refType: string; refId: number; amount: number | null; date: string | null; number: string | null; note?: string; reason?: string };

export type ReconItemDetailView = {
  order: number;
  statementLineId: number | null;
  statementLineOrder: number | null;
  category: string;
  subStatus: string;
  matchTier: string | null;
  refType: string | null;
  refId: number | null;
  relatedRefs: RefLinkView[];
  suggestions: RefLinkView[];
  statementAmount: number | null;
  precisiaAmount: number | null;
  amountDifference: number | null;
  effect: number;
  explained: boolean;
  explainedByResolutionId: number | null;
  message: string;
};

export type ReconRunDetailView = {
  run: ReconRunSummaryView & { windowFrom: string; windowTo: string; statementOpening: number | null; precisiaBalanceBeforeWindow: number | null; residual: number };
  items: ReconItemDetailView[];
};

export type ResolutionView = {
  id: number;
  action: "manual-link" | "explained" | "revoke";
  statementLineId: number | null;
  refType: string | null;
  refId: number | null;
  revokes: number | null;
  reason: string;
  performedBy: string;
  createdAt: string;
  revoked: boolean;
};
