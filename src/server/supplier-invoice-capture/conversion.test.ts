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
import { assertNoBypass, assessConversion, conversionApprovalAmount } from "./conversion";
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
      documentType: "Bill",
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
 * The document-type boundary — Phase 5N, credit notes enabled in SD-1.
 *
 * THE ACCOUNTING CONSEQUENCE STILL BEING PREVENTED: a supplier credit note
 * REDUCES what the company owes; a bill INCREASES it. Booked as a Bill, a
 * R575 credit note leaves the supplier's balance R1,150 wrong with every
 * figure on the document correct. So the output's document type is decided
 * structurally from the reviewed document type, and a credit note can
 * never come out as a "Bill".
 *
 * SD-1 verified the existing credit-note path before enabling it: the
 * seeded "Supplier Credit Note" posting rule reverses a bill (DR Creditors /
 * CR expense / CR VAT Input), it is approved through the same limits, and
 * the VAT return signs it as a reversal. Debit notes remain refused.
 */
describe("the document-type boundary: invoices and credit notes convert, nothing else", () => {
  it("a CREDIT NOTE becomes a Draft supplier Credit Note — never an ordinary Bill", () => {
    const r = assessConversion(subject({ documentType: "Credit Note" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.documentType).toBe("Credit Note");
  });

  it("a credit note printed with negative amounts is carried as magnitudes; the type carries the sign", () => {
    const r = assessConversion(
      subject({ documentType: "Credit Note", lines: [line({ quantity: -2, unitPrice: 500, discount: -10 })] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.lines).toEqual([
      { description: "Consulting", glAccount: "5100", vatCode: "Standard Rated", quantity: 2, unitCost: 500, discount: 10 },
    ]);
  });

  it("a credit note whose lines disagree in sign is refused rather than guessed", () => {
    const r = assessConversion(
      subject({
        documentType: "Credit Note",
        lines: [line({ lineOrder: 0, quantity: 2, unitPrice: 500 }), line({ lineOrder: 1, quantity: -1, unitPrice: 100 })],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocks.map((b) => b.code)).toContain("credit-note-mixed-signs");
  });

  it("an INVOICE (or an unknown type) becomes a Draft Bill, stated explicitly", () => {
    for (const documentType of ["Invoice", null, "  "]) {
      const r = assessConversion(subject({ documentType }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.input.documentType).toBe("Bill");
    }
  });

  it("does not care how the word is cased", () => {
    const invoice = assessConversion(subject({ documentType: "invoice" }));
    const credit = assessConversion(subject({ documentType: "CREDIT NOTE" }));
    expect(invoice.ok && invoice.input.documentType).toBe("Bill");
    expect(credit.ok && credit.input.documentType).toBe("Credit Note");
  });

  it("a DEBIT NOTE is still refused, and the reviewer is told to enter it by hand", () => {
    const r = assessConversion(subject({ documentType: "Debit Note" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const block = r.blocks.find((b) => b.code === "not-an-invoice")!;
    expect(block.message).toMatch(/by hand/i);
  });

  it("anything that is not a supplier document type is refused", () => {
    const r = assessConversion(subject({ documentType: "Other" }));
    expect(r.ok).toBe(false);
  });

  it("a credit note is held to every other block — a blocked duplicate still stops it", () => {
    const r = assessConversion(subject({ documentType: "Credit Note", duplicate: { status: "Blocked", reason: "already captured" } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocks.map((b) => b.code)).toContain("duplicate-blocked");
  });
});

describe("validation must describe the values being converted (SD-1)", () => {
  it("a Pending verdict — the capture was corrected and not yet re-validated — stops conversion", () => {
    const r = assessConversion(subject({ validationStatus: "Pending" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocks.map((b) => b.code)).toContain("validation-pending");
  });
});

describe("the approval amount (SD-1)", () => {
  it("is the computed document total when the printed total is missing — never zero", () => {
    expect(conversionApprovalAmount(1150, null)).toBe(1150);
  });

  it("takes the larger of the computed and the printed total, so a limit cannot be undercut", () => {
    expect(conversionApprovalAmount(1150, 9200)).toBe(9200);
    expect(conversionApprovalAmount(9200, 1150)).toBe(9200);
  });

  it("is a magnitude for a credit note printed negative", () => {
    expect(conversionApprovalAmount(575, -575)).toBe(575);
  });

  it("refuses when no total can be computed, rather than defaulting to zero", () => {
    expect(() => conversionApprovalAmount(0, 1150)).toThrow(/no amount/i);
    expect(() => conversionApprovalAmount(Number.NaN, null)).toThrow(/no amount/i);
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
    const r = assessConversion(subject({ documentType: "Debit Note", currencyCode: "GBP", baseCurrencyCode: "ZAR" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocks.map((b) => b.code)).toEqual(
      expect.arrayContaining(["not-an-invoice", "foreign-currency-unsupported"]),
    );
  });
});
