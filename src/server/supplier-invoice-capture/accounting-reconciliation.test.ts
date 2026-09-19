/**
 * Phase 5L — accounting reconciliation.
 *
 * Proves the chain the brief requires:
 *
 *     Extracted Document → Reviewed Values → Draft Supplier Bill
 *
 * matches exactly, and then proves the second half: that the EXISTING bill
 * engine — not this feature — owns VAT, the AP total and everything that
 * follows from them. `computeBillLine` is the real function
 * `createPurchaseBill` uses, so what is asserted here is what would be
 * stored.
 */
import { describe, expect, it } from "vitest";
import { assessConversion } from "./conversion";
import type { ConversionSubject } from "./conversion";
import { validateExtraction } from "./validation";
import { computeBillLine } from "@/server/services/purchase-bill-service";
import type { CreatePurchaseBillInput } from "@/server/services/purchase-bill-service";
import { computeLineAmounts } from "@/server/purchasing/line-amounts";
import { CORPUS } from "./test-corpus";
import type { ExtractionResult } from "./types";

const TREATMENT_RATE: Record<string, number> = { "Standard Rated": 15, "Zero Rated": 0, Exempt: 0, "No VAT": 0 };

/** The reviewer's act: confirm a GL account and a VAT code per line,
 * accepting the extracted figures. Everything else is carried across
 * unchanged. */
function reviewed(extraction: ExtractionResult, confirm: { glAccount: string; vatCode: string }[]): ConversionSubject {
  return {
    captureId: 1,
    status: "NeedsReview",
    supplierId: 7,
    invoiceNumber: extraction.header.invoiceNumber,
    invoiceDate: extraction.header.invoiceDate,
    dueDate: extraction.header.dueDate,
    validationStatus: validateExtraction(extraction).status,
    duplicate: { status: "None", reason: "" },
    existingBillId: null,
    // Phase 5N — the document's own kind and printed currency, carried
    // through so the corpus exercises the conversion boundaries rather
    // than stepping around them.
    documentType: extraction.header.documentType,
    currencyCode: extraction.header.currencyCode,
    baseCurrencyCode: "ZAR",
    lines: extraction.lines.map((l, i) => ({
      lineOrder: i,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount,
      glAccount: confirm[i].glAccount,
      vatCode: confirm[i].vatCode,
      isExcluded: false,
    })),
  };
}

/** What `createPurchaseBill` will do with that input — the real per-line
 * maths and the real header roll-up. */
function billFromInput(input: CreatePurchaseBillInput) {
  const lines = (input.lines ?? []).map((l) => computeBillLine(l, TREATMENT_RATE[l.vatCode] ?? 0));
  const subtotal = round2(lines.reduce((s, l) => s + l.netAmount, 0));
  const vat = round2(lines.reduce((s, l) => s + l.vatAmount, 0));
  return { lines, subtotal, vat, total: round2(subtotal + vat) };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

describe("document → reviewed → Draft bill, exactly", () => {
  it("carries every confirmed line figure across unchanged", () => {
    const extraction = CORPUS.find((c) => c.key === "clean-pdf")!.answer;
    const subject = reviewed(extraction, [{ glAccount: "5100", vatCode: "Standard Rated" }]);
    const conversion = assessConversion(subject);
    expect(conversion.ok).toBe(true);
    if (!conversion.ok) return;

    const source = extraction.lines[0];
    const target = conversion.input.lines![0];
    expect(target.quantity).toBe(source.quantity);
    expect(target.unitCost).toBe(source.unitPrice);
    expect(target.description).toBe(source.description);
    expect(target.discount).toBe(0);
  });

  it("produces a bill whose figures equal the document's, when the document reconciles", () => {
    const extraction = CORPUS.find((c) => c.key === "clean-pdf")!.answer;
    const conversion = assessConversion(reviewed(extraction, [{ glAccount: "5100", vatCode: "Standard Rated" }]));
    expect(conversion.ok).toBe(true);
    if (!conversion.ok) return;

    const bill = billFromInput(conversion.input);
    expect(bill.subtotal).toBe(extraction.header.subtotal);
    expect(bill.vat).toBe(extraction.header.vatAmount);
    expect(bill.total).toBe(extraction.header.total);
  });

  it("handles a mixed-VAT invoice line by line, not at one blended header rate", () => {
    const extraction = CORPUS.find((c) => c.key === "mixed-vat")!.answer;
    const conversion = assessConversion(
      reviewed(extraction, [
        { glAccount: "5100", vatCode: "Standard Rated" },
        { glAccount: "5200", vatCode: "Zero Rated" },
      ]),
    );
    expect(conversion.ok).toBe(true);
    if (!conversion.ok) return;

    const bill = billFromInput(conversion.input);
    expect(bill.subtotal).toBe(1300);
    expect(bill.vat).toBe(150); // 15% of the 1,000 line only
    expect(bill.total).toBe(1450);
    expect(bill.lines.map((l) => l.vatAmount)).toEqual([150, 0]);
  });

  it("charges VAT on the amount after a trade discount, as every other Finance document does", () => {
    const extraction = CORPUS.find((c) => c.key === "discount")!.answer;
    const conversion = assessConversion(reviewed(extraction, [{ glAccount: "5100", vatCode: "Standard Rated" }]));
    expect(conversion.ok).toBe(true);
    if (!conversion.ok) return;

    const bill = billFromInput(conversion.input);
    expect(bill.lines[0].netAmount).toBe(900); // 10 x 100 less 100
    expect(bill.lines[0].vatAmount).toBe(135); // 15% of 900, not of 1,000
    expect(bill.total).toBe(1035);
    expect(bill.total).toBe(extraction.header.total);
  });

  it("stores a case-priced line's price as printed — no pack division anywhere", () => {
    const extraction = CORPUS.find((c) => c.key === "uom-pack")!.answer;
    const conversion = assessConversion(reviewed(extraction, [{ glAccount: "5300", vatCode: "Standard Rated" }]));
    expect(conversion.ok).toBe(true);
    if (!conversion.ok) return;

    // 5 cases at R180. COST would have written 180 into `true_unit_cost`
    // while also claiming it was a unit cost; here it is simply the unit
    // cost of a case, which is what the invoice says.
    expect(conversion.input.lines![0].unitCost).toBe(180);
    expect(conversion.input.lines![0].quantity).toBe(5);
    expect(billFromInput(conversion.input).subtotal).toBe(900);
    // The pack quantity never reaches the bill at all.
    expect(JSON.stringify(conversion.input)).not.toContain("packQuantity");
  });
});

describe("the bill engine owns the accounting, not this feature", () => {
  it("uses the SAME line maths as every other Finance document", () => {
    const viaBillService = computeBillLine(
      { description: "x", glAccount: "5100", vatCode: "Standard Rated", quantity: 10, unitCost: 20, discount: 25 },
      15,
    );
    const viaSharedCore = computeLineAmounts(10, 20, 25, 15);
    expect({ netAmount: viaBillService.netAmount, vatAmount: viaBillService.vatAmount, lineTotal: viaBillService.lineTotal }).toEqual(viaSharedCore);
  });

  it("recomputes VAT from the confirmed lines rather than trusting the document's VAT figure", () => {
    // A document whose stated VAT is wrong. The reviewer confirmed the
    // lines; the engine's VAT is computed from those, and it does not
    // silently adopt the header figure.
    const extraction: ExtractionResult = {
      ...CORPUS.find((c) => c.key === "clean-pdf")!.answer,
      header: { ...CORPUS.find((c) => c.key === "clean-pdf")!.answer.header, vatAmount: 999, total: 1999 },
    };
    const conversion = assessConversion(reviewed(extraction, [{ glAccount: "5100", vatCode: "Standard Rated" }]));
    expect(conversion.ok).toBe(true);
    if (!conversion.ok) return;

    const bill = billFromInput(conversion.input);
    expect(bill.vat).toBe(150);
    expect(bill.vat).not.toBe(extraction.header.vatAmount);
    // And the disagreement was surfaced to the reviewer beforehand.
    expect(validateExtraction(extraction).findings.map((f) => f.code)).toContain("totals-disagree");
  });

  it("passes no header total, VAT treatment or subtotal across the boundary", () => {
    const extraction = CORPUS.find((c) => c.key === "clean-pdf")!.answer;
    const conversion = assessConversion(reviewed(extraction, [{ glAccount: "5100", vatCode: "Standard Rated" }]));
    if (!conversion.ok) return;
    expect(conversion.input).not.toHaveProperty("subtotal");
    expect(conversion.input).not.toHaveProperty("vatTreatmentCode");
    expect(conversion.input).not.toHaveProperty("glAccount");
  });

  it("creates no journal, ledger entry or AP record itself", async () => {
    // The conversion module's entire exported surface: an assessment and a
    // structural guard. Nothing that posts.
    const mod = await import("./conversion");
    expect(Object.keys(mod).sort()).toEqual(["assertNoBypass", "assessConversion"]);
  });

  it("no module in this feature writes to an accounting table", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    // Resolved from the vitest root rather than import.meta.url: under the
    // jsdom environment that is not always a file: URL.
    const dir = "src/server/supplier-invoice-capture/";
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const accountingTables = ["ae_journals", "ae_journal_lines", "gl_transactions", "ae_imported_bills", "ae_purchase_bill_lines"];
    for (const file of sources) {
      const text = readFileSync(dir + file, "utf8");
      for (const table of accountingTables) {
        expect(`${file}:${text.includes(`from("${table}")`)}`).toBe(`${file}:false`);
      }
    }
  });
});

describe("the whole corpus converts consistently", () => {
  it("every case that reconciles produces a bill equal to the document", () => {
    const reconciling = CORPUS.filter(
      (c) =>
        validateExtraction(c.answer).status === "Pass" &&
        c.answer.lines.length > 0 &&
        // Phase 5N — a document the conversion boundaries refuse outright
        // is not a reconciliation case. Its own refusal is asserted below.
        (c.answer.header.documentType ?? "Invoice") === "Invoice" &&
        (c.answer.header.currencyCode ?? "ZAR") === "ZAR",
    );
    expect(reconciling.length).toBeGreaterThan(5);

    for (const testCase of reconciling) {
      const confirm = testCase.answer.lines.map((l) => ({
        glAccount: "5100",
        vatCode: (l.vatRatePercent ?? 0) === 0 ? "Zero Rated" : "Standard Rated",
      }));
      const conversion = assessConversion(reviewed(testCase.answer, confirm));
      expect(`${testCase.key}:${conversion.ok}`).toBe(`${testCase.key}:true`);
      if (!conversion.ok) continue;

      const bill = billFromInput(conversion.input);
      // A document that prints NO VAT figure (a supplier who is not
      // VAT-registered) reads as null, and the bill engine computes 0.
      // Those agree in substance — no VAT arises either way — so null is
      // compared as zero here. The distinction that matters is kept where
      // it belongs: on the VAT treatment of the line, not on this figure.
      const expectedVat = testCase.answer.header.vatAmount ?? 0;
      expect(`${testCase.key}:${bill.subtotal}`).toBe(`${testCase.key}:${testCase.answer.header.subtotal}`);
      expect(`${testCase.key}:${bill.vat}`).toBe(`${testCase.key}:${expectedVat}`);
      expect(`${testCase.key}:${bill.total}`).toBe(`${testCase.key}:${testCase.answer.header.total}`);
    }
  });

  it("a blocked or incomplete case never reaches a bill", () => {
    for (const testCase of CORPUS.filter((c) => validateExtraction(c.answer).status === "Incomplete")) {
      const confirm = testCase.answer.lines.map(() => ({ glAccount: "5100", vatCode: "Standard Rated" }));
      const conversion = assessConversion(reviewed(testCase.answer, confirm));
      expect(`${testCase.key}:${conversion.ok}`).toBe(`${testCase.key}:false`);
    }
  });

  /*
   * Phase 5N — the three corpus documents that must never become a bill,
   * asserted by key rather than by category, so deleting the boundary
   * breaks this test by name.
   *
   * credit-note / debit-note: the only output here is a purchase BILL,
   *   which increases what is owed. A credit note reduces it. Converting
   *   one moves the supplier balance the wrong way by twice the document,
   *   with every figure on the resulting bill correct and only its sign
   *   wrong.
   *
   * foreign-currency: `CreatePurchaseBillInput` has no currency field at
   *   all, so a USD 1,200 invoice would be stored and posted as R1,200 —
   *   an understated liability that nothing downstream can detect, because
   *   R1,200 is an ordinary number.
   */
  it.each([
    ["credit-note", "not-an-invoice"],
    ["debit-note", "not-an-invoice"],
    ["foreign-currency", "foreign-currency-unsupported"],
  ])("the %s document is refused at the accounting boundary (%s)", (key, expectedBlock) => {
    const testCase = CORPUS.find((c) => c.key === key)!;
    expect(testCase).toBeDefined();

    const confirm = testCase.answer.lines.map((l) => ({
      glAccount: "5100",
      vatCode: (l.vatRatePercent ?? 0) === 0 ? "Zero Rated" : "Standard Rated",
    }));
    const conversion = assessConversion(reviewed(testCase.answer, confirm));

    expect(conversion.ok).toBe(false);
    if (conversion.ok) return;
    expect(conversion.blocks.map((b) => b.code)).toContain(expectedBlock);
  });
});
