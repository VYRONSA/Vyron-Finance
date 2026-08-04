/**
 * Scenario tests ported from the reference implementation's
 * `accounting_engine/tests/test_matching_engine.py`, proving this port
 * produces numerically identical confidence scores and statuses.
 */

import { describe, expect, it } from "vitest";
import { evaluateBatch, RULE_ALTERNATIVE_SUPPLIER_NAME, RULE_DATE_PROXIMITY, RULE_EXACT_AMOUNT, RULE_EXACT_SUPPLIER_NAME, RULE_INVOICE_REFERENCE, STATUS_MATCHED, STATUS_SUGGESTED, STATUS_UNMATCHED } from "./matching-engine";
import type { BankTransactionRecord, ImportedBill, Supplier } from "./types";

const COMPANY_ID = "co_1";

function supplier(id: number, name: string, alternativeNames: string[] = []): Supplier {
  return {
    id,
    companyId: COMPANY_ID,
    name,
    alternativeNames,
    defaultGlAccount: null,
    defaultVatCode: null,
    status: "Active",
    supplierCode: "",
    supplierCategory: "",
    supplierType: "Company",
    bankName: "",
    bankAccountNumber: "",
    bankBranchCode: "",
    vatNumber: "",
    taxNumber: "",
    riskRating: "Low",
    paymentTermsDays: 30,
  };
}

function bill(
  id: number,
  supplierId: number,
  invoiceNumber: string,
  outstanding: number,
  invoiceDate = "2020-01-01",
  dueDate = "2020-01-31",
): ImportedBill {
  return {
    id,
    companyId: COMPANY_ID,
    supplierId,
    supplierName: "",
    invoiceNumber,
    documentType: "Bill",
    invoiceDate,
    dueDate,
    vat: 0,
    total: outstanding,
    outstanding,
    status: "Open",
    glAccount: null,
    vatCode: null,
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

function txn(
  id: number,
  beneficiary: string,
  debit: number,
  opts: Partial<Pick<BankTransactionRecord, "description" | "reference" | "transactionDate" | "credit">> = {},
): BankTransactionRecord {
  return {
    id,
    companyId: COMPANY_ID,
    transactionDate: opts.transactionDate ?? "2026-01-15",
    reference: opts.reference ?? "",
    description: opts.description ?? "",
    beneficiary,
    debit,
    credit: opts.credit ?? 0,
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
    entrySource: "Imported",
    captureStatus: null,
    cashbookBatchId: null,
    reconciliationId: null,
    reversalOfTransactionId: null,
    isSplit: false,
  };
}

function evaluate(t: BankTransactionRecord, suppliers: Supplier[], bills: ImportedBill[], claimed?: Set<number>) {
  return evaluateBatch(COMPANY_ID, [t], suppliers, bills, claimed)[0];
}

describe("SupplierMatchingEngine", () => {
  it("matches on exact supplier name + exact amount (55 + 13 = 68)", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 500);
    const result = evaluate(txn(1, "ABC Supplies", 500), [s], [b]);

    expect(result.status).toBe(STATUS_MATCHED);
    expect(result.matchedSupplierId).toBe(1);
    expect(result.matchedBillId).toBe(1);
    expect(result.confidence).toBeCloseTo(68);
    expect(result.rulesTriggered).toEqual([RULE_EXACT_SUPPLIER_NAME, RULE_EXACT_AMOUNT]);
    expect(result.paymentType).toBe("Full Payment");
    expect(result.requiredAction).toBeNull();
  });

  it("alias match alone (45) is suggested, not auto-matched", () => {
    const s = supplier(1, "ABC Supplies (Pty) Ltd", ["ABC Supplies"]);
    const b = bill(1, s.id, "BILL-1001", 999);
    const result = evaluate(txn(1, "ABC Supplies", 500), [s], [b]);

    expect(result.confidence).toBeCloseTo(45);
    expect(result.rulesTriggered).toEqual([RULE_ALTERNATIVE_SUPPLIER_NAME]);
    expect(result.status).toBe(STATUS_SUGGESTED);
    expect(result.requiredAction).toBe("Review — confidence below auto-match threshold");
  });

  it("alias + reference (45 + 30 = 75) matches", () => {
    const s = supplier(1, "ABC Supplies (Pty) Ltd", ["ABC Supplies"]);
    const b = bill(1, s.id, "BILL-1001", 999);
    const result = evaluate(txn(1, "ABC Supplies", 500, { description: "Payment ref BILL-1001" }), [s], [b]);

    expect(result.confidence).toBeCloseTo(75);
    expect(result.status).toBe(STATUS_MATCHED);
  });

  it("finds invoice reference in description (55 + 30 = 85)", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 999);
    const result = evaluate(txn(1, "ABC Supplies", 500, { description: "Settling BILL-1001 in full" }), [s], [b]);

    expect(result.rulesTriggered).toContain(RULE_INVOICE_REFERENCE);
    expect(result.confidence).toBeCloseTo(85);
    expect(result.status).toBe(STATUS_MATCHED);
  });

  it("finds invoice reference in reference field, case-insensitively", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 999);
    const result = evaluate(txn(1, "ABC Supplies", 500, { reference: "bill-1001" }), [s], [b]);

    expect(result.rulesTriggered).toContain(RULE_INVOICE_REFERENCE);
  });

  it("worked example: supplier + reference + amount = 98%", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 500);
    const result = evaluate(txn(1, "ABC Supplies", 500, { description: "Payment for BILL-1001" }), [s], [b]);

    expect(result.confidence).toBeCloseTo(98);
    expect(result.status).toBe(STATUS_MATCHED);
    expect(new Set(result.rulesTriggered)).toEqual(new Set([RULE_EXACT_SUPPLIER_NAME, RULE_INVOICE_REFERENCE, RULE_EXACT_AMOUNT]));
  });

  it("recognises a partial payment without rejecting it", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 10_000);
    const result = evaluate(txn(1, "ABC Supplies", 5_000, { description: "Part payment BILL-1001" }), [s], [b]);

    expect(result.paymentType).toBe("Partial Payment");
    expect(result.rulesTriggered).not.toContain(RULE_EXACT_AMOUNT);
    expect(result.status).toBe(STATUS_MATCHED);
    expect(result.reason).toContain("Partial payment");
  });

  it("flags multiple equally-scored bills for review", () => {
    const s = supplier(1, "ABC Supplies");
    const billA = bill(1, s.id, "BILL-1001", 999);
    const billB = bill(2, s.id, "BILL-1002", 999);
    const result = evaluate(txn(1, "ABC Supplies", 500), [s], [billA, billB]);

    expect(result.status).toBe(STATUS_SUGGESTED);
    expect(result.requiredAction).toBe("Review — possible multiple invoice payment");
    expect(new Set(result.candidateBillIds)).toEqual(new Set([1, 2]));
    expect(result.matchedBillId).toBeNull();
  });

  it("flags a duplicate payment within the same batch", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 500);
    const first = txn(1, "ABC Supplies", 500, { description: "BILL-1001", transactionDate: "2026-01-10" });
    const second = txn(2, "ABC Supplies", 500, { description: "BILL-1001", transactionDate: "2026-01-20" });

    const results = evaluateBatch(COMPANY_ID, [first, second], [s], [b]);

    expect(results[0].status).toBe(STATUS_MATCHED);
    expect(results[1].status).toBe(STATUS_SUGGESTED);
    expect(results[1].requiredAction).toBe("Review — possible duplicate payment");
    expect(results[1].matchedBillId).toBe(1);
    expect(results[1].reason).toContain("already has a matched payment");
  });

  it("flags a duplicate payment against a previously matched bill", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 500);
    const result = evaluate(txn(1, "ABC Supplies", 500, { description: "BILL-1001" }), [s], [b], new Set([1]));

    expect(result.status).toBe(STATUS_SUGGESTED);
    expect(result.requiredAction).toBe("Review — possible duplicate payment");
  });

  it("does not match an unknown beneficiary", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 500);
    const result = evaluate(txn(1, "Totally Unknown Payee", 500), [s], [b]);

    expect(result.status).toBe(STATUS_UNMATCHED);
    expect(result.confidence).toBe(0);
    expect(result.matchedSupplierId).toBeNull();
  });

  it("never matches a receipt (credit-only transaction)", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 500);
    const receipt = txn(1, "ABC Supplies", 0, { credit: 500 });
    const result = evaluate(receipt, [s], [b]);

    expect(result.status).toBe(STATUS_UNMATCHED);
    expect(result.reason.toLowerCase()).toContain("not a payment");
  });

  it("supplier name alone (55) is a low-confidence suggestion", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 999);
    const result = evaluate(txn(1, "ABC Supplies", 500), [s], [b]);

    expect(result.status).toBe(STATUS_SUGGESTED);
    expect(result.confidence).toBeCloseTo(55);
    expect(result.rulesTriggered).toEqual([RULE_EXACT_SUPPLIER_NAME]);
  });

  it("a known supplier with no outstanding bills is suggested", () => {
    const s = supplier(1, "ABC Supplies");
    const result = evaluate(txn(1, "ABC Supplies", 500), [s], []);

    expect(result.status).toBe(STATUS_SUGGESTED);
    expect(result.matchedSupplierId).toBe(1);
    expect(result.matchedBillId).toBeNull();
    expect(result.reason).toContain("no outstanding bills");
  });

  it("date proximity adds points when close (55 + 2 = 57)", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 999, "2020-01-01", "2026-01-20");
    const result = evaluate(txn(1, "ABC Supplies", 500, { transactionDate: "2026-01-25" }), [s], [b]);

    expect(result.rulesTriggered).toContain(RULE_DATE_PROXIMITY);
    expect(result.confidence).toBeCloseTo(57);
  });

  it("a payment far outside the date window is never rejected for it", () => {
    const s = supplier(1, "ABC Supplies");
    const b = bill(1, s.id, "BILL-1001", 500, "2020-01-01", "2025-01-01");
    const result = evaluate(txn(1, "ABC Supplies", 500, { description: "BILL-1001", transactionDate: "2026-06-01" }), [s], [b]);

    expect(result.rulesTriggered).not.toContain(RULE_DATE_PROXIMITY);
    expect(result.status).toBe(STATUS_MATCHED);
  });

  it("refuses to match a supplier belonging to a different company", () => {
    const other = { ...supplier(1, "ABC Supplies"), companyId: "co_2" };
    expect(() => evaluateBatch(COMPANY_ID, [txn(1, "ABC Supplies", 500)], [other], [])).toThrow(/company/);
  });

  it("refuses to match a bill belonging to a different company", () => {
    const s = supplier(1, "ABC Supplies");
    const other = { ...bill(1, 1, "BILL-1001", 500), companyId: "co_2" };
    expect(() => evaluateBatch(COMPANY_ID, [txn(1, "ABC Supplies", 500)], [s], [other])).toThrow(/company/);
  });

  it("never cross-matches two companies with an identically named supplier", () => {
    const supplierA = supplier(1, "ABC Supplies");
    const billA = bill(1, 1, "A-1", 500);
    const result = evaluateBatch("co_1", [txn(1, "ABC Supplies", 500)], [supplierA], [billA])[0];

    expect(result.matchedSupplierId).toBe(1);
    expect(result.matchedBillId).toBe(1);
  });
});
