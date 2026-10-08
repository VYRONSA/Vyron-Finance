/**
 * @vitest-environment node
 *
 * SD-3C — arithmetic validation of supplier statements (V1–V10).
 */
import { describe, expect, it } from "vitest";
import { validateStatement, type ValidationInput, type ValidationLine } from "./validation";

let order = 0;
function line(partial: Partial<ValidationLine>): ValidationLine {
  order += 1;
  return {
    lineOrder: order,
    pageNumber: 1,
    transactionDate: "2026-09-10",
    referenceText: `R${order}`,
    debit: null,
    credit: null,
    runningBalance: null,
    unresolvedFields: [],
    isExcluded: false,
    exclusionReason: null,
    ...partial,
  };
}

function input(partial: Partial<ValidationInput>): ValidationInput {
  return {
    openingBalance: 100,
    closingBalance: 100,
    statementDate: "2026-09-30",
    periodFrom: null,
    currencyCode: null,
    printedTotalDebits: null,
    printedTotalCredits: null,
    printedAgeing: null,
    signConvention: "debit-increases-owed",
    lines: [],
    baseCurrencyCode: "ZAR",
    ...partial,
  };
}

const codes = (i: ValidationInput) => validateStatement(i).findings.map((f) => f.code);

describe("validateStatement", () => {
  it("passes a statement that adds up, with nothing to report", () => {
    const report = validateStatement(input({
      openingBalance: 100,
      closingBalance: 250.1,
      lines: [line({ debit: 200.1, runningBalance: 300.1 }), line({ credit: 50, runningBalance: 250.1 })],
    }));
    expect(report).toEqual({ status: "Pass", findings: [] });
  });

  it("is exact to the cent: 0.1 + 0.2 style float errors never create or hide a difference", () => {
    const lines = Array.from({ length: 30 }, () => line({ debit: 0.1 }));
    expect(validateStatement(input({ openingBalance: 0, closingBalance: 3, lines })).status).toBe("Pass");
    expect(validateStatement(input({ openingBalance: 0, closingBalance: 3.01, lines })).status).toBe("Incomplete");
  });

  it("V1 — missing opening, closing or statement date is Incomplete", () => {
    expect(codes(input({ openingBalance: null }))).toContain("missing-opening-balance");
    expect(codes(input({ closingBalance: null }))).toContain("missing-closing-balance");
    expect(codes(input({ statementDate: null }))).toContain("missing-statement-date");
    expect(validateStatement(input({ statementDate: null })).status).toBe("Incomplete");
  });

  it("V2 — opening + debits − credits ≠ closing is Incomplete, with the exact difference", () => {
    const report = validateStatement(input({ openingBalance: 100, closingBalance: 150, lines: [line({ debit: 60 })] }));
    expect(report.status).toBe("Incomplete");
    const f = report.findings.find((x) => x.code === "balance-mismatch")!;
    expect(f).toMatchObject({ expectedCents: 16000, actualCents: 15000, differenceCents: -1000 });
  });

  it("V3 — locates the FIRST running-balance break and does not condemn the lines after it", () => {
    const lines = [
      line({ debit: 10, runningBalance: 110 }),
      line({ debit: 10, runningBalance: 125 }), // should be 120
      line({ debit: 10, runningBalance: 135 }), // consistent with the printed 125
    ];
    const report = validateStatement(input({ openingBalance: 100, closingBalance: 130, lines }));
    const breaks = report.findings.filter((f) => f.code === "running-balance-break");
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({ lineOrder: lines[1].lineOrder, expectedCents: 12000, actualCents: 12500 });
  });

  it("V3 — counts further breaks", () => {
    const lines = [line({ debit: 10, runningBalance: 111 }), line({ debit: 10, runningBalance: 999 })];
    const report = validateStatement(input({ openingBalance: 100, closingBalance: 120, lines }));
    expect(report.findings.filter((f) => f.code === "running-balance-break")).toHaveLength(2);
  });

  it("V6 — carried forward must equal the next page's brought forward", () => {
    const report = validateStatement(input({
      openingBalance: 0,
      closingBalance: 10,
      lines: [
        line({ debit: 10, runningBalance: 10 }),
        line({ isExcluded: true, exclusionReason: "carried-forward", runningBalance: 10, pageNumber: 1 }),
        line({ isExcluded: true, exclusionReason: "brought-forward", runningBalance: 100, pageNumber: 2 }),
      ],
    }));
    expect(report.findings.find((f) => f.code === "page-continuity-break")).toMatchObject({ severity: "incomplete", pageNumber: 2 });
  });

  it("unread values make the statement Incomplete and stop the arithmetic (nothing is assumed)", () => {
    const report = validateStatement(input({
      openingBalance: 0,
      closingBalance: 10,
      lines: [line({ unresolvedFields: ["debit"] }), line({ debit: 10 })],
    }));
    expect(report.status).toBe("Incomplete");
    expect(report.findings.map((f) => f.code)).toEqual(["unread-value"]);
  });

  it("V7 — a line with no amount is Incomplete; one with two amounts is Review", () => {
    expect(codes(input({ openingBalance: 0, closingBalance: 0, lines: [line({})] }))).toContain("line-without-amount");
    const two = validateStatement(input({ openingBalance: 0, closingBalance: 5, lines: [line({ debit: 10, credit: 5 })] }));
    expect(two.findings.map((f) => f.code)).toEqual(["line-with-two-amounts"]);
    expect(two.status).toBe("Review");
  });

  it("V7 — dates after the statement date or before the period are flagged for review", () => {
    expect(codes(input({ openingBalance: 0, closingBalance: 1, lines: [line({ debit: 1, transactionDate: "2026-10-01" })] }))).toContain("date-after-statement");
    expect(codes(input({ openingBalance: 0, closingBalance: 1, periodFrom: "2026-09-01", lines: [line({ debit: 1, transactionDate: "2026-08-31" })] }))).toContain("date-before-period");
  });

  it("V4 — printed totals that disagree with the lines are Review", () => {
    const report = validateStatement(input({ openingBalance: 0, closingBalance: 10, printedTotalDebits: 11, printedTotalCredits: 0, lines: [line({ debit: 10 })] }));
    expect(report.findings.map((f) => f.code)).toEqual(["printed-total-mismatch"]);
    expect(report.status).toBe("Review");
  });

  it("V5 — ageing that does not add up to the closing balance is Review", () => {
    const report = validateStatement(input({
      openingBalance: 0, closingBalance: 10, lines: [line({ debit: 10 })],
      printedAgeing: { current: 5, days30: 4, days60: null, days90: null, days120Plus: null },
    }));
    expect(report.findings.map((f) => f.code)).toEqual(["ageing-mismatch"]);
  });

  it("V8 — the same line printed twice is Review, not removed", () => {
    const report = validateStatement(input({
      openingBalance: 0, closingBalance: 20,
      lines: [line({ debit: 10, referenceText: "0001", transactionDate: "2026-09-02" }), line({ debit: 10, referenceText: "0001", transactionDate: "2026-09-02" })],
    }));
    expect(report.findings.map((f) => f.code)).toEqual(["repeated-line"]);
  });

  it("V10 — a reversed convention is PROPOSED, never applied", () => {
    const lines = [line({ credit: 50 })];
    const report = validateStatement(input({ openingBalance: 100, closingBalance: 150, lines }));
    expect(report.status).toBe("Incomplete");
    expect(report.findings.map((f) => f.code)).toEqual(["balance-mismatch", "sign-convention-suspected"]);
    expect(validateStatement(input({ openingBalance: 100, closingBalance: 150, lines, signConvention: "credit-increases-owed" })).status).toBe("Pass");
  });

  it("an unsupported currency is flagged: manual review required", () => {
    const report = validateStatement(input({ currencyCode: "USD" }));
    expect(report.findings[0]).toMatchObject({ code: "unsupported-currency", severity: "review" });
    expect(report.findings[0].message).toMatch(/Manual review required/);
    expect(validateStatement(input({ currencyCode: "ZAR" })).status).toBe("Pass");
  });

  it("a possible duplicate statement is flagged", () => {
    expect(codes(input({ possibleDuplicateOf: 7 }))).toEqual(["possible-duplicate-statement"]);
  });

  it("excluded rows (totals, forward balances) are never counted as transactions", () => {
    const report = validateStatement(input({
      openingBalance: 0, closingBalance: 10,
      lines: [line({ debit: 10 }), line({ isExcluded: true, exclusionReason: "statement-total", debit: 10 })],
    }));
    expect(report.status).toBe("Pass");
  });
});

describe("SD-3F — V9 row count against an AI transcription", () => {
  const lines = () => [line({ debit: 100, runningBalance: 200 }), line({ credit: 50, runningBalance: 150 })];
  it("matches → nothing to report", () => {
    expect(codes(input({ closingBalance: 150, lines: lines(), aiDeclaredTransactions: 2 }))).not.toContain("row-count-mismatch");
  });
  it("fewer read than declared → Incomplete (a truncated read)", () => {
    const report = validateStatement(input({ closingBalance: 150, lines: lines(), aiDeclaredTransactions: 3 }));
    expect(report.status).toBe("Incomplete");
    expect(report.findings.find((f) => f.code === "row-count-mismatch")?.severity).toBe("incomplete");
  });
  it("more read than declared → Review (a line read twice?)", () => {
    const report = validateStatement(input({ closingBalance: 150, lines: lines(), aiDeclaredTransactions: 1 }));
    expect(report.status).toBe("Review");
  });
  it("no declared count (not an AI read) → not checked", () => {
    expect(codes(input({ closingBalance: 150, lines: lines(), aiDeclaredTransactions: null }))).not.toContain("row-count-mismatch");
  });
  it("excluded rows do not count as transactions", () => {
    const withExcluded = [...lines(), line({ isExcluded: true, exclusionReason: "closing-balance" })];
    expect(codes(input({ closingBalance: 150, lines: withExcluded, aiDeclaredTransactions: 2 }))).not.toContain("row-count-mismatch");
  });
});

describe("SD-3G — document scope: payments never block", () => {
  const pay = (p: Partial<ValidationLine>) => line({ transactionType: "payment", ...p });
  it("unread PAYMENT values are one review note, never Incomplete", () => {
    const report = validateStatement(input({
      openingBalance: null, closingBalance: null,
      lines: [line({ debit: 100, transactionType: "invoice" }), pay({ unresolvedFields: ["credit"] }), pay({ unresolvedFields: ["credit"] })],
    }));
    expect(report.status).toBe("Review");
    const codes = report.findings.map((f) => f.code);
    expect(codes.filter((c) => c === "payment-unread")).toHaveLength(1);
    expect(codes).not.toContain("unread-value");
    expect(report.findings.every((f) => f.severity === "review")).toBe(true);
  });

  it("unread INVOICE, DEBIT NOTE, CREDIT NOTE and unknown-type values still make it Incomplete", () => {
    for (const transactionType of ["invoice", "debit-note", "credit-note", "unknown"] as const) {
      const report = validateStatement(input({ lines: [line({ transactionType, unresolvedFields: ["debit"] })] }));
      expect(report.status, transactionType).toBe("Incomplete");
      expect(report.findings.map((f) => f.code), transactionType).toContain("unread-value");
    }
  });

  it("with payment amounts unread, the balance arithmetic is reported as not verifiable (not failed)", () => {
    const report = validateStatement(input({ openingBalance: 0, closingBalance: 100, lines: [line({ debit: 100, transactionType: "invoice" }), pay({ unresolvedFields: ["credit"] })] }));
    expect(report.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["payment-unread", "balance-not-verifiable"]));
    expect(report.findings.map((f) => f.code)).not.toContain("balance-mismatch");
    expect(report.status).toBe("Review");
  });

  it("missing opening/closing balances are review notes — never invented, never blocking", () => {
    const report = validateStatement(input({ openingBalance: null, closingBalance: null, lines: [line({ debit: 1, transactionType: "invoice" })] }));
    expect(report.findings.filter((f) => f.code.startsWith("missing-")).map((f) => [f.code, f.severity])).toEqual([["missing-opening-balance", "review"], ["missing-closing-balance", "review"]]);
    expect(report.status).toBe("Review");
    expect(validateStatement(input({ statementDate: null, lines: [line({ debit: 1 })] })).status).toBe("Incomplete"); // the date still matters
  });

  it("repeated payment rows are not a repeated-line finding", () => {
    const report = validateStatement(input({ openingBalance: null, closingBalance: null, lines: [pay({ credit: 2000, referenceText: "P1" }), pay({ credit: 2000, referenceText: "P1" })] }));
    expect(report.findings.map((f) => f.code)).not.toContain("repeated-line");
  });

  it("a newest-first statement's running balance is checked in its own date order", () => {
    const newestFirst = [
      line({ transactionDate: "2026-10-06", debit: 300, runningBalance: 600, transactionType: "invoice" }),
      line({ transactionDate: "2026-10-01", credit: 100, runningBalance: 300, transactionType: "payment" }),
      line({ transactionDate: "2026-09-20", debit: 400, runningBalance: 400, transactionType: "invoice" }),
    ];
    expect(validateStatement(input({ openingBalance: null, closingBalance: 600, lines: newestFirst })).findings.map((f) => f.code)).not.toContain("running-balance-break");
    const broken = newestFirst.map((l, i) => (i === 0 ? { ...l, runningBalance: 650 } : l));
    const report = validateStatement(input({ openingBalance: null, closingBalance: 650, lines: broken }));
    const finding = report.findings.find((f) => f.code === "running-balance-break")!;
    expect(finding.lineOrder).toBe(broken[0].lineOrder);
    expect(finding.severity).toBe("incomplete"); // an invoice line: a document amount may be misread
  });
});

describe("SD-3G (real-PDF diagnosis) — period totals and the running balance's own order", () => {
  const periodTotal = (net: number) => line({ isExcluded: true, exclusionReason: "period-total", runningBalance: net, debit: null, credit: null, transactionDate: null, referenceText: null });
  it("every period total is checked against its own lines", () => {
    const ok = validateStatement(input({ openingBalance: 0, closingBalance: 150, lines: [line({ debit: 100 }), line({ debit: 50 }), periodTotal(150)] }));
    expect(ok.findings.map((f) => f.code)).not.toContain("period-total-mismatch");
    const bad = validateStatement(input({ openingBalance: 0, closingBalance: 150, lines: [line({ debit: 100 }), line({ debit: 50 }), periodTotal(140)] }));
    expect(bad.findings.find((f) => f.code === "period-total-mismatch")).toMatchObject({ severity: "review", expectedCents: 15000, actualCents: 14000 });
  });
  it("a running balance accumulated down the page (newest first) is followed in printed order", () => {
    const report = validateStatement(input({ openingBalance: 0, closingBalance: 300, lines: [
      line({ transactionDate: "2026-10-06", debit: 100, runningBalance: 100 }),
      line({ transactionDate: "2026-10-01", debit: 200, runningBalance: 300 }),
    ] }));
    expect(report.findings.map((f) => f.code)).not.toContain("running-balance-break");
  });
  it("a running balance that follows NO order is a review note only when every period total and the statement total add up", () => {
    const lines = [line({ debit: 100, runningBalance: 999 }), line({ debit: 50, runningBalance: 5 }), periodTotal(150)];
    const proven = validateStatement(input({ openingBalance: 0, closingBalance: 150, lines }));
    expect(proven.status).toBe("Review");
    expect(proven.findings.filter((f) => f.code === "running-balance-break").every((f) => f.severity === "review")).toBe(true);
    expect(proven.findings.map((f) => f.message).join(" ")).toMatch(/every period total and the statement's total add up exactly/);
    // Without proof (no period totals), it still blocks.
    const unproven = validateStatement(input({ openingBalance: 0, closingBalance: 150, lines: lines.slice(0, 2) }));
    expect(unproven.status).toBe("Incomplete");
    // A period that does NOT add up keeps it blocking.
    const mismatch = validateStatement(input({ openingBalance: 0, closingBalance: 150, lines: [...lines.slice(0, 2), periodTotal(149)] }));
    expect(mismatch.status).toBe("Incomplete");
  });
});
