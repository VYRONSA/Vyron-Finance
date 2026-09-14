import { describe, expect, it } from "vitest";
import { loadBusinessDocument, isDocumentType } from "./documents";
import { fixtureSource } from "./test-fixtures";

describe("Document Centre — reprint with a trail through the books", () => {
  it("an invoice carries its stored figures, its journal and the receipt that paid it", async () => {
    const doc = (await loadBusinessDocument(fixtureSource(), "sales-invoice", 1))!;
    expect(doc).toMatchObject({ title: "Tax Invoice", number: "INV001", totals: { net: 1000, vat: 150, total: 1150, outstanding: 0 }, salesInvoiceId: 1 });
    expect(doc.lines).toHaveLength(2);
    expect(doc.trace.map((t) => t.drill)).toEqual(expect.arrayContaining([{ kind: "journal", journalId: 2 }, { kind: "document", docType: "customer-receipt", id: 1 }]));
  });

  it("a bill traces to the payment AND the bank transaction that settled it", async () => {
    const doc = (await loadBusinessDocument(fixtureSource(), "purchase-bill", 1))!;
    expect(doc.title).toBe("Supplier Bill");
    expect(doc.trace.map((t) => t.drill)).toEqual(expect.arrayContaining([{ kind: "journal", journalId: 7 }, { kind: "document", docType: "supplier-payment", id: 1 }, { kind: "bank-transaction", transactionId: 102 }]));
  });

  it("an unposted imported bill says so instead of inventing a journal", async () => {
    const doc = (await loadBusinessDocument(fixtureSource(), "purchase-bill", 2))!;
    expect(doc.trace[0].label).toBe("Not posted");
  });

  it("a receipt lists the invoices it paid; a remittance advice the bills", async () => {
    const receipt = (await loadBusinessDocument(fixtureSource(), "customer-receipt", 1))!;
    expect(receipt.settlements).toEqual([expect.objectContaining({ reference: "INV001", amount: 1150 })]);
    expect(receipt.totals.outstanding).toBe(0);
    const remittance = (await loadBusinessDocument(fixtureSource(), "supplier-payment", 1))!;
    expect(remittance).toMatchObject({ title: "Remittance Advice", totals: { total: 575 } });
    expect(remittance.settlements[0]).toMatchObject({ reference: "NL-100", amount: 575 });
  });

  it("returns null for unknown documents and rejects unknown types", async () => {
    expect(await loadBusinessDocument(fixtureSource(), "sales-invoice", 999)).toBeNull();
    expect(await loadBusinessDocument(fixtureSource(), "sales-invoice", Number("abc"))).toBeNull();
    expect(isDocumentType("sales-invoice")).toBe(true);
    expect(isDocumentType("journal")).toBe(false);
  });
});
