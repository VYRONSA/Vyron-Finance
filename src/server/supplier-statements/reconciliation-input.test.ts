/**
 * @vitest-environment node
 *
 * SD-3D — engine input is built with the supplier ledger's own rules and
 * checked against it; unposted records keep their distinct treatment.
 */
import { describe, expect, it } from "vitest";
import { balancesAt, buildSupplierLedger } from "@/server/report-centre/party-ledger";
import type { SupplierSources } from "@/server/repositories/supplier-statement-reconciliation-repository";
import { buildLedgerRecords, buildUnpostedRecords } from "./reconciliation-input";

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
