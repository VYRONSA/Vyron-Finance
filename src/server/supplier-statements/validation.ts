/**
 * SD-3C — is the statement arithmetically sound?
 *
 * Every sum here is done in integer cents. AI never takes part (and there is
 * no AI in SD-3C). Nothing is ever corrected: a failure is reported, with the
 * line and page where it starts, and the statement waits for a reviewer to
 * correct it against the original. A debit/credit convention that would make
 * the statement balance is PROPOSED, never applied.
 *
 *   Incomplete — the arithmetic does not hold, or a value it depends on is
 *                missing or unread. Cannot be marked ready.
 *   Review     — sound, but something deserves a look (printed totals or
 *                ageing that disagree, repeated lines, dates outside the
 *                period, an unsupported currency, a possible duplicate).
 *   Pass       — nothing to report.
 *
 * Pure; no I/O.
 */

import { toCents } from "./amounts";
import type { ExclusionReason, PrintedAgeing, SignConvention, StatementValidationStatus, UnresolvedField } from "./types";

export type FindingSeverity = "incomplete" | "review";

export type StatementFinding = {
  code:
    | "missing-opening-balance"
    | "missing-closing-balance"
    | "missing-statement-date"
    | "balance-mismatch"
    | "running-balance-break"
    | "page-continuity-break"
    | "unread-value"
    | "line-without-amount"
    | "line-with-two-amounts"
    | "printed-total-mismatch"
    | "ageing-mismatch"
    | "date-after-statement"
    | "date-before-period"
    | "repeated-line"
    | "sign-convention-suspected"
    | "unsupported-currency"
    | "possible-duplicate-statement"
    | "row-count-mismatch";
  severity: FindingSeverity;
  message: string;
  lineOrder?: number;
  pageNumber?: number | null;
  /** Cents, so the figures are exact. */
  expectedCents?: number;
  actualCents?: number;
  differenceCents?: number;
};

export type ValidationLine = {
  lineOrder: number;
  pageNumber: number | null;
  transactionDate: string | null;
  referenceText: string | null;
  debit: number | null;
  credit: number | null;
  runningBalance: number | null;
  unresolvedFields: UnresolvedField[];
  isExcluded: boolean;
  exclusionReason: ExclusionReason | null;
};

export type ValidationInput = {
  openingBalance: number | null;
  closingBalance: number | null;
  statementDate: string | null;
  periodFrom: string | null;
  currencyCode: string | null;
  printedTotalDebits: number | null;
  printedTotalCredits: number | null;
  printedAgeing: PrintedAgeing | null;
  signConvention: SignConvention;
  lines: ValidationLine[];
  baseCurrencyCode: string | null;
  /** Another live statement for the same supplier, date and closing balance. */
  possibleDuplicateOf?: number | null;
  /** SD-3F (V9) — for a statement read by AI: how many transaction rows the
   * reader said the statement shows. */
  aiDeclaredTransactions?: number | null;
};

export type ValidationReport = { status: Exclude<StatementValidationStatus, "Pending">; findings: StatementFinding[] };

function rands(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

function where(line: { lineOrder: number; pageNumber: number | null }): string {
  return line.pageNumber ? `line ${line.lineOrder} (page ${line.pageNumber})` : `line ${line.lineOrder}`;
}

/** The owed-direction movement of a line, in cents. */
function movement(line: ValidationLine, convention: SignConvention): number {
  const debit = toCents(line.debit ?? 0);
  const credit = toCents(line.credit ?? 0);
  return convention === "debit-increases-owed" ? debit - credit : credit - debit;
}

function balances(opening: number, lines: ValidationLine[], convention: SignConvention): number {
  return lines.reduce((sum, l) => sum + movement(l, convention), opening);
}

export function validateStatement(input: ValidationInput): ValidationReport {
  const findings: StatementFinding[] = [];
  const transactions = input.lines.filter((l) => !l.isExcluded).sort((a, b) => a.lineOrder - b.lineOrder);
  const convention = input.signConvention;

  if (!input.statementDate) {
    findings.push({ code: "missing-statement-date", severity: "incomplete", message: "The statement date is missing. Enter it from the original." });
  }
  if (input.openingBalance === null) {
    findings.push({ code: "missing-opening-balance", severity: "incomplete", message: "The opening (brought-forward) balance is missing. Enter it from the original — 0.00 if the statement starts from nothing." });
  }
  if (input.closingBalance === null) {
    findings.push({ code: "missing-closing-balance", severity: "incomplete", message: "The closing balance is missing. Enter it from the original." });
  }

  // Unread values and lines without exactly one amount.
  let arithmeticReady = true;
  for (const line of transactions) {
    if (line.unresolvedFields.length > 0) {
      findings.push({
        code: "unread-value",
        severity: "incomplete",
        message: `${where(line)}: ${line.unresolvedFields.map((f) => f.replace("_", " ")).join(", ")} could not be read reliably. Correct it from the original.`,
        lineOrder: line.lineOrder,
        pageNumber: line.pageNumber,
      });
      if (line.unresolvedFields.some((f) => f === "debit" || f === "credit")) arithmeticReady = false;
      continue;
    }
    if (line.debit === null && line.credit === null) {
      findings.push({ code: "line-without-amount", severity: "incomplete", message: `${where(line)} has no amount.`, lineOrder: line.lineOrder, pageNumber: line.pageNumber });
      arithmeticReady = false;
    } else if (line.debit !== null && line.credit !== null && line.debit !== 0 && line.credit !== 0) {
      findings.push({ code: "line-with-two-amounts", severity: "review", message: `${where(line)} has both a debit and a credit. Check it is one transaction.`, lineOrder: line.lineOrder, pageNumber: line.pageNumber });
    }
  }

  // V2 — opening + debits − credits = closing.
  if (arithmeticReady && input.openingBalance !== null && input.closingBalance !== null) {
    const opening = toCents(input.openingBalance);
    const closing = toCents(input.closingBalance);
    const computed = balances(opening, transactions, convention);
    if (computed !== closing) {
      findings.push({
        code: "balance-mismatch",
        severity: "incomplete",
        message: `Opening ${rands(opening)} plus the lines comes to ${rands(computed)}, but the statement's closing balance is ${rands(closing)} (difference ${rands(closing - computed)}).`,
        expectedCents: computed,
        actualCents: closing,
        differenceCents: closing - computed,
      });
      // V10 — would the opposite convention balance? Proposed only.
      const other: SignConvention = convention === "debit-increases-owed" ? "credit-increases-owed" : "debit-increases-owed";
      if (balances(opening, transactions, other) === closing) {
        findings.push({
          code: "sign-convention-suspected",
          severity: "review",
          message:
            other === "credit-increases-owed"
              ? "This statement balances if its CREDIT column is what increases the amount owed. Check the original and change the convention if so — it is not changed automatically."
              : "This statement balances if its DEBIT column is what increases the amount owed. Check the original and change the convention if so — it is not changed automatically.",
        });
      }
    }
  }

  // V3 — the printed running balance, line by line. The first break is
  // located; each later line is re-anchored to its own printed figure so a
  // single misread does not condemn every line after it.
  if (arithmeticReady) {
    let previous: number | null = input.openingBalance === null ? null : toCents(input.openingBalance);
    let breaks = 0;
    for (const line of transactions) {
      const expected = previous === null ? null : previous + movement(line, convention);
      if (line.runningBalance !== null) {
        const printed = toCents(line.runningBalance);
        if (expected !== null && expected !== printed) {
          breaks += 1;
          if (breaks === 1) {
            findings.push({
              code: "running-balance-break",
              severity: "incomplete",
              message: `The running balance first stops adding up at ${where(line)}: expected ${rands(expected)}, printed ${rands(printed)}.`,
              lineOrder: line.lineOrder,
              pageNumber: line.pageNumber,
              expectedCents: expected,
              actualCents: printed,
              differenceCents: printed - expected,
            });
          }
        }
        previous = printed;
      } else {
        previous = expected;
      }
    }
    if (breaks > 1) {
      findings.push({ code: "running-balance-break", severity: "incomplete", message: `The running balance breaks in ${breaks} places in total.` });
    }
  }

  // V6 — each page's carried-forward is the next page's brought-forward.
  const forwards = input.lines.filter((l) => l.exclusionReason === "carried-forward" || l.exclusionReason === "brought-forward").sort((a, b) => a.lineOrder - b.lineOrder);
  for (let i = 0; i < forwards.length - 1; i++) {
    const cf = forwards[i];
    const bf = forwards[i + 1];
    if (cf.exclusionReason !== "carried-forward" || bf.exclusionReason !== "brought-forward") continue;
    if (cf.runningBalance === null || bf.runningBalance === null) continue;
    if (toCents(cf.runningBalance) !== toCents(bf.runningBalance)) {
      findings.push({
        code: "page-continuity-break",
        severity: "incomplete",
        message: `Carried forward ${rands(toCents(cf.runningBalance))} at ${where(cf)}, but brought forward ${rands(toCents(bf.runningBalance))} at ${where(bf)}.`,
        lineOrder: bf.lineOrder,
        pageNumber: bf.pageNumber,
        expectedCents: toCents(cf.runningBalance),
        actualCents: toCents(bf.runningBalance),
        differenceCents: toCents(bf.runningBalance) - toCents(cf.runningBalance),
      });
    }
  }

  // V4 — printed column totals.
  const debitSum = transactions.reduce((s, l) => s + toCents(l.debit ?? 0), 0);
  const creditSum = transactions.reduce((s, l) => s + toCents(l.credit ?? 0), 0);
  if (input.printedTotalDebits !== null && toCents(input.printedTotalDebits) !== debitSum) {
    findings.push({
      code: "printed-total-mismatch",
      severity: "review",
      message: `The printed debit total is ${rands(toCents(input.printedTotalDebits))} but the debit lines add up to ${rands(debitSum)}.`,
      expectedCents: debitSum,
      actualCents: toCents(input.printedTotalDebits),
      differenceCents: toCents(input.printedTotalDebits) - debitSum,
    });
  }
  if (input.printedTotalCredits !== null && toCents(input.printedTotalCredits) !== creditSum) {
    findings.push({
      code: "printed-total-mismatch",
      severity: "review",
      message: `The printed credit total is ${rands(toCents(input.printedTotalCredits))} but the credit lines add up to ${rands(creditSum)}.`,
      expectedCents: creditSum,
      actualCents: toCents(input.printedTotalCredits),
      differenceCents: toCents(input.printedTotalCredits) - creditSum,
    });
  }

  // V5 — the ageing adds up to the closing balance.
  if (input.printedAgeing && input.closingBalance !== null) {
    const buckets = [input.printedAgeing.current, input.printedAgeing.days30, input.printedAgeing.days60, input.printedAgeing.days90, input.printedAgeing.days120Plus];
    if (buckets.some((b) => b !== null)) {
      const ageingSum = buckets.reduce<number>((s, b) => s + toCents(b ?? 0), 0);
      if (ageingSum !== toCents(input.closingBalance)) {
        findings.push({
          code: "ageing-mismatch",
          severity: "review",
          message: `The ageing adds up to ${rands(ageingSum)} but the closing balance is ${rands(toCents(input.closingBalance))}.`,
          expectedCents: toCents(input.closingBalance),
          actualCents: ageingSum,
          differenceCents: ageingSum - toCents(input.closingBalance),
        });
      }
    }
  }

  // V7 — dates inside the statement.
  for (const line of transactions) {
    if (!line.transactionDate) continue;
    if (input.statementDate && line.transactionDate > input.statementDate) {
      findings.push({ code: "date-after-statement", severity: "review", message: `${where(line)} is dated after the statement date.`, lineOrder: line.lineOrder, pageNumber: line.pageNumber });
    } else if (input.periodFrom && line.transactionDate < input.periodFrom) {
      findings.push({ code: "date-before-period", severity: "review", message: `${where(line)} is dated before the statement period.`, lineOrder: line.lineOrder, pageNumber: line.pageNumber });
    }
  }

  // V8 — the same line printed twice.
  const seen = new Map<string, ValidationLine>();
  for (const line of transactions) {
    if (line.debit === null && line.credit === null) continue;
    const key = [line.transactionDate ?? "", (line.referenceText ?? "").trim(), toCents(line.debit ?? 0), toCents(line.credit ?? 0)].join("|");
    const first = seen.get(key);
    if (first) {
      findings.push({
        code: "repeated-line",
        severity: "review",
        message: `${where(line)} repeats ${where(first)} (same date, reference and amount). Check it is not printed twice.`,
        lineOrder: line.lineOrder,
        pageNumber: line.pageNumber,
      });
    } else {
      seen.set(key, line);
    }
  }

  // Currency: reconciliation exists only in the company's base currency.
  if (input.currencyCode && input.currencyCode !== input.baseCurrencyCode) {
    findings.push({
      code: "unsupported-currency",
      severity: "review",
      message: `Unsupported currency (${input.currencyCode}): this statement cannot be reconciled until exchange-rate handling exists. Manual review required.`,
    });
  }

  // V9 — an AI read: fewer transaction lines than the statement shows is a
  // truncated read (Incomplete until a person enters the missing lines);
  // more is worth a look. Never "fixed" by adding or removing anything.
  if (input.aiDeclaredTransactions !== null && input.aiDeclaredTransactions !== undefined) {
    const read = transactions.length;
    if (read < input.aiDeclaredTransactions) {
      findings.push({
        code: "row-count-mismatch",
        severity: "incomplete",
        message: `The statement shows ${input.aiDeclaredTransactions} transaction rows but ${read} were read. Enter the missing lines from the original.`,
      });
    } else if (read > input.aiDeclaredTransactions) {
      findings.push({
        code: "row-count-mismatch",
        severity: "review",
        message: `${read} transaction lines were read but the statement was counted as showing ${input.aiDeclaredTransactions}. Check for lines read twice.`,
      });
    }
  }

  if (input.possibleDuplicateOf) {
    findings.push({
      code: "possible-duplicate-statement",
      severity: "review",
      message: `Statement #${input.possibleDuplicateOf} is from the same supplier, for the same date and closing balance. Check this is not the same statement twice.`,
    });
  }

  const status: ValidationReport["status"] = findings.some((f) => f.severity === "incomplete")
    ? "Incomplete"
    : findings.length > 0
      ? "Review"
      : "Pass";
  return { status, findings };
}
