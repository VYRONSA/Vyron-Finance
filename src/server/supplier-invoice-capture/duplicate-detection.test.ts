import { describe, expect, it } from "vitest";
import { assessDuplicate, blocksConversion, DATE_WINDOW_DAYS } from "./duplicate-detection";
import type { DuplicateCandidateBill, DuplicateCandidateCapture, DuplicateSubject } from "./duplicate-detection";

function subject(overrides: Partial<DuplicateSubject> = {}): DuplicateSubject {
  return {
    captureId: 100,
    supplierId: 7,
    invoiceNumber: "INV-001",
    invoiceDate: "2026-06-01",
    total: 1150,
    contentSha256: "hash-a",
    ...overrides,
  };
}

function capture(overrides: Partial<DuplicateCandidateCapture> = {}): DuplicateCandidateCapture {
  return {
    captureId: 1,
    supplierId: 7,
    invoiceNumber: "INV-001",
    invoiceDate: "2026-06-01",
    total: 1150,
    contentSha256: "hash-b",
    status: "NeedsReview",
    ...overrides,
  };
}

function bill(overrides: Partial<DuplicateCandidateBill> = {}): DuplicateCandidateBill {
  return { billId: 500, supplierId: 7, invoiceNumber: "INV-001", invoiceDate: "2026-06-01", total: 1150, ...overrides };
}

describe("layer 1 — the same bytes", () => {
  it("BLOCKS a byte-identical file, whatever it claims to be", () => {
    const d = assessDuplicate(subject(), [capture({ contentSha256: "hash-a", invoiceNumber: "SOMETHING-ELSE", supplierId: 99 })], []);
    expect(d).toMatchObject({ status: "Blocked", layer: "file-hash", ofCaptureId: 1 });
    expect(blocksConversion(d)).toBe(true);
  });

  it("does not compare hashes when the subject has none — absent is unknown, not 'no match'", () => {
    // Isolated to layer 1: different totals, so the value/date window
    // cannot fire and only the hash comparison is under test.
    const d = assessDuplicate(
      subject({ contentSha256: null, invoiceNumber: "UNIQUE", total: 111 }),
      [capture({ contentSha256: null, invoiceNumber: "OTHER", total: 222 })],
      [],
    );
    expect(d.status).toBe("None");
  });
});

describe("layer 2 — one supplier, one invoice number", () => {
  it("BLOCKS against a bill already on the ledger, and names it", () => {
    const d = assessDuplicate(subject(), [], [bill()]);
    expect(d).toMatchObject({ status: "Blocked", layer: "supplier-invoice-number", ofBillId: 500 });
    expect(d.reason).toContain("already on the ledger");
    expect(blocksConversion(d)).toBe(true);
  });

  it("BLOCKS against another capture in flight", () => {
    const d = assessDuplicate(subject(), [capture()], []);
    expect(d).toMatchObject({ status: "Blocked", layer: "supplier-invoice-number", ofCaptureId: 1 });
  });

  it("ignores formatting differences in the serial number", () => {
    const d = assessDuplicate(subject({ invoiceNumber: "inv 001" }), [], [bill({ invoiceNumber: "INV-001" })]);
    expect(d.status).toBe("Blocked");
  });

  it("does not block the same invoice number from a DIFFERENT supplier", () => {
    const d = assessDuplicate(subject({ supplierId: 7 }), [], [bill({ supplierId: 8 })]);
    expect(d.status).toBe("None");
  });

  it("cannot block on invoice number until a supplier is resolved", () => {
    // Without a supplier id there is no "this supplier's serial number" to
    // reason about — blocking on the number alone would stop two different
    // suppliers who both number from 1.
    const d = assessDuplicate(subject({ supplierId: null }), [], [bill()]);
    expect(d.status).toBe("None");
  });
});

describe("layer 3 — same supplier, same money, close together", () => {
  it("flags as POSSIBLE, not blocked — suppliers do issue two equal invoices in a week", () => {
    const d = assessDuplicate(subject({ invoiceNumber: "INV-002" }), [], [bill({ invoiceNumber: "INV-001", invoiceDate: "2026-06-03" })]);
    expect(d).toMatchObject({ status: "Possible", layer: "supplier-total-window", ofBillId: 500 });
    expect(blocksConversion(d)).toBe(false);
  });

  it("says how far apart they are dated", () => {
    const d = assessDuplicate(subject({ invoiceNumber: "INV-002" }), [], [bill({ invoiceNumber: "INV-001", invoiceDate: "2026-06-02" })]);
    expect(d.reason).toContain("1 day apart");
  });

  it("stays silent outside the date window", () => {
    const d = assessDuplicate(
      subject({ invoiceNumber: "INV-002", invoiceDate: "2026-07-01" }),
      [],
      [bill({ invoiceNumber: "INV-001", invoiceDate: "2026-06-01" })],
    );
    expect(d.status).toBe("None");
  });

  it("stays silent when the amounts differ", () => {
    const d = assessDuplicate(subject({ invoiceNumber: "INV-002" }), [], [bill({ invoiceNumber: "INV-001", total: 999 })]);
    expect(d.status).toBe("None");
  });

  it("uses a window of exactly 7 days", () => {
    const within = assessDuplicate(
      subject({ invoiceNumber: "X", invoiceDate: "2026-06-08" }),
      [],
      [bill({ invoiceNumber: "Y", invoiceDate: "2026-06-01" })],
    );
    expect(DATE_WINDOW_DAYS).toBe(7);
    expect(within.status).toBe("Possible");
  });
});

describe("precedence and exclusions", () => {
  it("the strongest layer decides", () => {
    // Both a hash match and a number match are present; the hash wins.
    const d = assessDuplicate(subject(), [capture({ contentSha256: "hash-a" })], [bill()]);
    expect(d.layer).toBe("file-hash");
  });

  it("a rejected (cancelled) capture does not block — re-uploading is the remedy — but the same file is flagged", () => {
    const d = assessDuplicate(subject(), [capture({ status: "Cancelled", contentSha256: "hash-a" })], []);
    expect(d.status).toBe("Possible");
    expect(d.layer).toBe("file-hash");
    expect(d.reason).toMatch(/rejected/i);
  });

  it("a rejected capture with a different file and the same number does not block either", () => {
    const d = assessDuplicate(subject(), [capture({ status: "Cancelled", contentSha256: "other" })], []);
    expect(d.status).toBe("None");
  });

  it("SD-1: a FAILED capture still counts — it can be entered by hand, so it is still in the workflow", () => {
    const d = assessDuplicate(subject(), [capture({ status: "Failed" })], []);
    expect(d.status).toBe("Blocked");
  });

  it("a capture is never a duplicate of itself", () => {
    const self = capture({ captureId: 100, contentSha256: "hash-a" });
    expect(assessDuplicate(subject({ captureId: 100 }), [self], []).status).toBe("None");
  });

  it("a clean invoice is clean", () => {
    const d = assessDuplicate(subject({ invoiceNumber: "INV-NEW", contentSha256: "hash-new", total: 42 }), [capture()], [bill()]);
    expect(d).toMatchObject({ status: "None", layer: "none", ofCaptureId: null, ofBillId: null });
  });
});

describe("the verdict is binding", () => {
  it("Blocked always blocks conversion", () => {
    expect(blocksConversion({ status: "Blocked" })).toBe(true);
  });

  it("Possible does not — the reviewer has been shown it and may proceed", () => {
    expect(blocksConversion({ status: "Possible" })).toBe(false);
  });

  it("there is no force/override parameter on either function", () => {
    // COST computed action:"block" and never read it; its bulk approve then
    // hard-coded force:true past every rule. Neither is expressible here.
    expect(assessDuplicate.length).toBe(3);
    expect(blocksConversion.length).toBe(1);
  });
});
