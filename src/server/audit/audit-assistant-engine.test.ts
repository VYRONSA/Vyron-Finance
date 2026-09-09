import { describe, expect, it } from "vitest";
import {
  answerAfterHoursJournals,
  answerBelowThreshold,
  answerDuplicateInvoices,
  answerMissingSupportingDocuments,
  answerModuleGap,
  answerUnmatched,
  answerVerifyVatCalculations,
  matchAuditQuestion,
} from "./audit-assistant-engine";

describe("matchAuditQuestion", () => {
  it("matches a free-text question to a supported question id", () => {
    expect(matchAuditQuestion("Show all duplicate invoices please")).toBe("duplicate-invoices");
    expect(matchAuditQuestion("find journals posted outside office hours")).toBe("after-hours-journals");
    expect(matchAuditQuestion("recalculate depreciation for the year")).toBe("depreciation");
  });

  it("returns null for something with no keyword overlap", () => {
    expect(matchAuditQuestion("what is the weather today")).toBeNull();
  });
});

describe("answerDuplicateInvoices", () => {
  it("flags invoices sharing customer, date, and total", () => {
    const answer = answerDuplicateInvoices([
      { id: 1, invoiceNumber: "INV000001", customerId: 1, invoiceDate: "2026-05-01", total: 1000 },
      { id: 2, invoiceNumber: "INV000002", customerId: 1, invoiceDate: "2026-05-01", total: 1000 },
      { id: 3, invoiceNumber: "INV000003", customerId: 2, invoiceDate: "2026-05-02", total: 500 },
    ]);
    expect(answer.supportingTransactions).toHaveLength(2);
    expect(answer.confidence).toBeGreaterThan(0);
  });

  it("reports a clean, high-confidence answer when nothing duplicates", () => {
    const answer = answerDuplicateInvoices([{ id: 1, invoiceNumber: "INV000001", customerId: 1, invoiceDate: "2026-05-01", total: 1000 }]);
    expect(answer.supportingTransactions).toHaveLength(0);
    expect(answer.confidence).toBe(0.9);
  });
});

describe("answerAfterHoursJournals", () => {
  it("flags a journal entered outside the office-hours window", () => {
    const answer = answerAfterHoursJournals([{ id: 1, journalNumber: "JR000001", createdAt: "2026-05-01T22:00:00Z", totalDebit: 100, totalCredit: 100 }]);
    expect(answer.supportingTransactions).toHaveLength(1);
  });

  it("does not flag a journal entered during office hours", () => {
    const answer = answerAfterHoursJournals([{ id: 1, journalNumber: "JR000001", createdAt: "2026-05-01T10:00:00Z", totalDebit: 100, totalCredit: 100 }]);
    expect(answer.supportingTransactions).toHaveLength(0);
  });
});

describe("answerVerifyVatCalculations", () => {
  it("flags a Standard-type document with zero VAT", () => {
    const answer = answerVerifyVatCalculations([{ id: 1, documentType: "Invoice", vatType: "Standard", grossAmount: 1150, net: 1150, vat: 0 }]);
    expect(answer.supportingTransactions).toHaveLength(1);
  });

  it("does not flag a consistent Zero-Rated document", () => {
    const answer = answerVerifyVatCalculations([{ id: 1, documentType: "Invoice", vatType: "ZeroRated", grossAmount: 1000, net: 1000, vat: 0 }]);
    expect(answer.supportingTransactions).toHaveLength(0);
  });
});

describe("answerMissingSupportingDocuments", () => {
  it("flags a manual journal with no reference", () => {
    const answer = answerMissingSupportingDocuments([{ id: 1, journalNumber: "JR000001", sourceType: "manual", reference: "" }]);
    expect(answer.supportingTransactions).toHaveLength(1);
  });

  it("does not flag an automatically-generated journal", () => {
    const answer = answerMissingSupportingDocuments([{ id: 1, journalNumber: "JR000001", sourceType: "sales_invoice", reference: "" }]);
    expect(answer.supportingTransactions).toHaveLength(0);
  });
});

describe("answerBelowThreshold", () => {
  it("flags a transaction within the band below the threshold", () => {
    const answer = answerBelowThreshold([{ id: 1, label: "JR000001", amount: 9500 }], 10000, 20);
    expect(answer.supportingTransactions).toHaveLength(1);
  });

  it("does not flag a transaction well below the band", () => {
    const answer = answerBelowThreshold([{ id: 1, label: "JR000001", amount: 1000 }], 10000, 20);
    expect(answer.supportingTransactions).toHaveLength(0);
  });
});

describe("answerModuleGap and answerUnmatched", () => {
  it("gives an honest zero-confidence answer for a module that doesn't exist yet", () => {
    const answer = answerModuleGap("depreciation", "Recalculate depreciation");
    expect(answer.confidence).toBe(0);
    expect(answer.answer).toContain("Not answerable yet");
  });

  it("never fabricates a conclusion for an unmatched question", () => {
    const answer = answerUnmatched("what is the meaning of life");
    expect(answer.confidence).toBe(0);
    expect(answer.supportingTransactions).toHaveLength(0);
  });
});
