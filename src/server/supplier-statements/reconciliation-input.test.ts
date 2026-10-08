/**
 * @vitest-environment node
 *
 * SD-3D — engine input is built with the supplier ledger's own rules and
 * checked against it; unposted records keep their distinct treatment.
 */
import { describe, expect, it } from "vitest";
import { balancesAt, buildSupplierLedger } from "@/server/report-centre/party-ledger";
import type { SupplierSources } from "@/server/repositories/supplier-statement-reconciliation-repository";
import { buildCaptureRecords, buildDocumentRecords, buildLedgerRecords, buildUnpostedRecords, LedgerMismatchError } from "./reconciliation-input";

const SUP = 7;
function bill(p: Record<string, unknown>) {
  return {
    id: 1, companyId: "c", supplierId: SUP, supplierName: "S", invoiceNumber: "0001", documentType: "Bill", invoiceDate: "2026-09-05", dueDate: null,
    vat: 0, total: 100, outstanding: 100, currency: "ZAR", status: "Open", glAccount: null, vatCode: null, origin: "Purchasing",
    purchaseOrderId: null, goodsReceivedNoteId: null, postingStatus: "Posted", journalId: 11, submittedBy: null, submittedAt: null,
    approvedBy: null, approvedAt: null, postedAt: null, cancelledBy: null, cancelledAt: null, ...p,
  };
}
function sources(p: Partial<Record<keyof SupplierSources, unknown[]>> = {}): SupplierSources {
  return {
    bills: (p.bills ?? []) as SupplierSources["bills"],
    payments: (p.payments ?? []) as SupplierSources["payments"],
    bankTransactions: (p.bankTransactions ?? []) as SupplierSources["bankTransactions"],
    openingBalances: (p.openingBalances ?? []) as SupplierSources["openingBalances"],
  };
}

describe("buildLedgerRecords", () => {
  const s = sources({
    bills: [
      bill({ id: 1, total: 100 }),
      bill({ id: 2, documentType: "Credit Note", total: 30, invoiceNumber: "CN1" }),
      bill({ id: 3, postingStatus: "Draft", journalId: null, invoiceNumber: "DRAFT" }),
      bill({ id: 4, postingStatus: null, journalId: null, origin: "Imported", invoiceNumber: "IMP" }),
    ],
    payments: [
      { id: 5, supplierId: SUP, status: "Posted", paymentDate: "2026-09-10", amount: 40, paymentNumber: "SP-1", reference: "EFT", notes: "" },
      { id: 6, supplierId: SUP, status: "Draft", paymentDate: "2026-09-11", amount: 99, paymentNumber: "SP-2", reference: "", notes: "" },
    ],
    bankTransactions: [
      { id: 8, postedFlag: true, allocationType: "S", matchedSupplierId: SUP, transactionDate: "2026-09-12", debit: 20, credit: 0, reference: "PAY 8", description: "KAROO" },
      // Legacy bank posting without the posted flag: NOT a ledger entry (stays unexplained).
      { id: 9, postedFlag: false, allocationType: "S", matchedSupplierId: SUP, transactionDate: "2026-09-12", debit: 55, credit: 0, reference: "OLD", description: "", journalId: 77 },
    ],
    openingBalances: [{ id: 10, category: "Supplier", status: "posted", supplierId: SUP, balanceDate: "2026-08-31", amount: -500, reference: "OB", description: "" }],
  });

  it("follows the supplier ledger exactly: posted documents, posted payments, posted bank S rows, posted opening balances", () => {
    const records = buildLedgerRecords(s, SUP, "2026-09-30");
    expect(records.map((r) => `${r.refType}:${r.refId}:${r.amount}`).sort()).toEqual(
      ["bank-transaction:8:-20", "bill:1:100", "credit-note:2:-30", "opening-balance:10:500", "supplier-payment:5:-40"].sort(),
    );
  });

  it("agrees with balancesAt(buildSupplierLedger(...)) to the cent", () => {
    const records = buildLedgerRecords(s, SUP, "2026-09-30");
    const ours = records.reduce((sum, r) => sum + Math.round(r.amount * 100), 0) / 100;
    expect(ours).toBe(balancesAt(buildSupplierLedger(s), "2026-09-30").get(SUP));
  });

  it("an unflagged legacy bank posting is not read as a ledger entry", () => {
    expect(buildLedgerRecords(s, SUP, "2026-09-30").some((r) => r.refId === 9)).toBe(false);
  });
});

describe("buildUnpostedRecords", () => {
  const s = sources({
    bills: [
      bill({ id: 3, postingStatus: "Draft", journalId: null, invoiceNumber: "FROM-CAPTURE" }),
      bill({ id: 4, postingStatus: null, journalId: null, origin: "Imported", invoiceNumber: "IMPORT-CENTRE" }),
      bill({ id: 5, postingStatus: "Draft", journalId: null, invoiceNumber: "XERO-OR-HAND" }),
      bill({ id: 6, postingStatus: "Cancelled", journalId: null, invoiceNumber: "CANCELLED" }),
      bill({ id: 7, invoiceNumber: "POSTED" }),
    ],
  });
  const captures = [
    { id: 20, status: "NeedsReview", supplier_id: SUP, invoice_number: "IN-REVIEW", invoice_date: null, total: "115.00", document_type: "Invoice", bill_id: null },
    { id: 21, status: "Converted", supplier_id: SUP, invoice_number: "FROM-CAPTURE", invoice_date: null, total: "1", document_type: "Invoice", bill_id: 3 },
    { id: 22, status: "Cancelled", supplier_id: SUP, invoice_number: "REJECTED", invoice_date: null, total: "1", document_type: "Invoice", bill_id: null },
  ];
  const out = buildUnpostedRecords(s, captures, new Set([3]), SUP);
  const by = (n: string) => out.find((u) => u.number === n);

  it("a draft created from a capture, and a capture in review, are CAPTURED — DRAFT", () => {
    expect(by("FROM-CAPTURE")).toMatchObject({ kind: "captured-draft", refType: "unposted-bill" });
    expect(by("IN-REVIEW")).toMatchObject({ kind: "captured-draft", refType: "capture", amount: 115 });
  });

  it("Import Centre and Purchasing drafts not from a capture (Xero-migrated or entered by hand) are IMPORTED — NOT POSTED, never 'captured'", () => {
    expect(by("IMPORT-CENTRE")).toMatchObject({ kind: "imported-not-posted" });
    expect(by("IMPORT-CENTRE")!.source).toMatch(/Import Centre/);
    expect(by("XERO-OR-HAND")).toMatchObject({ kind: "imported-not-posted" });
    expect(by("XERO-OR-HAND")!.source).toMatch(/Xero-migrated or entered by hand/);
    expect(by("XERO-OR-HAND")!.source).not.toMatch(/captur/i);
  });

  it("posted, cancelled and rejected/converted-capture records are not 'unposted'", () => {
    expect(by("POSTED")).toBeUndefined();
    expect(by("CANCELLED")).toBeUndefined();
    expect(by("REJECTED")).toBeUndefined();
    expect(out.filter((u) => u.number === "FROM-CAPTURE")).toHaveLength(1);
  });
});

describe("SD-3G — buildDocumentRecords (documents only)", () => {
  const payment = { id: 5, companyId: "c", supplierId: SUP, paymentNumber: "SP-1", paymentDate: "2026-09-10", amount: 40, status: "Posted", reference: "", notes: "", journalId: 3 };
  const bank = { id: 6, companyId: "c", transactionDate: "2026-09-11", reference: "EFT", description: "x", debit: 0, credit: 40, postedFlag: true, allocationType: "S", matchedSupplierId: SUP, journalId: 4 };
  const opening = { id: 8, companyId: "c", category: "Supplier", status: "posted", supplierId: SUP, balanceDate: "2026-08-31", amount: 10, reference: "OB", description: "", journalId: 5 };

  it("reads bills, debit notes and credit notes — never payments, bank transactions or opening balances", () => {
    const records = buildDocumentRecords(sources({
      bills: [bill({ id: 1 }), bill({ id: 2, documentType: "Credit Note", invoiceNumber: "CN1", total: 20, journalId: 12 }), bill({ id: 3, documentType: "Debit Note", invoiceNumber: "DN1", total: 5, journalId: 13 })],
      payments: [payment], bankTransactions: [bank], openingBalances: [opening],
    }), new Set(), SUP);
    expect(records.map((r) => [r.refType, r.refId, r.amount])).toEqual([["bill", 1, 100], ["credit-note", 2, -20], ["debit-note", 3, 5]]);
  });

  it("includes UNPOSTED bills, flagged, with where they came from; never cancelled or undated ones", () => {
    const records = buildDocumentRecords(sources({
      bills: [
        bill({ id: 1 }),
        bill({ id: 2, invoiceNumber: "D1", postingStatus: "Draft", journalId: null, origin: "Imported" }),
        bill({ id: 3, invoiceNumber: "D2", postingStatus: "Draft", journalId: null }),
        bill({ id: 4, invoiceNumber: "X", postingStatus: "Cancelled", journalId: null }),
        bill({ id: 5, invoiceNumber: "Y", postingStatus: "Draft", journalId: null, invoiceDate: null }),
      ],
    }), new Set([3]), SUP);
    expect(records.map((r) => [r.refId, r.posted])).toEqual([[1, true], [2, false], [3, false]]);
    expect(records[1].source).toMatch(/Import Centre bill #2, not posted/);
    expect(records[2].source).toMatch(/captured invoice/);
  });

  it("only this supplier's documents", () => {
    expect(buildDocumentRecords(sources({ bills: [bill({ id: 1 }), bill({ id: 2, supplierId: 99 })] }), new Set(), SUP).map((r) => r.refId)).toEqual([1]);
  });

  it("the POSTED documents must be exactly the supplier ledger's document entries, or the run is refused", () => {
    // A bill the ledger would not count as posted (journal but status not posted) is "unposted" here too,
    // so the two agree; the check itself is exercised by tampering with the ledger's view.
    const s = sources({ bills: [bill({ id: 1 })] });
    expect(() => buildDocumentRecords(s, new Set(), SUP)).not.toThrow();
    const ledger = buildSupplierLedger(s).filter((e) => e.source === "document");
    expect(ledger).toHaveLength(1);
    const broken = { ...s, bills: [{ ...s.bills[0], total: Number.NaN }] } as SupplierSources;
    expect(() => buildDocumentRecords(broken, new Set(), SUP)).toThrow(LedgerMismatchError);
  });
});

describe("SD-3G — buildCaptureRecords", () => {
  it("captures still in the workflow, for this supplier, with a number", () => {
    const captures = [
      { id: 1, supplier_id: SUP, status: "NeedsReview", invoice_number: "I9", invoice_date: "2026-09-01", total: "10.00", document_type: "Invoice" },
      { id: 2, supplier_id: SUP, status: "Converted", invoice_number: "I8", invoice_date: null, total: null, document_type: "Invoice" },
      { id: 3, supplier_id: 99, status: "NeedsReview", invoice_number: "I7", invoice_date: null, total: null, document_type: "Invoice" },
      { id: 4, supplier_id: SUP, status: "NeedsReview", invoice_number: "C1", invoice_date: null, total: "5", document_type: "Credit Note" },
    ];
    const out = buildCaptureRecords(captures as never, SUP);
    expect(out.map((c) => [c.refId, c.amount, c.documentType])).toEqual([[1, 10, "Bill"], [4, -5, "Credit Note"]]);
  });
});
