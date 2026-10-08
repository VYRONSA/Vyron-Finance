/**
 * @vitest-environment node
 *
 * SD-3D — the reconciliation engine: matching hierarchy, every category and
 * sub-status, the balance identity, and the accounting rules the owner set.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  ENGINE_VERSION,
  reconcileStatement,
  type EngineInput,
  type LedgerRecord,
  type ReconciliationLine,
  type ResolutionInput,
  type UnpostedRecord,
} from "./reconciliation-engine-sd3d";

let nextId = 1;
const line = (p: Partial<ReconciliationLine>): ReconciliationLine => {
  const id = nextId++;
  return { id, lineOrder: id, pageNumber: 1, date: "2026-09-10", reference: null, description: null, type: "invoice", debit: null, credit: null, ...p };
};
const rec = (p: Partial<LedgerRecord> & Pick<LedgerRecord, "refType" | "amount">): LedgerRecord => ({ refId: nextId++, date: "2026-09-10", number: "", evidence: "", ...p });

function input(p: { opening?: number; closing: number; lines?: ReconciliationLine[]; ledger?: LedgerRecord[]; unposted?: UnpostedRecord[]; resolutions?: ResolutionInput[]; periodFrom?: string | null }): EngineInput {
  return {
    engineVersion: ENGINE_VERSION,
    statement: { id: 1, statementDate: "2026-09-30", periodFrom: p.periodFrom === undefined ? "2026-09-01" : p.periodFrom, openingBalance: p.opening ?? 0, closingBalance: p.closing, signConvention: "debit-increases-owed" },
    lines: p.lines ?? [],
    ledger: p.ledger ?? [],
    unposted: p.unposted ?? [],
    resolutions: p.resolutions ?? [],
  };
}
const only = (r: ReturnType<typeof reconcileStatement>) => r.items.map((i) => `${i.category}/${i.subStatus}`);

describe("balances", () => {
  it("S, P (ledger at the statement date), D = S − P, and D = Explained + Unexplained", () => {
    const r = reconcileStatement(input({
      opening: 100, closing: 400,
      lines: [line({ reference: "0001", debit: 300 })],
      ledger: [rec({ refType: "bill", amount: 100, date: "2026-08-15", number: "OLD" }), rec({ refType: "bill", amount: 300, number: "0001" }), rec({ refType: "bill", amount: 50, date: "2026-10-05", number: "LATER" })],
    }));
    expect(r).toMatchObject({ statementClosing: 400, balanceAt: 400, balanceBeforeWindow: 100, difference: 0, explained: 0, unexplained: 0, residual: 0 });
    expect(only(r)).toEqual(["Matched/exact"]);
  });

  it("the window starts at the period, else the earliest line date", () => {
    expect(reconcileStatement(input({ closing: 0 })).windowFrom).toBe("2026-09-01");
    expect(reconcileStatement(input({ closing: 10, periodFrom: null, lines: [line({ date: "2026-09-05", debit: 10 })] })).windowFrom).toBe("2026-09-05");
  });

  it("an opening balance difference is reported and left UNEXPLAINED (no adjustment is ever made)", () => {
    const r = reconcileStatement(input({ opening: 500, closing: 500, ledger: [rec({ refType: "bill", amount: 450, date: "2026-08-01", number: "X" })] }));
    expect(r.items[0]).toMatchObject({ category: "Opening Balance Difference", effect: 50, explained: false });
    expect(r).toMatchObject({ difference: 50, explained: 0, unexplained: 50 });
  });
});

describe("matching hierarchy", () => {
  it("T1 exact reference — leading zeros are part of the reference", () => {
    const r = reconcileStatement(input({ closing: 10, lines: [line({ reference: "0001042", debit: 10 })], ledger: [rec({ refType: "bill", amount: 10, number: "0001042" })] }));
    expect(r.items[0]).toMatchObject({ category: "Matched", subStatus: "exact", matchTier: "exact" });
  });

  it("T2 normalised reference (case/punctuation), but NEVER by stripping leading zeros", () => {
    const ok = reconcileStatement(input({ closing: 10, lines: [line({ reference: "inv-0001042", debit: 10 })], ledger: [rec({ refType: "bill", amount: 10, number: "INV 0001042" })] }));
    expect(ok.items[0]).toMatchObject({ category: "Matched", matchTier: "normalised" });
    const zeros = reconcileStatement(input({ closing: 10, lines: [line({ reference: "0001042", debit: 10 })], ledger: [rec({ refType: "bill", amount: 10, number: "1042" })] }));
    expect(only(zeros)).toEqual(["Missing in PRECISIA/not-captured", "Missing on Statement/in-period"]);
    expect(zeros.items[0].suggestions[0].reason).toMatch(/suggestion only/);
  });

  it("a compatible document type is required: a credit note never matches a bill", () => {
    const r = reconcileStatement(input({ closing: -10, lines: [line({ reference: "CN1", type: "credit-note", credit: 10 })], ledger: [rec({ refType: "bill", amount: 10, number: "CN1" })] }));
    expect(only(r)).toEqual(["Credit Note/not-captured", "Missing on Statement/in-period"]);
  });

  it("AMOUNT ALONE NEVER MATCHES — amount + date is a suggestion only", () => {
    const r = reconcileStatement(input({ closing: 250, lines: [line({ reference: "A-1", debit: 250 })], ledger: [rec({ refType: "bill", amount: 250, number: "ZZ-99" })] }));
    expect(r.items[0]).toMatchObject({ category: "Missing in PRECISIA", matchTier: null });
    expect(r.items[0].suggestions).toHaveLength(1);
    expect(r.items[0].suggestions[0].reason).toMatch(/no reference evidence \(suggestion only\)/);
    expect(r.items[1].category).toBe("Missing on Statement");
  });

  it("several candidates are AMBIGUOUS (potential duplicate) — none is chosen", () => {
    const r = reconcileStatement(input({
      closing: 10,
      lines: [line({ reference: "0007", debit: 10 })],
      ledger: [rec({ refType: "bill", amount: 10, number: "0007" }), rec({ refType: "bill", amount: 10, number: "0007" })],
    }));
    expect(only(r)).toEqual(["Potential Duplicate/multiple-precisia"]);
    expect(r.items[0].relatedRefs).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ matchTier: null, explained: false });
  });

  it("P1 payment: exact amount, within 7 days AND reference evidence", () => {
    const r = reconcileStatement(input({
      closing: -500,
      lines: [line({ type: "payment", reference: "EFT 20260915", description: "Payment", credit: 500, date: "2026-09-15" })],
      ledger: [rec({ refType: "bank-transaction", amount: -500, date: "2026-09-18", number: "20260915", evidence: "KAROO EFT" })],
    }));
    expect(r.items[0]).toMatchObject({ category: "Payment", subStatus: "matched", matchTier: "payment-evidence" });
  });

  it("a payment with the right amount and date but no reference evidence is only SUGGESTED", () => {
    const r = reconcileStatement(input({
      closing: -500,
      lines: [line({ type: "payment", reference: "PMT A", credit: 500, date: "2026-09-15" })],
      ledger: [rec({ refType: "supplier-payment", amount: -500, date: "2026-09-16", number: "SP-77", evidence: "" })],
    }));
    expect(only(r)).toEqual(["Payment/suggested", "Missing on Statement/payment"]);
  });

  it("a payment recorded after the statement date is a timing difference", () => {
    const r = reconcileStatement(input({
      closing: -300,
      lines: [line({ type: "payment", reference: "EFT 7788", credit: 300, date: "2026-09-29" })],
      ledger: [rec({ refType: "bank-transaction", amount: -300, date: "2026-10-02", number: "7788" })],
    }));
    expect(only(r)).toEqual(["Payment/timing"]);
    expect(r.balanceAt).toBe(0);
  });

  it("T0 a reviewer's manual link wins and is recorded as manual", () => {
    const l = line({ reference: "WHATEVER", debit: 90 });
    const b = rec({ refType: "bill", amount: 100, number: "B-1" });
    const r = reconcileStatement(input({ closing: 90, lines: [l], ledger: [b], resolutions: [{ id: 1, action: "manual-link", lineId: l.id, refType: "bill", refId: b.refId, revokesId: null, reason: "Supplier's own number" }] }));
    expect(r.items[0]).toMatchObject({ category: "Amount Difference", matchTier: "manual", amountDifference: -10, effect: -10 });
  });

  it("a revoked link no longer applies", () => {
    const l = line({ reference: "WHATEVER", debit: 100 });
    const b = rec({ refType: "bill", amount: 100, number: "B-1" });
    const r = reconcileStatement(input({
      closing: 100, lines: [l], ledger: [b],
      resolutions: [
        { id: 1, action: "manual-link", lineId: l.id, refType: "bill", refId: b.refId, revokesId: null, reason: "x" },
        { id: 2, action: "revoke", lineId: null, refType: null, refId: null, revokesId: 1, reason: "wrong bill" },
      ],
    }));
    expect(r.items[0].category).toBe("Missing in PRECISIA");
  });
});

describe("classifications", () => {
  it("Amount Difference, with a VAT hint when the difference is the VAT", () => {
    const r = reconcileStatement(input({ closing: 115, lines: [line({ reference: "77", debit: 115 })], ledger: [rec({ refType: "bill", amount: 100, number: "77" })] }));
    expect(r.items[0]).toMatchObject({ category: "Amount Difference", subStatus: "vat-hint", effect: 15, explained: true });
  });

  it("Missing in PRECISIA splits: not captured / captured — draft / imported — not posted", () => {
    const unposted: UnpostedRecord[] = [
      { refType: "capture", refId: 5, number: "C-1", date: null, amount: 10, documentType: "Bill", kind: "captured-draft", source: "Supplier Documents capture #5 (NeedsReview)" },
      { refType: "unposted-bill", refId: 6, number: "X-1", date: null, amount: 10, documentType: "Bill", kind: "imported-not-posted", source: "Purchasing draft (Xero-migrated or entered by hand)" },
    ];
    const r = reconcileStatement(input({
      closing: 30, unposted,
      lines: [line({ reference: "C-1", debit: 10 }), line({ reference: "X-1", debit: 10 }), line({ reference: "N-1", debit: 10 })],
    }));
    expect(only(r)).toEqual(["Missing in PRECISIA/captured-draft", "Missing in PRECISIA/imported-not-posted", "Missing in PRECISIA/not-captured"]);
    expect(r.items[0]).toMatchObject({ refType: "capture", refId: 5 });
    expect(r.items[1].message).toMatch(/never posted/);
    expect(r.items[1].message).not.toMatch(/captured/);
  });

  it("Missing on Statement: in period, and timing near the statement date", () => {
    const r = reconcileStatement(input({ closing: 0, ledger: [rec({ refType: "bill", amount: 10, date: "2026-09-05", number: "A" }), rec({ refType: "bill", amount: 20, date: "2026-09-28", number: "B" })] }));
    expect(only(r)).toEqual(["Missing on Statement/in-period", "Missing on Statement/timing"]);
    expect(r).toMatchObject({ difference: -30, explained: -30, unexplained: 0 });
  });

  it("Credit Note category: matched, and missing on statement", () => {
    const r = reconcileStatement(input({
      closing: -10,
      lines: [line({ reference: "CN-1", type: "credit-note", credit: 10 })],
      ledger: [rec({ refType: "credit-note", amount: -10, number: "CN-1" }), rec({ refType: "credit-note", amount: -5, number: "CN-2", date: "2026-09-02" })],
    }));
    expect(only(r)).toEqual(["Credit Note/matched", "Credit Note/missing-on-statement"]);
  });

  it("Unclassified: interest/adjustment lines, and an unknown credit with no match", () => {
    const r = reconcileStatement(input({ closing: 4, lines: [line({ type: "interest", debit: 5 }), line({ type: "unknown", reference: "?", credit: 1 })] }));
    expect(only(r)).toEqual(["Unclassified/interest", "Unclassified/unknown-credit"]);
    expect(r.unexplained).toBe(4);
  });

  it("an unknown credit is tried as a credit note AND as a payment — the sign never decides", () => {
    const cn = reconcileStatement(input({ closing: -10, lines: [line({ type: "unknown", reference: "CN-9", credit: 10 })], ledger: [rec({ refType: "credit-note", amount: -10, number: "CN-9" })] }));
    expect(cn.items[0].category).toBe("Credit Note");
    const pay = reconcileStatement(input({ closing: -10, lines: [line({ type: "unknown", reference: "EFT 5555", credit: 10 })], ledger: [rec({ refType: "supplier-payment", amount: -10, number: "5555" })] }));
    expect(pay.items[0].category).toBe("Payment");
  });

  it("Potential Duplicate: a line printed twice on the statement", () => {
    const r = reconcileStatement(input({
      closing: 20, lines: [line({ reference: "D1", debit: 10, date: "2026-09-02" }), line({ reference: "D1", debit: 10, date: "2026-09-02" })],
      ledger: [rec({ refType: "bill", amount: 10, number: "D1", date: "2026-09-02" })],
    }));
    expect(only(r)).toEqual(["Matched/exact", "Potential Duplicate/statement-repeat"]);
    expect(r.unexplained).toBe(10);
  });

  it("a payment recorded as BOTH a supplier payment and a bank transaction is flagged — never netted", () => {
    const sp = rec({ refType: "supplier-payment", amount: -400, number: "SP-1", evidence: "EFT 9001", date: "2026-09-20" });
    const bt = rec({ refType: "bank-transaction", amount: -400, number: "9001", evidence: "KAROO", date: "2026-09-20" });
    const withLine = reconcileStatement(input({ closing: -400, lines: [line({ type: "payment", reference: "EFT 9001", credit: 400, date: "2026-09-20" })], ledger: [sp, bt] }));
    expect(only(withLine)).toEqual(["Potential Duplicate/double-recorded-payment"]);
    expect(withLine.items[0].relatedRefs.map((x) => x.refType).sort()).toEqual(["bank-transaction", "supplier-payment"]);
    expect(withLine).toMatchObject({ balanceAt: -800, difference: 400, unexplained: 400 });

    const noLine = reconcileStatement(input({ closing: 0, ledger: [sp, bt] }));
    expect(only(noLine)).toEqual(["Potential Duplicate/double-recorded-payment"]);
  });

  it("a reviewer's explanation moves an item into Explained (by reviewer), with its id", () => {
    const r = reconcileStatement(input({ opening: 50, closing: 50, resolutions: [{ id: 9, action: "explained", lineId: null, refType: "opening-difference", refId: null, revokesId: null, reason: "Pre-migration balance" }] }));
    expect(r.items[0]).toMatchObject({ explained: true, explainedByResolutionId: 9 });
    expect(r).toMatchObject({ explained: 50, explainedByReviewer: 50, unexplained: 0 });
  });

  it("a record dated before the period that a line matches is a timing note, and D still holds", () => {
    const r = reconcileStatement(input({
      opening: 100, closing: 100,
      lines: [line({ reference: "OLD-1", debit: 100, date: "2026-09-03" }), line({ type: "payment", reference: "EFT 1234", credit: 100, date: "2026-09-04" })],
      ledger: [rec({ refType: "bill", amount: 100, number: "OLD-1", date: "2026-08-30" }), rec({ refType: "bank-transaction", amount: -100, number: "1234", date: "2026-09-04" })],
    }));
    expect(r.items.find((i) => i.lineOrder !== null && i.matchTier === "exact")!.message).toMatch(/opening balance/);
    expect(r.residual).toBe(0);
  });
});

describe("properties", () => {
  function rng(seed: number) {
    let s = seed;
    return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  }

  it("a statement generated from the ledger reconciles completely: all matched, D = 0, nothing unexplained", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const ledger: LedgerRecord[] = [];
      const lines: ReconciliationLine[] = [];
      let total = 0;
      for (let i = 0; i < 12; i++) {
        const day = String(1 + Math.floor(r() * 28)).padStart(2, "0");
        const amount = Math.round(r() * 100000) / 100 + 1;
        if (r() < 0.6) {
          const number = `00${seed}${i}${Math.floor(r() * 1000)}`;
          ledger.push(rec({ refType: "bill", amount, number, date: `2026-09-${day}` }));
          lines.push(line({ reference: number, debit: amount, date: `2026-09-${day}` }));
          total += Math.round(amount * 100);
        } else {
          const number = `PAY${seed}X${i}`;
          ledger.push(rec({ refType: "supplier-payment", amount: -amount, number, date: `2026-09-${day}` }));
          lines.push(line({ type: "payment", reference: number, credit: amount, date: `2026-09-${day}` }));
          total -= Math.round(amount * 100);
        }
      }
      const result = reconcileStatement(input({ closing: total / 100, lines, ledger }));
      expect(result.difference, `seed ${seed}`).toBe(0);
      expect(result.unexplained, `seed ${seed}`).toBe(0);
      expect(result.items.every((i) => i.subStatus === "matched" || i.category === "Matched"), `seed ${seed}`).toBe(true);
    }
  });

  it("D = Explained + Unexplained to the cent and the residual is zero, for any input", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed * 7);
      const types = ["invoice", "credit-note", "payment", "unknown", "interest"] as const;
      const refTypes = ["bill", "credit-note", "supplier-payment", "bank-transaction", "debit-note"] as const;
      const lines = Array.from({ length: 10 }, () => {
        const t = types[Math.floor(r() * types.length)];
        const amount = Math.round(r() * 50000) / 100 + 0.01;
        const credit = t === "credit-note" || t === "payment" || r() < 0.2;
        return line({ type: t, reference: `R${Math.floor(r() * 6)}`, debit: credit ? null : amount, credit: credit ? amount : null, date: `2026-09-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}` });
      });
      const ledger = Array.from({ length: 10 }, () => {
        const t = refTypes[Math.floor(r() * refTypes.length)];
        const amount = Math.round(r() * 50000) / 100 + 0.01;
        const sign = t === "bill" || t === "debit-note" ? 1 : -1;
        return rec({ refType: t, amount: sign * amount, number: `R${Math.floor(r() * 6)}`, date: `2026-${r() < 0.2 ? "08" : "09"}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}` });
      });
      // A validated statement: closing = opening + its lines (Ready requires it).
      const opening = Math.round(r() * 1000);
      const closing = (Math.round(opening * 100) + lines.reduce((s, l) => s + Math.round((l.debit ?? 0) * 100) - Math.round((l.credit ?? 0) * 100), 0)) / 100;
      const result = reconcileStatement(input({ opening, closing, lines, ledger }));
      expect(Math.round((result.explained + result.unexplained) * 100), `seed ${seed}`).toBe(Math.round(result.difference * 100));
      expect(result.residual, `seed ${seed}`).toBe(0);
      expect(Math.round(result.items.reduce((s, i) => s + i.effect, 0) * 100)).toBe(Math.round(result.difference * 100));
    }
  });

  it("a statement that does not add up is never forced: the gap is reported as a residual inside Unexplained", () => {
    const r = reconcileStatement(input({ opening: 0, closing: 105, lines: [line({ reference: "1", debit: 100 })], ledger: [rec({ refType: "bill", amount: 100, number: "1" })] }));
    expect(r).toMatchObject({ difference: 5, explained: 0, unexplained: 5, residual: 5 });
  });

  it("is deterministic: the same input gives the same result, and the canonical input is stable", () => {
    const i = input({ closing: 10, lines: [line({ reference: "1", debit: 10 })], ledger: [rec({ refType: "bill", amount: 10, number: "1" })] });
    expect(reconcileStatement(i)).toEqual(reconcileStatement(JSON.parse(JSON.stringify(i))));
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });
});
