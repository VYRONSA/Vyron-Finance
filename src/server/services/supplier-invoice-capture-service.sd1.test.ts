/**
 * @vitest-environment node
 *
 * SD-1 — the capture service's orchestration: conversion with the approval
 * amount, credit notes, re-validation, manual entry and the upload-time
 * duplicate check. Repositories and the bill service are mocked; the pure
 * modules (conversion, validation, duplicate detection) run for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = {
  getCapture: vi.fn(),
  getCaptureAsSystem: vi.fn(),
  getCaptureByDocument: vi.fn(),
  createCapture: vi.fn(),
  listCaptureLines: vi.fn(),
  listCaptureLinesAsSystem: vi.fn(),
  updateCaptureAsReviewer: vi.fn(),
  updateCaptureAsSystem: vi.fn(),
  updateCaptureAsSystemIfUnchanged: vi.fn(),
  recordCaptureEvent: vi.fn(),
  recordSystemCaptureEvent: vi.fn(),
  findSameFileDocuments: vi.fn(),
  getDocumentHashAsSystem: vi.fn(),
  listDuplicateCandidates: vi.fn(),
  listBillDuplicateCandidates: vi.fn(),
  upsertLearnedMapping: vi.fn(),
  updateCaptureLine: vi.fn(),
  addCaptureLinesAsReviewer: vi.fn(),
  removeCaptureLineAsReviewer: vi.fn(),
};
const createPurchaseBill = vi.fn();
const cancelBill = vi.fn();
const previewPurchaseBillTotals = vi.fn();

vi.mock("@/server/repositories/supplier-invoice-capture-repository", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...repo,
}));
vi.mock("@/server/repositories/supplier-reconciliation-repository", () => ({ listSuppliers: async () => [{ id: 7, name: "Acme Supplies" }] }));
vi.mock("@/server/repositories/company-repository", () => ({ getCompany: async () => ({ baseCurrencyCode: "ZAR" }) }));
vi.mock("@/server/services/vat-treatment-service", () => ({ listVatTreatments: async () => [{ code: "Standard Rated", rate: 15 }] }));
vi.mock("@/server/auth/require-session", () => ({ getPerformedByLabel: async () => "reviewer@example.test" }));
vi.mock("@/server/services/purchase-bill-service", () => {
  class ValidationError extends Error {}
  return {
    ValidationError,
    createPurchaseBill: (...a: unknown[]) => createPurchaseBill(...a),
    cancelBill: (...a: unknown[]) => cancelBill(...a),
    previewPurchaseBillTotals: (...a: unknown[]) => previewPurchaseBillTotals(...a),
  };
});

function capture(overrides: Record<string, unknown> = {}) {
  return {
    id: 5, company_id: "co_1", document_id: 11, status: "NeedsReview", document_type: "Invoice",
    supplier_name_extracted: "Acme Supplies", supplier_vat_number_extracted: null, supplier_registration_number_extracted: null,
    invoice_number: "INV-100", invoice_date: "2026-06-01", due_date: null, order_reference: null, currency_code: "ZAR",
    subtotal: 1000, discount_total: null, vat_amount: 150, total: 1150,
    supplier_id: 7, supplier_match_tier: "vat", supplier_candidates: [],
    validation_status: "Pass", validation_findings: [], model_confidence: null,
    duplicate_status: "None", duplicate_of_capture_id: null, duplicate_of_bill_id: null, duplicate_reason: "",
    extraction_attempts: 0, last_error_category: null, last_error_message: null,
    bill_id: null, converted_at: null, converted_by: null, uploaded_by: "u", created_at: "t", updated_at: "2026-06-01T10:00:00.000001+00:00",
    extraction_snapshot: null, manual_entry: false, validated_at: "t",
    ...overrides,
  };
}

function captureLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, capture_id: 5, line_order: 0, description: "Widget", supplier_sku: null, quantity: 10, uom: null,
    pack_description: null, pack_quantity: null, unit_price: 100, discount: null, vat_rate_percent: 15, vat_amount: 150, line_total: 1000,
    gl_account_suggested: "5100", gl_account_source: "supplier-default", vat_code_suggested: "Standard Rated", vat_code_source: "supplier-default",
    gl_account_confirmed: null, vat_code_confirmed: null, is_excluded: false, line_confidence: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.getCapture.mockResolvedValue(capture());
  repo.getCaptureAsSystem.mockResolvedValue(capture());
  repo.listCaptureLines.mockResolvedValue([captureLine()]);
  repo.listCaptureLinesAsSystem.mockResolvedValue([captureLine()]);
  repo.updateCaptureAsReviewer.mockResolvedValue(capture());
  repo.updateCaptureAsSystem.mockResolvedValue(capture());
  repo.updateCaptureAsSystemIfUnchanged.mockResolvedValue(capture());
  repo.getDocumentHashAsSystem.mockResolvedValue("hash");
  repo.listDuplicateCandidates.mockResolvedValue([]);
  repo.listBillDuplicateCandidates.mockResolvedValue([]);
  previewPurchaseBillTotals.mockResolvedValue({ subtotal: 1000, vat: 150, total: 1150 });
  createPurchaseBill.mockResolvedValue({ id: 900 });
});

describe("B. the approval amount", () => {
  it("is computed from the reviewed lines by the bill engine — not the extracted total", async () => {
    repo.getCapture.mockResolvedValue(capture({ total: null }));
    const { prepareConversion } = await import("./supplier-invoice-capture-service");
    const prepared = await prepareConversion("co_1", 5);
    expect(previewPurchaseBillTotals).toHaveBeenCalledWith("co_1", [
      { description: "Widget", glAccount: "5100", vatCode: "Standard Rated", quantity: 10, unitCost: 100, discount: 0 },
    ]);
    expect(prepared.approvalAmount).toBe(1150);
  });

  it("is raised to the reviewed printed total when that is larger", async () => {
    repo.getCapture.mockResolvedValue(capture({ total: 9200 }));
    const { prepareConversion } = await import("./supplier-invoice-capture-service");
    expect((await prepareConversion("co_1", 5)).approvalAmount).toBe(9200);
  });

  it("conversion refuses if the document now converts to MORE than the amount approved", async () => {
    previewPurchaseBillTotals.mockResolvedValue({ subtotal: 2000, vat: 300, total: 2300 });
    const { convertCaptureToBill, ValidationError } = await import("./supplier-invoice-capture-service");
    await expect(convertCaptureToBill("co_1", 5, 1150)).rejects.toBeInstanceOf(ValidationError);
    expect(createPurchaseBill).not.toHaveBeenCalled();
  });

  it("an amount the engine cannot compute is a refusal, never zero", async () => {
    previewPurchaseBillTotals.mockResolvedValue({ subtotal: 0, vat: 0, total: 0 });
    const { prepareConversion, ValidationError } = await import("./supplier-invoice-capture-service");
    await expect(prepareConversion("co_1", 5)).rejects.toBeInstanceOf(ValidationError);
  });

  it("a capture awaiting re-validation is refused before any amount is offered", async () => {
    repo.getCapture.mockResolvedValue(capture({ validation_status: "Pending" }));
    const { prepareConversion, ValidationError } = await import("./supplier-invoice-capture-service");
    await expect(prepareConversion("co_1", 5)).rejects.toBeInstanceOf(ValidationError);
    expect(previewPurchaseBillTotals).not.toHaveBeenCalled();
  });
});

describe("F. credit notes go through the existing purchase-document path", () => {
  it("a reviewed credit note is created as a Draft 'Credit Note' with magnitudes", async () => {
    repo.getCapture.mockResolvedValue(capture({ document_type: "Credit Note", validation_status: "Review", total: -1150 }));
    repo.listCaptureLines.mockResolvedValue([captureLine({ quantity: -10 })]);
    const { convertCaptureToBill } = await import("./supplier-invoice-capture-service");
    await convertCaptureToBill("co_1", 5, 1150);
    const input = createPurchaseBill.mock.calls[0][1] as { documentType: string; lines: { quantity: number }[] };
    expect(input.documentType).toBe("Credit Note");
    expect(input.lines[0].quantity).toBe(10);
    expect(repo.recordCaptureEvent).toHaveBeenCalledWith("co_1", 5, "ConvertedToBill", expect.objectContaining({ documentType: "Credit Note" }));
  });

  it("an invoice is created as a Draft 'Bill'", async () => {
    const { convertCaptureToBill } = await import("./supplier-invoice-capture-service");
    await convertCaptureToBill("co_1", 5, 1150);
    expect((createPurchaseBill.mock.calls[0][1] as { documentType: string }).documentType).toBe("Bill");
  });

  it("a Draft that cannot be linked to its capture is cancelled through the bill workflow, not orphaned", async () => {
    repo.updateCaptureAsReviewer.mockRejectedValue({ code: "42501", message: "the bill is not the draft created for this capture" });
    const { convertCaptureToBill } = await import("./supplier-invoice-capture-service");
    await expect(convertCaptureToBill("co_1", 5, 1150)).rejects.toMatchObject({ code: "42501" });
    expect(cancelBill).toHaveBeenCalledWith("co_1", 900);
    expect(repo.recordCaptureEvent).not.toHaveBeenCalledWith("co_1", 5, "ConvertedToBill", expect.anything());
  });
});

describe("C. corrections re-validate", () => {
  it("a header correction (including totals) is applied under the session, then duplicates and validation re-run", async () => {
    const { applyHeaderCorrection } = await import("./supplier-invoice-capture-service");
    await applyHeaderCorrection("co_1", 5, { total: 1150, documentType: "Credit Note" });
    expect(repo.updateCaptureAsReviewer).toHaveBeenCalledWith("co_1", 5, { total: 1150, document_type: "Credit Note" });
    expect(repo.recordCaptureEvent).toHaveBeenCalledWith("co_1", 5, "FieldCorrected", { fields: ["total", "documentType"] });
    expect(repo.listDuplicateCandidates).toHaveBeenCalled();
    expect(repo.updateCaptureAsSystemIfUnchanged).toHaveBeenCalledWith(
      "co_1", 5, "2026-06-01T10:00:00.000001+00:00", expect.objectContaining({ validation_status: expect.any(String) }),
    );
  });

  it("refuses a correction that is not a number", async () => {
    const { applyHeaderCorrection, ValidationError } = await import("./supplier-invoice-capture-service");
    await expect(applyHeaderCorrection("co_1", 5, { total: "abc" as never })).rejects.toBeInstanceOf(ValidationError);
    expect(repo.updateCaptureAsReviewer).not.toHaveBeenCalled();
  });

  it("refuses an unknown document type", async () => {
    const { applyHeaderCorrection, ValidationError } = await import("./supplier-invoice-capture-service");
    await expect(applyHeaderCorrection("co_1", 5, { documentType: "Receipt" as never })).rejects.toBeInstanceOf(ValidationError);
  });

  it("line corrections, additions and removals are applied, then validation re-runs", async () => {
    const { applyLineCorrections } = await import("./supplier-invoice-capture-service");
    await applyLineCorrections("co_1", 5, [{ lineOrder: 0, quantity: 11 }], { add: [{ description: "Freight", quantity: 1, unitPrice: 50 }], remove: [3] });
    expect(repo.updateCaptureLine).toHaveBeenCalledWith("co_1", 5, 0, { quantity: 11 });
    expect(repo.removeCaptureLineAsReviewer).toHaveBeenCalledWith("co_1", 5, 3);
    expect(repo.addCaptureLinesAsReviewer).toHaveBeenCalledWith("co_1", 5, [{ description: "Freight", quantity: 1, unit_price: 50 }]);
    expect(repo.updateCaptureAsSystemIfUnchanged).toHaveBeenCalled();
  });

  it("a verdict is never recorded against values it did not see: a concurrent edit leaves it Pending", async () => {
    repo.updateCaptureAsSystemIfUnchanged.mockResolvedValue(null);
    const { revalidateCapture } = await import("./supplier-invoice-capture-service");
    expect(await revalidateCapture("co_1", 5, "reviewer@example.test")).toBe("Pending");
    expect(repo.recordSystemCaptureEvent).not.toHaveBeenCalledWith("co_1", 5, "ValidationEvaluated", expect.anything(), expect.anything());
  });

  it("re-validation uses the confirmed supplier's name, so a manual entry is not missing its supplier", async () => {
    repo.getCaptureAsSystem.mockResolvedValue(capture({ supplier_name_extracted: null, manual_entry: true }));
    const { revalidateCapture } = await import("./supplier-invoice-capture-service");
    expect(await revalidateCapture("co_1", 5, "r")).toBe("Pass");
  });
});

describe("D. manual entry", () => {
  it("starts only from Queued or Failed", async () => {
    const { startManualEntry, ValidationError } = await import("./supplier-invoice-capture-service");
    for (const status of ["Queued", "Failed"]) {
      repo.getCapture.mockResolvedValue(capture({ status }));
      await startManualEntry("co_1", 5);
    }
    expect(repo.updateCaptureAsReviewer).toHaveBeenCalledTimes(2);
    expect(repo.recordCaptureEvent).toHaveBeenCalledWith("co_1", 5, "ManualEntryStarted", { from: "Failed" });
    for (const status of ["NeedsReview", "Converted", "Cancelled", "Extracting", "Duplicate"]) {
      repo.getCapture.mockResolvedValue(capture({ status }));
      await expect(startManualEntry("co_1", 5)).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("submitting moves it to review, then checks duplicates and validates", async () => {
    repo.getCapture.mockResolvedValue(capture({ status: "ManualEntry" }));
    const { submitForReview } = await import("./supplier-invoice-capture-service");
    await submitForReview("co_1", 5);
    expect(repo.updateCaptureAsReviewer).toHaveBeenCalledWith("co_1", 5, { status: "NeedsReview" });
    expect(repo.recordCaptureEvent).toHaveBeenCalledWith("co_1", 5, "SubmittedForReview", {});
    expect(repo.listDuplicateCandidates).toHaveBeenCalled();
    expect(repo.updateCaptureAsSystemIfUnchanged).toHaveBeenCalled();
  });
});

describe("E. the upload-time duplicate check", () => {
  beforeEach(() => {
    repo.getCaptureByDocument.mockResolvedValue(null);
    repo.createCapture.mockResolvedValue(capture({ id: 8, status: "Uploaded", document_id: 12 }));
  });

  it("does not match the uploaded document itself", async () => {
    repo.findSameFileDocuments.mockResolvedValue([{ documentId: 12, filename: "new.pdf", captureId: 8, captureStatus: "Uploaded" }]);
    const { queueDocumentForExtraction } = await import("./supplier-invoice-capture-service");
    expect((await queueDocumentForExtraction("co_1", 12, "hash")).status).toBe("Queued");
  });

  it("blocks the same file as a live capture", async () => {
    repo.findSameFileDocuments.mockResolvedValue([
      { documentId: 12, filename: "new.pdf", captureId: 8, captureStatus: "Uploaded" },
      { documentId: 3, filename: "old.pdf", captureId: 2, captureStatus: "Converted" },
    ]);
    const { queueDocumentForExtraction } = await import("./supplier-invoice-capture-service");
    const result = await queueDocumentForExtraction("co_1", 12, "hash");
    expect(result).toMatchObject({ status: "Duplicate", duplicateOfDocumentId: 3 });
    expect(repo.updateCaptureAsSystem).toHaveBeenCalledWith("co_1", 8, expect.objectContaining({ status: "Duplicate", duplicate_status: "Blocked" }));
  });

  it("queues the same file as a rejected capture, flagged as a possible duplicate", async () => {
    repo.findSameFileDocuments.mockResolvedValue([{ documentId: 3, filename: "old.pdf", captureId: 2, captureStatus: "Cancelled" }]);
    const { queueDocumentForExtraction } = await import("./supplier-invoice-capture-service");
    const result = await queueDocumentForExtraction("co_1", 12, "hash");
    expect(result.status).toBe("Queued");
    expect(repo.updateCaptureAsSystem).toHaveBeenCalledWith(
      "co_1", 8, expect.objectContaining({ status: "Queued", duplicate_status: "Possible", duplicate_of_capture_id: 2 }),
    );
  });
});
