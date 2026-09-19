/**
 * Phase 5L — the conversion gate.
 *
 * The decisive property of the whole feature is asserted here: nothing an
 * AI produces becomes an accounting record without a human, and there is no
 * bypass. VYRON COST's bulk approve hard-coded `force: true`, which made
 * its validator's `blocked` unconditionally false and wrote costs and
 * inventory movements past every rule. These tests exist so that shape
 * cannot reappear.
 */
import { describe, expect, it } from "vitest";
import { assertNoBypass, assessConversion } from "./conversion";
import type { ConversionLine, ConversionSubject } from "./conversion";

function line(overrides: Partial<ConversionLine> = {}): ConversionLine {
  return {
    lineOrder: 0,
    description: "Consulting",
    quantity: 2,
    unitPrice: 500,
    discount: 0,
    glAccount: "5100",
    vatCode: "Standard Rated",
    isExcluded: false,
    ...overrides,
  };
}

function subject(overrides: Partial<ConversionSubject> = {}): ConversionSubject {
  return {
    captureId: 1,
    status: "NeedsReview",
    supplierId: 7,
    invoiceNumber: "INV-001",
    invoiceDate: "2026-06-01",
    dueDate: "2026-06-30",
    validationStatus: "Pass",
    duplicate: { status: "None", reason: "" },
    existingBillId: null,
    documentType: "Invoice",
    currencyCode: "ZAR",
    baseCurrencyCode: "ZAR",
    lines: [line()],
    ...overrides,
  };
}

describe("a reviewed capture converts to a Draft bill input", () => {
  it("maps the confirmed values onto the existing bill service's input", () => {
    const result = assessConversion(subject());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toEqual({
      supplierId: 7,
      invoiceNumber: "INV-001",
      invoiceDate: "2026-06-01",
      dueDate: "2026-06-30",
      lines: [{ description: "Consulting", glAccount: "5100", vatCode: "Standard Rated", quantity: 2, unitCost: 500, discount: 0 }],
    });
  });

  it("carries NO header total — the bill service rolls the lines up itself", () => {
    const result = assessConversion(subject());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Nothing the model said about subtotal/VAT/total crosses this
    // boundary. `summarizeBillLines` computes them from the lines the
    // reviewer confirmed, using the same `computeLineAmounts` every other
    // document in Finance uses.
    expect(result.input).not.toHaveProperty("subtotal");
    expect(result.input).not.toHaveProperty("vatTreatmentCode");
    expect("lines" in result.input && result.input.lines?.length).toBe(1);
  });

  it("omits excluded lines", () => {
    const result = assessConversion(subject({ lines: [line(), line({ lineOrder: 1, isExcluded: true })] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.lines).toHaveLength(1);
  });

  it("defaults a missing discount to zero rather than to null", () => {
    const result = assessConversion(subject({ lines: [line({ discount: null })] }));
    if (result.ok) expect(result.input.lines?.[0].discount).toBe(0);
  });

  it("gives an unnamed line an honest placeholder instead of an empty description", () => {
    const result = assessConversion(subject({ lines: [line({ description: "  " })] }));
    if (result.ok) expect(result.input.lines?.[0].description).toBe("(no description)");
  });
});

describe("blocks — the reviewer is told everything at once", () => {
  it("refuses an unresolved supplier", () => {
    const r = assessConversion(subject({ supplierId: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocks.map((b) => b.code)).toContain("no-supplier");
  });

  it("refuses a missing invoice number or date", () => {
    const r = assessConversion(subject({ invoiceNumber: "  ", invoiceDate: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocks.map((b) => b.code)).toEqual(expect.arrayContaining(["missing-invoice-number", "missing-invoice-date"]));
  });

  it("refuses a line with no GL account or no VAT code, naming the line", () => {
    const r = assessConversion(subject({ lines: [line({ glAccount: null, vatCode: null, lineOrder: 2 })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.blocks.find((b) => b.code === "line-missing-gl-account")?.lineOrder).toBe(2);
      expect(r.blocks.find((b) => b.code === "line-missing-vat-code")?.message).toContain("Line 3");
    }
  });

  it("refuses a line with no quantity or price", () => {
    const r = assessConversion(subject({ lines: [line({ quantity: null }), line({ lineOrder: 1, unitPrice: null })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocks.filter((b) => b.code === "line-missing-amounts")).toHaveLength(2);
  });

  it("refuses a bill with nothing left to bill", () => {
    const r = assessConversion(subject({ lines: [line({ isExcluded: true })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocks.map((b) => b.code)).toContain("no-lines");
  });

  it("reports every problem together rather than one per attempt", () => {
    const r = assessConversion(subject({ supplierId: null, invoiceNumber: null, lines: [line({ glAccount: null })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocks.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the absolute blocks", () => {
  it("a BLOCKED duplicate stops conversion, with the reason shown", () => {
    const r = assessConversion(subject({ duplicate: { status: "Blocked", reason: "Invoice INV-001 is already on the ledger as bill #500." } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocks.find((b) => b.code === "duplicate-blocked")?.message).toContain("bill #500");
  });

  it("a POSSIBLE duplicate does not — the reviewer has seen it and may proceed", () => {
    const r = assessConversion(subject({ duplicate: { status: "Possible", reason: "Same amount, 2 days apart." } }));
    expect(r.ok).toBe(true);
  });

  it("an Incomplete validation stops conversion — arithmetic rejected the extraction", () => {
    const r = assessConversion(subject({ validationStatus: "Incomplete" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocks.map((b) => b.code)).toContain("validation-incomplete");
  });

  it("a Review validation does NOT stop it — deciding a disagreement IS the review", () => {
    expect(assessConversion(subject({ validationStatus: "Review" })).ok).toBe(true);
  });

  it("refuses to convert anything that is not awaiting review", () => {
    for (const status of ["Uploaded", "Queued", "Extracting", "Failed", "Cancelled", "Duplicate"]) {
      const r = assessConversion(subject({ status }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.blocks.map((b) => b.code)).toContain("wrong-status");
    }
  });
});

describe("idempotency — one approved document, one bill", () => {
  it("refuses a second conversion and names the bill that already exists", () => {
    const r = assessConversion(subject({ existingBillId: 900 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.blocks).toHaveLength(1);
      expect(r.blocks[0]).toMatchObject({ code: "already-converted" });
      expect(r.blocks[0].message).toContain("#900");
    }
  });

  it("reports only that, not a list of other things to fix", () => {
    // An already-converted capture is not a form with errors.
    const r = assessConversion(subject({ existingBillId: 900, supplierId: null, invoiceNumber: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocks.map((b) => b.code)).toEqual(["already-converted"]);
  });
});

describe("no bypass exists", () => {
  it("assessConversion takes exactly one argument — there is nowhere to put a force flag", () => {
    expect(assessConversion.length).toBe(1);
    expect(() => assertNoBypass()).not.toThrow();
  });

  it("no extra property on the subject can unblock a blocked conversion", () => {
    const forced = {
      ...subject({ duplicate: { status: "Blocked", reason: "already captured" }, validationStatus: "Incomplete" }),
      force: true,
      forceTotalsMismatch: true,
      supervisorPin: "vyron-supervisor",
      approvedBy: "someone",
      hasSupervisorOverride: true,
    };
    const r = assessConversion(forced as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocks.map((b) => b.code)).toEqual(expect.arrayContaining(["duplicate-blocked", "validation-incomplete"]));
  });

  it("the module exports nothing that looks like an override", async () => {
    const mod = await import("./conversion");
    expect(Object.keys(mod).some((n) => /force|override|bypass(?!$)|pin/i.test(n))).toBe(false);
  });
});

/**
 * Phase 5N — the credit/debit note boundary.
 *
 * THE ACCOUNTING CONSEQUENCE BEING PREVENTED, stated once here because it
 * is the reason every test below exists:
 *
 *   A supplier credit note REDUCES what the company owes that supplier.
 *   The only thing `assessConversion` can produce is an input to
 *   `createPurchaseBill`, which INCREASES it. Convert a R575 credit note
 *   and the supplier's balance ends up R1,150 wrong — R575 that should
 *   have come off, plus R575 that went on — with a correct-looking bill to
 *   explain it. Every figure on that bill is right. Only the sign is
 *   wrong, and nobody reconciling totals sees a sign.
 *
 * This is a REFUSAL and not a feature on purpose. `createPurchaseBill`
 * already accepts a `documentType` of "Credit Note", so making this
 * "work" is one line. Booking one correctly means the posting rules, the
 * VAT return treatment, the allocation against the original bill and the
 * supplier ageing all agree about the sign — none of which has been
 * verified for this path. A one-line change that produces a plausible
 * wrong number is the most dangerous kind there is.
 */
describe("credit and debit notes are refused, never converted", () => {
  it("a CREDIT NOTE cannot become an ordinary Bill", () => {
    const r = assessConversion(subject({ documentType: "Credit Note" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocks.map((b) => b.code)).toContain("not-an-invoice");
  });

  it("a DEBIT NOTE cannot become an ordinary Bill", () => {
    const r = assessConversion(subject({ documentType: "Debit Note" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocks.map((b) => b.code)).toContain("not-an-invoice");
  });

  it("the refusal holds even when EVERYTHING else about the capture is perfect", () => {
    // The dangerous case is not a broken credit note — it is a flawless
    // one. Supplier resolved, arithmetic reconciled, no duplicate,
    // validation Pass. Without this block it would convert silently.
    const r = assessConversion(
      subject({ documentType: "Credit Note", validationStatus: "Pass", duplicate: { status: "None", reason: "" } }),
    );
    expect(r.ok).toBe(false);
  });

  it("the block does not depend on the validation finding", () => {
    // Two independent layers. `not-an-invoice` at validation depends on
    // the model having read the heading; this one is structural. Either
    // alone would be a single point of failure for an error that is
    // invisible once posted.
    const r = assessConversion(subject({ documentType: "Credit Note", validationStatus: "Pass" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocks.map((b) => b.code)).toEqual(["not-an-invoice"]);
  });

  it("tells the reviewer what would have gone wrong, not merely that it stopped", () => {
    const r = assessConversion(subject({ documentType: "Credit Note" }));
    if (r.ok) return;
    const message = r.blocks.find((b) => b.code === "not-an-invoice")!.message;
    expect(message).toMatch(/increase what you owe/i);
    expect(message).toMatch(/by hand/i);
  });

  it("an ordinary invoice, and an unknown document type, still convert", () => {
    // Null is every capture taken before 0109, and most documents never
    // print the word "invoice" in a place a model reads as a heading.
    // Refusing those would refuse almost everything for no safety gain —
    // the validation finding remains the layer that catches a misread.
    expect(assessConversion(subject({ documentType: "Invoice" })).ok).toBe(true);
    expect(assessConversion(subject({ documentType: null })).ok).toBe(true);
    expect(assessConversion(subject({ documentType: "  " })).ok).toBe(true);
  });

  it("does not care how the word is cased", () => {
    expect(assessConversion(subject({ documentType: "invoice" })).ok).toBe(true);
    expect(assessConversion(subject({ documentType: "CREDIT NOTE" })).ok).toBe(false);
  });

  it("the resulting bill input never carries a documentType at all", () => {
    // The brief is explicit: do not pass document_type into the accounting
    // conversion merely to make a corpus pass. The only documents that get
    // this far are invoices, so the field would be noise at best and a
    // sign change at worst.
    const r = assessConversion(subject());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("documentType" in r.input).toBe(false);
  });
});

/**
 * Phase 5N — the foreign-currency boundary.
 *
 * THE ACCOUNTING CONSEQUENCE BEING PREVENTED:
 *
 *   `CreatePurchaseBillInput` has no currency field. Not a defaulted one —
 *   none at all. Every amount handed to it is stored and posted as the
 *   company's base currency. A USD 1,200 invoice therefore becomes a bill
 *   for R1,200: the liability understated by roughly eighteen thousand
 *   rand, and nothing anywhere flags it, because R1,200 is an entirely
 *   ordinary number.
 */
describe("a foreign-currency invoice is refused, never converted", () => {
  it("a USD invoice in a ZAR company cannot become a Bill", () => {
    const r = assessConversion(subject({ currencyCode: "USD", baseCurrencyCode: "ZAR" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocks.map((b) => b.code)).toContain("foreign-currency-unsupported");
  });

  it("does not convert, does not apply a rate, and does not treat the amount as ZAR", () => {
    const r = assessConversion(subject({ currencyCode: "USD", baseCurrencyCode: "ZAR" }));
    // The decisive assertion: there is NO successful outcome here, so
    // there is no input carrying an unconverted or invented amount.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The decisive part is the refusal itself: with no `ok: true` there is
    // no input, so there is no amount to have been converted. The message
    // may tell the person to use THEIR rate — what it must never do is
    // claim VYRON applied one.
    expect(JSON.stringify(r.blocks)).not.toMatch(/converted at|exchange rate|we have used|applied a rate/i);
  });

  it("names both currencies, so the reviewer knows what to do next", () => {
    const r = assessConversion(subject({ currencyCode: "EUR", baseCurrencyCode: "ZAR" }));
    if (r.ok) return;
    const message = r.blocks.find((b) => b.code === "foreign-currency-unsupported")!.message;
    expect(message).toContain("EUR");
    expect(message).toContain("ZAR");
  });

  it("the company's OWN currency is not foreign, whatever it is", () => {
    // A USD-based company booking a USD invoice is domestic.
    expect(assessConversion(subject({ currencyCode: "USD", baseCurrencyCode: "USD" })).ok).toBe(true);
    expect(assessConversion(subject({ currencyCode: "zar", baseCurrencyCode: "ZAR" })).ok).toBe(true);
    expect(assessConversion(subject({ currencyCode: " ZAR ", baseCurrencyCode: "ZAR" })).ok).toBe(true);
  });

  it("an unprinted currency is not foreign", () => {
    // Most ZAR invoices never print a currency code. Refusing those would
    // refuse almost every real document.
    expect(assessConversion(subject({ currencyCode: null })).ok).toBe(true);
    expect(assessConversion(subject({ currencyCode: "   " })).ok).toBe(true);
  });

  it("reports both boundaries at once when a document trips both", () => {
    const r = assessConversion(subject({ documentType: "Credit Note", currencyCode: "GBP", baseCurrencyCode: "ZAR" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocks.map((b) => b.code)).toEqual(
      expect.arrayContaining(["not-an-invoice", "foreign-currency-unsupported"]),
    );
  });
});
