/**
 * Scenario tests ported from the reference implementation's
 * `accounting_engine/tests/test_allocation_engine.py`.
 */

import { describe, expect, it } from "vitest";
import { evaluate, METHOD_MATCHED_BILL, METHOD_SUPPLIER_DEFAULT, STATUS_ALLOCATED, STATUS_UNALLOCATED } from "./allocation-engine";
import { REQUIRED_ACTION_NO_OUTSTANDING_BILL, STATUS_MATCHED, STATUS_SUGGESTED } from "./matching-engine";
import type { BankTransactionRecord, ImportedBill, Supplier } from "./types";

const COMPANY_ID = "co_1";

function supplier(id: number, name: string, defaultGl: string | null = null, defaultVat: string | null = null): Supplier {
  return {
    id, companyId: COMPANY_ID, name, alternativeNames: [], defaultGlAccount: defaultGl, defaultVatCode: defaultVat, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "", bankBranchCode: "",
    vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 30,
  };
}

function bill(id: number, supplierId: number, glAccount: string | null = null, vatCode: string | null = null): ImportedBill {
  return {
    id,
    companyId: COMPANY_ID,
    supplierId,
    supplierName: "",
    invoiceNumber: "BILL-1",
    documentType: "Bill",
    invoiceDate: null,
    dueDate: null,
    vat: 0,
    total: 500,
    outstanding: 500,
    status: "Open",
    glAccount,
    vatCode,
    origin: "Imported",
    purchaseOrderId: null,
    goodsReceivedNoteId: null,
    postingStatus: null,
    journalId: null,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    postedAt: null,
    cancelledBy: null,
    cancelledAt: null,
  };
}

function matchedTxn(id: number, supplierId: number, billId: number, confidence = 98, reason = "Matched"): BankTransactionRecord {
  return base(id, { allocationStatus: STATUS_MATCHED, matchedSupplierId: supplierId, matchedBillId: billId, confidenceScore: confidence, matchReason: reason });
}

function suggestedTxn(id: number, supplierId: number, billId: number | null, requiredAction: string, confidence = 45): BankTransactionRecord {
  return base(id, { allocationStatus: STATUS_SUGGESTED, matchedSupplierId: supplierId, matchedBillId: billId, confidenceScore: confidence, matchReason: "Suggested", requiredAction });
}

function unmatchedTxn(id: number): BankTransactionRecord {
  return base(id, { allocationStatus: STATUS_UNALLOCATED, confidenceScore: 0, matchReason: "No supplier found matching beneficiary 'Unknown'." });
}

function base(id: number, overrides: Partial<BankTransactionRecord>): BankTransactionRecord {
  return {
    id,
    companyId: COMPANY_ID,
    transactionDate: null,
    reference: "",
    description: "",
    beneficiary: "",
    debit: 500,
    credit: 0,
    balance: null,
    bankAccount: "MAIN",
    bankAccountId: null,
    glAccount: "",
    vat: null,
    notes: "",
    importBatch: "",
    sourceFilename: "",
    createdAt: "2026-01-15T00:00:00Z",
    allocationStatus: "Unallocated",
    matchedSupplierId: null,
    matchedSupplierName: null,
    matchedBillId: null,
    confidenceScore: null,
    rulesTriggered: [],
    matchReason: "",
    requiredAction: null,
    suggestedGlAccount: null,
    suggestedVatCode: null,
    allocationMethod: null,
    allocationReason: "",
    isManualOverride: false,
    reviewStatus: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    journalId: null,
    matchedCustomerId: null,
    matchedMerchantId: null,
    ruleId: null,
    allocationType: null,
    allocationNotes: "",
    entrySource: "Imported",
    captureStatus: null,
    cashbookBatchId: null,
    reconciliationId: null,
    reversalOfTransactionId: null,
    isSplit: false,
    ...overrides,
  };
}

describe("AllocationEngine", () => {
  it("uses the bill's own values and never overrides confidence", () => {
    const s = supplier(1, "ABC Supplies", "5000", "STD");
    const b = bill(1, 1, "6000", "ZERO");
    const t = matchedTxn(1, 1, 1, 98, "Exact Supplier Name, Invoice Reference, Exact Amount matched.");

    const result = evaluate(t, s, b);

    expect(result.status).toBe(STATUS_MATCHED);
    expect(result.glAccount).toBe("6000");
    expect(result.vatCode).toBe("ZERO");
    expect(result.confidence).toBe(98);
    expect(result.allocationMethod).toBe(METHOD_MATCHED_BILL);
  });

  it("falls back to supplier defaults when the bill has none of its own", () => {
    const s = supplier(1, "ABC Supplies", "5000", "STD");
    const b = bill(1, 1);
    const t = matchedTxn(1, 1, 1);

    const result = evaluate(t, s, b);

    expect(result.glAccount).toBe("5000");
    expect(result.vatCode).toBe("STD");
  });

  it("becomes Allocated when the supplier has defaults but no bill matched", () => {
    const s = supplier(1, "Shell", "Fuel", "Standard");
    const t = suggestedTxn(1, 1, null, REQUIRED_ACTION_NO_OUTSTANDING_BILL);

    const result = evaluate(t, s, null);

    expect(result.status).toBe(STATUS_ALLOCATED);
    expect(result.glAccount).toBe("Fuel");
    expect(result.vatCode).toBe("Standard");
    expect(result.allocationMethod).toBe(METHOD_SUPPLIER_DEFAULT);
  });

  it("stays Suggested when the supplier has no defaults configured", () => {
    const s = supplier(1, "New Supplier");
    const t = suggestedTxn(1, 1, null, REQUIRED_ACTION_NO_OUTSTANDING_BILL);

    const result = evaluate(t, s, null);

    expect(result.status).toBe(STATUS_SUGGESTED);
    expect(result.glAccount).toBeNull();
    expect(result.requiredAction).toContain("no default GL/VAT configured");
  });

  it("is Unallocated when no supplier was identified at all", () => {
    const t = unmatchedTxn(1);

    const result = evaluate(t, null, null);

    expect(result.status).toBe(STATUS_UNALLOCATED);
    expect(result.supplierId).toBeNull();
    expect(result.glAccount).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
