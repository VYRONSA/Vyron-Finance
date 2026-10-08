/**
 * @vitest-environment node
 *
 * SD-3G — the DOCUMENT reconciliation engine: supplier invoices, debit notes
 * and credit notes against PRECISIA; payments out of scope; the zero-padded
 * reference tier; unposted bills counted but flagged; and the properties that
 * make payments irrelevant to every document result.
 */
import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  paddingWidth,
  reconcileStatement,
  type CaptureRecord,
  type DocumentRecord,
  type EngineInput,
  type ReconciliationLine,
  type ResolutionInput,
} from "./reconciliation-engine";

let nextId = 1;
const line = (p: Partial<ReconciliationLine>): ReconciliationLine => {
  const id = nextId++;
  return { id, lineOrder: id, pageNumber: 1, date: "2026-09-10", reference: null, description: null, type: "invoice", debit: null, credit: null, ...p };
};
const doc = (p: Partial<DocumentRecord> & Pick<DocumentRecord, "amount">): DocumentRecord => ({
  refType: "bill", refId: nextId++, date: "2026-09-10", number: "", posted: true, source: "posted bill", ...p,
});
const payment = (p: Partial<ReconciliationLine> = {}) => line({ type: "payment", reference: `PMT-${nextId}`, description: "Payment", credit: 500, ...p });

function input(p: { lines?: ReconciliationLine[]; documents?: DocumentRecord[]; captures?: CaptureRecord[]; resolutions?: ResolutionInput[]; periodFrom?: string | null }): EngineInput {
  return {
    engineVersion: ENGINE_VERSION,
    statement: { id: 1, statementDate: "2026-09-30", periodFrom: p.periodFrom === undefined ? "2026-09-01" : p.periodFrom, signConvention: "debit-increases-owed" },
    lines: p.lines ?? [],
    documents: p.documents ?? [],
    captures: p.captures ?? [],
    resolutions: p.resolutions ?? [],
  };
}
const kinds = (r: ReturnType<typeof reconcileStatement>) => r.items.map((i) => `${i.category}/${i.subStatus}`);

describe("figures: documents, not balances", () => {
  it("S = Documents on Statement, P = Documents in PRECISIA, D = S − P = Explained + Unexplained, residual 0", () => {
    const r = reconcileStatement(input({
      lines: [line({ reference: "INV-1", debit: 100 }), line({ reference: "CN-1", type: "credit-note", credit: 20 }), line({ reference: "INV-2", debit: 50 }), payment({ credit: 999 })],
      documents: [doc({ number: "INV-1", amount: 100 }), doc({ refType: "credit-note", number: "CN-1", amount: -20 }), doc({ number: "INV-9", amount: 30 })],
    }));
    expect(r.documentsOnStatement).toBe(130); // 100 − 20 + 50; the payment is not a document
    expect(r.documentsInPrecisia).toBe(110); // 100 − 20 + 30
    expect(r.difference).toBe(20);
    expect(r.explained + r.unexplained).toBe(r.difference);
    expect(r.residual).toBe(0);
    expect(r.basis).toBe("supplier-statement-documents");
  });

  it("no opening balance and no balance item exist on either side", () => {
    const r = reconcileStatement(input({ lines: [line({ reference: "INV-1", debit: 100 })], documents: [doc({ number: "INV-1", amount: 100 })] }));
    expect(r.items.some((i) => /opening/i.test(i.category))).toBe(false);
    expect(r).not.toHaveProperty("balanceAt");
  });

  it("the window starts at the period, else the earliest document line (payments do not move it)", () => {
    expect(reconcileStatement(input({ periodFrom: null, lines: [payment({ date: "2026-01-01" }), line({ reference: "A", debit: 1, date: "2026-09-05" })] })).windowFrom).toBe("2026-09-05");
    expect(reconcileStatement(input({ periodFrom: "2026-08-01", lines: [] })).windowFrom).toBe("2026-08-01");
  });
});

describe("payments are OUT OF SCOPE", () => {
  it("a payment line gets exactly one item: Out of Scope / payment, with no effect, no match and no suggestion", () => {
    const p = payment({ reference: "PMT 2026-09", credit: 1500 });
    const r = reconcileStatement(input({ lines: [p] }));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ lineId: p.id, category: "Out of Scope", subStatus: "payment", effect: 0, matchTier: null, refType: null, suggestions: [], relatedRefs: [] });
    expect(r.outOfScopePayments).toBe(1);
    expect(r.difference).toBe(0);
  });

  it("repeated payment rows are never a Potential Duplicate", () => {
    const a = payment({ reference: "000000002252003", credit: 2000, date: "2026-09-01" });
    const b = payment({ reference: "000000002252003", credit: 2000, date: "2026-09-01" });
    const r = reconcileStatement(input({ lines: [a, b] }));
    expect(kinds(r)).toEqual(["Out of Scope/payment", "Out of Scope/payment"]);
  });

  it("a payment with an unreadable amount is still only Out of Scope", () => {
    const r = reconcileStatement(input({ lines: [payment({ credit: null, debit: null })] }));
    expect(kinds(r)).toEqual(["Out of Scope/payment"]);
  });

  it("a payment whose reference equals a bill number is still not matched", () => {
    const bill = doc({ number: "2252003", amount: 2000 });
    const r = reconcileStatement(input({ lines: [payment({ reference: "2252003", credit: 2000 })], documents: [bill] }));
    expect(kinds(r)).toEqual(["Out of Scope/payment", "Missing on Statement/in-period"]);
  });

  it("PRECISIA supplier payments and bank transactions are not part of the input at all", () => {
    const keys = Object.keys(input({}));
    expect(keys).not.toContain("ledger");
    expect(keys).not.toContain("unposted");
    // The record types the engine can see are documents only.
    const allowed: DocumentRecord["refType"][] = ["bill", "credit-note", "debit-note"];
    expect(allowed).not.toContain("supplier-payment" as never);
  });
});

describe("matching hierarchy", () => {
  it("T1 exact — leading zeros are part of the reference", () => {
    const r = reconcileStatement(input({ lines: [line({ reference: "0001042", debit: 100 })], documents: [doc({ number: "0001042", amount: 100 })] }));
    expect(r.items[0]).toMatchObject({ category: "Matched", matchTier: "exact", subStatus: "posted" });
  });

  it("T2 normalised — case and punctuation only, never by stripping zeros", () => {
    expect(reconcileStatement(input({ lines: [line({ reference: "inv/1042", debit: 100 })], documents: [doc({ number: "INV-1042", amount: 100 })] })).items[0].matchTier).toBe("normalised");
    // A short reference that is not the statement's padding scheme: zeros stay significant.
    const r = reconcileStatement(input({ lines: [line({ reference: "01042", debit: 100 })], documents: [doc({ number: "1042", amount: 100 })] }));
    expect(kinds(r)).toEqual(["Missing in PRECISIA/not-captured", "Missing on Statement/in-period"]);
  });

  it("T3 zero-padded — the statement pads to 15 digits, PRECISIA holds 8 (owner decision)", () => {
    const r = reconcileStatement(input({
      lines: [line({ reference: "000000002251125", debit: 811.34 }), line({ reference: "000000002247107", debit: 1239.55 })],
      documents: [doc({ number: "02251125", amount: 811.34 }), doc({ number: "02247107", amount: 1239.55 })],
    }));
    expect(r.items.map((i) => [i.category, i.matchTier])).toEqual([["Matched", "zero-padded"], ["Matched", "zero-padded"]]);
    expect(r.items[0].relatedRefs[0].number).toBe("02251125"); // stored text unchanged
  });

  it("T3 needs a CONSISTENT padding width on the statement", () => {
    expect(paddingWidth(["000000002251125", "000000002247107", "INV-1"])).toBe(15);
    expect(paddingWidth(["000000002251125"])).toBeNull(); // one reference is not a scheme
    expect(paddingWidth(["00001", "00002"])).toBeNull(); // too short to be padding
    expect(paddingWidth(["0000012345", "000000012345"])).toBeNull(); // a tie: no single width
    const r = reconcileStatement(input({ lines: [line({ reference: "000000002251125", debit: 811.34 })], documents: [doc({ number: "02251125", amount: 811.34 })] }));
    expect(r.items[0].category).toBe("Missing in PRECISIA");
  });

  it("T3 is digits-only on both sides and never fires for a reference of another width", () => {
    const r = reconcileStatement(input({
      lines: [line({ reference: "000000002251125", debit: 1 }), line({ reference: "000000002251126", debit: 1 }), line({ reference: "0002251127", debit: 1 })],
      documents: [doc({ number: "A2251125", amount: 1 }), doc({ number: "2251126", amount: 1 }), doc({ number: "2251127", amount: 1 })],
    }));
    expect(r.items.filter((i) => i.lineId !== null).map((i) => [i.category, i.matchTier])).toEqual([
      ["Missing in PRECISIA", null], // letters in the PRECISIA number
      ["Matched", "zero-padded"],
      ["Missing in PRECISIA", null], // 10 digits, not the statement's 15-digit scheme
    ]);
  });

  it("T3 with two candidates is ambiguous — none is chosen", () => {
    const r = reconcileStatement(input({
      lines: [line({ reference: "000000002251125", debit: 10 }), line({ reference: "000000002251999", debit: 1 })],
      documents: [doc({ number: "02251125", amount: 10 }), doc({ number: "2251125", amount: 10 })],
    }));
    expect(r.items[0]).toMatchObject({ category: "Potential Duplicate", subStatus: "multiple-precisia", matchTier: "zero-padded" });
  });

  it("a compatible type is required: a credit note never matches a bill", () => {
    const r = reconcileStatement(input({ lines: [line({ reference: "X1", type: "credit-note", credit: 10 })], documents: [doc({ number: "X1", amount: 10 })] }));
    expect(r.items[0].category).toBe("Missing in PRECISIA");
  });

  it("AMOUNT ALONE NEVER MATCHES — amount and date are only a suggestion", () => {
    const r = reconcileStatement(input({ lines: [line({ reference: "INV-77", debit: 500 })], documents: [doc({ number: "OTHER", amount: 500 })] }));
    expect(r.items[0].category).toBe("Missing in PRECISIA");
    expect(r.items[0].suggestions[0].reason).toMatch(/suggestion only/);
  });

  it("T0 a reviewer's link wins, and can link to an unposted bill", () => {
    const l = line({ reference: "ZZ", debit: 70 });
    const d = doc({ number: "Q1", amount: 70, posted: false });
    const r = reconcileStatement(input({ lines: [l], documents: [d], resolutions: [{ id: 1, action: "manual-link", lineId: l.id, refType: "bill", refId: d.refId, revokesId: null, reason: "same delivery" }] }));
    expect(r.items[0]).toMatchObject({ category: "Matched", matchTier: "manual", subStatus: "not-posted" });
  });
});

describe("document classifications", () => {
  it("matched invoices, debit notes and credit notes; counted per kind", () => {
    const r = reconcileStatement(input({
      lines: [line({ reference: "I1", debit: 10 }), line({ reference: "D1", type: "debit-note", debit: 5 }), line({ reference: "C1", type: "credit-note", credit: 3 })],
      documents: [doc({ number: "I1", amount: 10 }), doc({ refType: "debit-note", number: "D1", amount: 5 }), doc({ refType: "credit-note", number: "C1", amount: -3 })],
    }));
    expect(r.items.every((i) => i.category === "Matched")).toBe(true);
    expect(r.byKind).toEqual({ invoice: { Matched: 1 }, "debit-note": { Matched: 1 }, "credit-note": { Matched: 1 } });
  });

  it("missing in PRECISIA: invoice, debit note and credit note (a capture explains it, not counted)", () => {
    const r = reconcileStatement(input({
      lines: [line({ reference: "I9", debit: 10 }), line({ reference: "D9", type: "debit-note", debit: 5 }), line({ reference: "C9", type: "credit-note", credit: 3 })],
      captures: [{ refType: "capture", refId: 77, number: "I9", date: "2026-09-10", amount: 10, documentType: "Bill", source: "capture #77 (NeedsReview)" }],
    }));
    expect(kinds(r)).toEqual(["Missing in PRECISIA/captured-not-converted", "Missing in PRECISIA/not-captured", "Missing in PRECISIA/not-captured"]);
    expect(r.items.map((i) => i.documentKind)).toEqual(["invoice", "debit-note", "credit-note"]);
    expect(r.documentsInPrecisia).toBe(0); // a capture is not a document in PRECISIA
  });

  it("documents in PRECISIA not on the statement — in period, and timing near the statement date", () => {
    const r = reconcileStatement(input({ documents: [doc({ number: "A", amount: 10, date: "2026-09-05" }), doc({ number: "B", amount: 20, date: "2026-09-28" }), doc({ number: "C", amount: 99, date: "2026-10-05" })] }));
    expect(kinds(r)).toEqual(["Missing on Statement/in-period", "Missing on Statement/timing"]); // C is after the statement date: not in P
    expect(r.documentsInPrecisia).toBe(30);
  });

  it("amount differences, with a VAT hint when the difference is the VAT", () => {
    const r = reconcileStatement(input({
      lines: [line({ reference: "A", debit: 1150 }), line({ reference: "B", debit: 10771.35 })],
      documents: [doc({ number: "A", amount: 1000 }), doc({ number: "B", amount: 11410.42 })],
    }));
    expect(kinds(r)).toEqual(["Amount Difference/vat-hint", "Amount Difference/difference"]);
    expect(r.items[1].amountDifference).toBe(-639.07);
  });

  it("duplicates: the same line twice, the same number with a different amount, the same number twice in PRECISIA", () => {
    const r = reconcileStatement(input({
      lines: [
        line({ reference: "R1", debit: 10, date: "2026-09-02" }), line({ reference: "R1", debit: 10, date: "2026-09-02" }),
        line({ reference: "N1", debit: 10 }), line({ reference: "N1", debit: 12 }),
        line({ reference: "P1", debit: 7 }),
      ],
      documents: [doc({ number: "R1", amount: 10 }), doc({ number: "N1", amount: 10 }), doc({ number: "P1", amount: 7 }), doc({ number: "P1", amount: 7, date: "2026-09-11" })],
    }));
    expect(kinds(r)).toContain("Potential Duplicate/statement-repeat");
    expect(kinds(r)).toContain("Potential Duplicate/same-number-different-amount");
    expect(kinds(r)).toContain("Potential Duplicate/multiple-precisia");
    const twice = reconcileStatement(input({ lines: [line({ reference: "P2", debit: 7 })], documents: [doc({ number: "P2", amount: 7 }), doc({ number: "P2", amount: 7, date: "2026-09-12" })] }));
    expect(kinds(twice)).toEqual(["Potential Duplicate/multiple-precisia"]);
    const unmatchedTwins = reconcileStatement(input({ documents: [doc({ number: "Q2", amount: 7 }), doc({ number: "Q2", amount: 8, date: "2026-09-12" })] }));
    expect(kinds(unmatchedTwins)).toEqual(["Potential Duplicate/precisia-duplicate-number"]);
    expect(unmatchedTwins.residual).toBe(0);
  });

  it("unclassified: interest/adjustment lines, and a credit of unknown type with no credit note", () => {
    const r = reconcileStatement(input({ lines: [line({ type: "interest", debit: 5 }), line({ type: "unknown", reference: "U1", credit: 40 })] }));
    expect(kinds(r)).toEqual(["Unclassified/interest", "Unclassified/unknown-credit"]);
  });

  it("an unknown charge is matched as a document (statements that print no type)", () => {
    const r = reconcileStatement(input({ lines: [line({ type: "unknown", reference: "000000002293957", debit: 12669.26 }), line({ type: "unknown", reference: "000000002201001", debit: 1 })], documents: [doc({ number: "02293957", amount: 12669.26 })] }));
    expect(r.items[0]).toMatchObject({ category: "Matched", matchTier: "zero-padded", documentKind: "unknown" });
  });

  it("an UNPOSTED bill counts as in PRECISIA but is always flagged not posted", () => {
    const r = reconcileStatement(input({ lines: [line({ reference: "I1", debit: 10 })], documents: [doc({ number: "I1", amount: 10, posted: false }), doc({ number: "I2", amount: 4, posted: false })] }));
    expect(r.items[0]).toMatchObject({ category: "Matched", subStatus: "not-posted" });
    expect(r.items[0].message).toMatch(/NOT POSTED/);
    expect(r.items[1].relatedRefs[0].posted).toBe(false);
    expect(r.documentsNotPosted).toEqual({ count: 2, amount: 14 });
    expect(r.documentsInPrecisia).toBe(14);
  });

  it("a reviewer's explanation moves an item into Explained; payments cannot be explained (they are not reconciled)", () => {
    const l = line({ reference: "U2", type: "interest", debit: 9 });
    const p = payment();
    const r = reconcileStatement(input({ lines: [l, p], resolutions: [
      { id: 5, action: "explained", lineId: l.id, refType: null, refId: null, revokesId: null, reason: "agreed" },
      { id: 6, action: "explained", lineId: p.id, refType: null, refId: null, revokesId: null, reason: "x" },
    ] }));
    expect(r.items[0]).toMatchObject({ explained: true, explainedByResolutionId: 5 });
    expect(r.items[1].explainedByResolutionId).toBeNull();
    expect(r.explainedByReviewer).toBe(9);
  });
});

describe("properties", () => {
  function rng(seed: number) {
    let s = seed;
    return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  }
  function scenario(seed: number) {
    const r = rng(seed);
    const lines: ReconciliationLine[] = [];
    const documents: DocumentRecord[] = [];
    const n = 3 + Math.floor(r() * 8);
    for (let i = 0; i < n; i++) {
      const amount = Math.round(r() * 100000) / 100;
      const number = `${seed}-${i}`;
      const pick = r();
      const credit = pick < 0.2;
      if (pick < 0.75) lines.push(line({ reference: number, type: credit ? "credit-note" : "invoice", debit: credit ? null : amount, credit: credit ? amount : null, date: `2026-09-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}` }));
      if (pick > 0.15) documents.push(doc({ refType: credit ? "credit-note" : "bill", number, amount: (credit ? -1 : 1) * (r() < 0.8 ? amount : amount + 1), posted: r() < 0.7, date: `2026-09-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}` }));
      if (r() < 0.1) lines.push(line({ reference: number, debit: amount, date: "2026-09-15" })); // repeats
    }
    return { lines, documents };
  }
  const payments = (seed: number, count: number) => {
    const r = rng(seed * 7 + 3);
    return Array.from({ length: count }, (_, i) => payment({ reference: i % 2 ? `${seed}-${i}` : `PMT-${seed}-${i}`, credit: r() < 0.2 ? null : Math.round(r() * 50000) / 100, date: `2026-09-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}` }));
  };
  const documentView = (res: ReturnType<typeof reconcileStatement>) => ({
    // Line order shifts when payments are interleaved; everything else must be identical.
    items: res.items.filter((i) => i.category !== "Out of Scope").map((i) => ({ ...i, order: 0, lineOrder: null })),
    figures: [res.documentsOnStatement, res.documentsInPrecisia, res.difference, res.explained, res.unexplained, res.residual, res.documentsNotPosted],
    byKind: res.byKind,
  });

  it("ADDING or REMOVING payment rows never changes any document result or document total", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const { lines, documents } = scenario(seed);
      const base = reconcileStatement(input({ lines, documents }));
      for (const count of [1, 3, 12]) {
        // Payments interleaved anywhere in the statement (line order matters to the engine).
        const extra = payments(seed + count, count);
        const mixed = [...lines, ...extra].sort((a, b) => ((a.id * 7919) % 101) - ((b.id * 7919) % 101)).map((l, i) => ({ ...l, lineOrder: i + 1 }));
        const reordered = lines.map((l) => ({ ...l, lineOrder: mixed.find((m) => m.id === l.id)!.lineOrder }));
        const withPayments = reconcileStatement(input({ lines: mixed, documents }));
        const withoutPayments = reconcileStatement(input({ lines: reordered, documents }));
        expect(documentView(withPayments), `seed ${seed} +${count} payments`).toEqual(documentView(withoutPayments));
        expect(withPayments.outOfScopePayments).toBe(count);
      }
      expect(base.residual, `seed ${seed}`).toBe(0);
    }
  });

  it("D = Explained + Unexplained to the cent and the residual is zero, for any input", () => {
    for (let seed = 100; seed <= 180; seed++) {
      const { lines, documents } = scenario(seed);
      const res = reconcileStatement(input({ lines: [...lines, ...payments(seed, 4)], documents }));
      expect(Math.round((res.explained + res.unexplained) * 100), `seed ${seed}`).toBe(Math.round(res.difference * 100));
      expect(res.residual, `seed ${seed}`).toBe(0);
      expect(res.items.filter((i) => i.category === "Out of Scope").every((i) => i.effect === 0)).toBe(true);
    }
  });

  it("every in-scope line and every in-window PRECISIA document is accounted for exactly once", () => {
    for (let seed = 200; seed <= 260; seed++) {
      const { lines, documents } = scenario(seed);
      const res = reconcileStatement(input({ lines, documents }));
      const lineIds = res.items.map((i) => i.lineId).filter((x) => x !== null);
      expect(new Set(lineIds).size, `seed ${seed}`).toBe(lines.length);
      const refs = res.items.flatMap((i) => (i.category === "Potential Duplicate" ? i.relatedRefs.map((x) => `${x.refType}:${x.refId}`) : i.refType ? [`${i.refType}:${i.refId}`] : []));
      for (const d of documents) expect(refs, `seed ${seed} document ${d.refId}`).toContain(`${d.refType}:${d.refId}`);
    }
  });

  it("is deterministic", () => {
    const { lines, documents } = scenario(7);
    expect(reconcileStatement(input({ lines, documents }))).toEqual(reconcileStatement(input({ lines, documents })));
  });
});
