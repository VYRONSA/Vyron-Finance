/**
 * SD-2 — the shape of one capture as the review screen receives it from the
 * server page. Plain, serialisable, camelCase; built by
 * `app/company/[companyId]/supplier-documents/invoice-capture/[captureId]/page.tsx`.
 */
import type { CaptureStatus } from "@/server/supplier-invoice-capture/types";
import type { CaptureStage } from "@/lib/supplier-documents/capture-stages";

export type ReviewFinding = { code: string; severity: "blocking" | "review"; message: string; lineIndex?: number };

export type ReviewHeader = {
  documentType: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  orderReference: string | null;
  currencyCode: string | null;
  subtotal: number | null;
  discountTotal: number | null;
  vatAmount: number | null;
  total: number | null;
};

export type ReviewLine = {
  lineOrder: number;
  description: string;
  supplierSku: string | null;
  quantity: number | null;
  uom: string | null;
  packDescription: string | null;
  unitPrice: number | null;
  discount: number | null;
  vatRatePercent: number | null;
  vatAmount: number | null;
  lineTotal: number | null;
  glAccountSuggested: string | null;
  glAccountSource: string | null;
  vatCodeSuggested: string | null;
  vatCodeSource: string | null;
  glAccountConfirmed: string | null;
  vatCodeConfirmed: string | null;
  isExcluded: boolean;
};

export type ReviewEvent = { id: number; eventType: string; detail: Record<string, unknown>; performedBy: string; occurredAt: string };

export type SupplierCandidate = { supplierId: number; name: string; score?: number; reason?: string };

export type ReviewCapture = {
  id: number;
  status: CaptureStatus;
  stage: CaptureStage;
  manualEntry: boolean;
  header: ReviewHeader;
  /** What the document was read as, when it was read (null for a manual entry). */
  extracted: (ReviewHeader & { supplierName: string | null }) | null;
  extractedLines: { description: string | null; quantity: number | null; unitPrice: number | null; vatAmount: number | null; lineTotal: number | null }[] | null;
  supplierNameExtracted: string | null;
  supplierVatNumberExtracted: string | null;
  supplierRegistrationNumberExtracted: string | null;
  supplierId: number | null;
  supplierMatchTier: string | null;
  supplierCandidates: SupplierCandidate[];
  validationStatus: string;
  validationFindings: ReviewFinding[];
  validatedAt: string | null;
  duplicateStatus: string;
  duplicateReason: string;
  duplicateOfCaptureId: number | null;
  duplicateOfBillId: number | null;
  lastErrorMessage: string | null;
  modelConfidence: number | null;
  receivedAt: string;
  uploadedBy: string;
  convertedAt: string | null;
  convertedBy: string | null;
  lines: ReviewLine[];
  events: ReviewEvent[];
  document: { id: number; filename: string; mimeType: string; sizeBytes: number; uploadedAt: string } | null;
  bill: { id: number; invoiceNumber: string; documentType: string; postingStatus: string | null; total: number | null } | null;
};
