/**
 * Phase 28 — regression coverage for the deterministic narration-pattern
 * extraction that replaces the old "the AI infers meaning directly from
 * the bank narration string" behavior. The forensic investigation found
 * 73 of 180 real production classifications went to Bank Charges,
 * driven by AI reasoning like "the description mentioning 'FNB OB Pmt'
 * which typically indicates a payment to the bank" — for transactions
 * that were, based on the beneficiary field (named individuals, amounts
 * from hundreds to hundreds of thousands of Rand), almost certainly
 * payroll/contractor payments. This module's OWN job is only to group
 * transactions for historical-evidence lookup — it must never itself
 * assert a prefix "means" anything, which these tests verify directly.
 */
import { describe, expect, it } from "vitest";
import { extractNarrationPrefix, amountBand, amountBandBounds, derivePattern, patternKey } from "./narration-pattern";
import type { BankTransactionRecord } from "@/server/accounting/types";

function txn(overrides: Partial<Pick<BankTransactionRecord, "description" | "beneficiary" | "debit" | "credit">> = {}) {
  return { description: "", beneficiary: "", debit: 0, credit: 0, ...overrides };
}

describe("extractNarrationPrefix", () => {
  it("recognises 'FNB OB Pmt' as a prefix — but this is ONLY a grouping key, never evidence of Bank Charges", () => {
    expect(extractNarrationPrefix("FNB OB Pmt FNB OB 000024370 Ses \tSesethu Simbeku")).toBe("FNB OB Pmt");
  });

  it("recognises 'FNB OB Trf' distinctly from 'FNB OB Pmt' — never masked by the shared 'FNB OB' stem", () => {
    expect(extractNarrationPrefix("FNB OB Trf FNB OB Trf 000024372 FNB CC Cb")).toBe("FNB OB Trf");
  });

  it("recognises 'Overseas Bank Charge' as its own distinct prefix — a genuine bank-fee narration, never conflated with 'FNB OB Pmt'", () => {
    expect(extractNarrationPrefix("Overseas Bank Charge S500W70230 Sd3Gr3Dmp5Wmt051")).toBe("Overseas Bank Charge");
  });

  it("recognises 'Magtape Debit' and 'Magtape Credit' as distinct prefixes", () => {
    expect(extractNarrationPrefix("Magtape Debit Advice Fee Db 247191018")).toBe("Magtape Debit");
    expect(extractNarrationPrefix("Magtape Credit Woolworths 2590826520434")).toBe("Magtape Credit");
  });

  it("is case-insensitive", () => {
    expect(extractNarrationPrefix("fnb ob pmt something")).toBe("FNB OB Pmt");
  });

  it("falls back to 'Other' for an unrecognised narration — never guessed, never fuzzy-matched", () => {
    expect(extractNarrationPrefix("Random Unlisted Narration Text")).toBe("Other");
    expect(extractNarrationPrefix("")).toBe("Other");
  });

  it("does not match a prefix that appears mid-string, only at the start", () => {
    expect(extractNarrationPrefix("Reference containing FNB OB Pmt in the middle")).toBe("Other");
  });
});

describe("amountBand — deterministic, fixed thresholds", () => {
  it("bands a genuine small bank-fee-sized amount separately from wage-sized amounts", () => {
    expect(amountBand(60)).toBe("0-500");
    expect(amountBand(143.23)).toBe("0-500");
    expect(amountBand(499.99)).toBe("0-500");
  });

  it("bands mid-size amounts consistently", () => {
    expect(amountBand(500)).toBe("500-5000");
    expect(amountBand(4999)).toBe("500-5000");
    expect(amountBand(5000)).toBe("5000-25000");
    expect(amountBand(15000)).toBe("5000-25000");
    expect(amountBand(25000)).toBe("25000-100000");
    expect(amountBand(99999)).toBe("25000-100000");
  });

  it("bands very large amounts into the top-open band", () => {
    expect(amountBand(100000)).toBe("100000+");
    expect(amountBand(500000)).toBe("100000+");
  });
});

describe("amountBandBounds — the exact inverse of amountBand, used to build a repository filter", () => {
  it("round-trips every band label amountBand can produce", () => {
    for (const amount of [0, 60, 500, 4999, 5000, 25000, 99999, 100000, 500000]) {
      const label = amountBand(amount);
      const bounds = amountBandBounds(label);
      expect(bounds).not.toBeNull();
      expect(amount).toBeGreaterThanOrEqual(bounds!.min);
      if (bounds!.max !== null) expect(amount).toBeLessThan(bounds!.max);
    }
  });

  it("returns null max for the top, unbounded band", () => {
    expect(amountBandBounds("100000+")).toEqual({ min: 100000, max: null });
  });

  it("returns null for an unrecognised label — never a silent match-everything range", () => {
    expect(amountBandBounds("not-a-real-band")).toBeNull();
  });
});

describe("derivePattern", () => {
  it("derives the exact pattern for a real production Bank-Charges-misclassified transaction", () => {
    const t = txn({ description: "FNB OB Pmt FNB OB 000024370 Ses \tSesethu Simbeku", beneficiary: "FNB OB Pmt FNB OB 000024370 Ses \tSesethu Simbeku", debit: 6525.64, credit: 0 });
    expect(derivePattern(t)).toEqual({ prefix: "FNB OB Pmt", amountBand: "5000-25000", direction: "Debit" });
  });

  it("derives the exact pattern for a real production genuine bank charge", () => {
    const t = txn({ description: "Overseas Bank Charge S500W70Mh0 Sd3Gr068V5Wx30H1", beneficiary: "Overseas Bank Charge S500W70Mh0 Sd3Gr068V5Wx30H1", debit: 143.23, credit: 0 });
    expect(derivePattern(t)).toEqual({ prefix: "Overseas Bank Charge", amountBand: "0-500", direction: "Debit" });
  });

  it("prefers beneficiary over description when both are present and differ", () => {
    const t = txn({ description: "generic import description", beneficiary: "FNB OB Pmt Someone", debit: 1000, credit: 0 });
    expect(derivePattern(t).prefix).toBe("FNB OB Pmt");
  });

  it("falls back to description when beneficiary is empty", () => {
    const t = txn({ description: "Magtape Debit Advice Fee Db 247191018", beneficiary: "", debit: 60, credit: 0 });
    expect(derivePattern(t).prefix).toBe("Magtape Debit");
  });

  it("derives Credit direction from a positive credit amount", () => {
    const t = txn({ description: "Magtape Credit Woolworths 2590826520434", beneficiary: "Magtape Credit Woolworths 2590826520434", debit: 0, credit: 402516.62 });
    expect(derivePattern(t)).toEqual({ prefix: "Magtape Credit", amountBand: "100000+", direction: "Credit" });
  });
});

describe("patternKey", () => {
  it("is stable and derived only from the pattern's own fields", () => {
    const pattern = { prefix: "FNB OB Pmt", amountBand: "5000-25000", direction: "Debit" as const };
    expect(patternKey(pattern)).toBe("FNB OB Pmt|5000-25000|Debit");
  });

  it("two transactions with the same structural pattern but different beneficiaries produce the SAME key — the whole point: exact-beneficiary matching is not required", () => {
    const john = derivePattern(txn({ beneficiary: "FNB OB Pmt John Smith", debit: 15000 }));
    const jane = derivePattern(txn({ beneficiary: "FNB OB Pmt Jane Smith", debit: 18000 }));
    expect(patternKey(john)).toBe(patternKey(jane));
  });
});
