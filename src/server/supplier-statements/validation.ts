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
 * SD-3G — DOCUMENT reconciliation (owner decision after production UAT):
 * payments are out of scope, so a payment line can never make a statement
 * Incomplete. Its unreadable values are reported once, for review; the
 * statement's balance arithmetic, which needs every payment, becomes a check
 * that is either verified or reported as not verifiable. The opening and
 * closing balances are not needed to reconcile documents: their absence is a
 * review note, not a blocker. Unread values on invoice, debit-note and
 * credit-note lines still block. The running balance is followed in the
 * order the statement itself uses (printed order or its reverse — whichever
 * the printed balances follow); every PERIOD total ("Total: October 2026") is
 * checked against its own lines. When every period total and the statement's
 * total add up exactly, a running balance that follows neither order is a
 * review note, not a blocker: the amounts themselves are proven.
 *
 * Pure; no I/O.
 */

import { toCents } from "./amounts";
import type { ExclusionReason, PrintedAgeing, SignConvention, StatementTransactionType, StatementValidationStatus, UnresolvedField } from "./types";

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
    | "row-count-mismatch"
    | "payment-unread"
    | "balance-not-verifiable"
    | "period-total-mismatch";
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
  /** SD-3G — a payment line is out of scope: it never blocks. */
  transactionType?: StatementTransactionType | null;
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

/** The lines in the statement's own date order: as printed when it runs
 * oldest first, reversed when it is printed newest first (more date steps
 * backwards than forwards). Never re-sorted line by line. */
function inDateOrder(lines: ValidationLine[]): ValidationLine[] {
  let forward = 0;
  let backward = 0;
  let last: string | null = null;
  for (const line of lines) {
    if (!line.transactionDate) continue;
    if (last !== null) {
      if (line.transactionDate > last) forward += 1;
      else if (line.transactionDate < last) backward += 1;
    }
    last = line.transactionDate;
  }
  return backward > forward ? [...lines].reverse() : lines;
}

export function validateStatement(input: ValidationInput): ValidationReport {
  const findings: StatementFinding[] = [];
  const transactions = input.lines.filter((l) => !l.isExcluded).sort((a, b) => a.lineOrder - b.lineOrder);
  const convention = input.signConvention;

  if (!input.statementDate) {
    findings.push({ code: "missing-statement-date", severity: "incomplete", message: "The statement date is missing. Enter it from the original." });
  }
  // Not needed to reconcile documents; without them the balance cannot be
  // checked, which is worth a look but never invented (no 0.00 is assumed).
  if (input.openingBalance === null) {
    findings.push({ code: "missing-opening-balance", severity: "review", message: "The statement shows no opening (brought-forward) balance, so its balance arithmetic cannot be checked. Not needed for document reconciliation; enter it from the original only if it is printed." });
  }
  if (input.closingBalance === null) {
    findings.push({ code: "missing-closing-balance", severity: "review", message: "The closing balance (total due) was not read, so the balance arithmetic cannot be checked. Not needed for document reconciliation; enter it from the original if it is printed." });
  }

  // Unread values and lines without exactly one amount.
  let arithmeticReady = true;
  let paymentUnread = 0;
  let paymentAmountsUnread = false;
  const isPayment = (l: ValidationLine) => l.transactionType === "payment";
  for (const line of transactions) {
    if (isPayment(line) && line.unresolvedFields.length > 0) {
      paymentUnread += 1;
      if (line.unresolvedFields.some((f) => f === "debit" || f === "credit")) {
        arithmeticReady = false;
        paymentAmountsUnread = true;
      }
      continue;
    }
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
      findings.push({ code: "line-without-amount", severity: isPayment(line) ? "review" : "incomplete", message: `${where(line)} has no amount.`, lineOrder: line.lineOrder, pageNumber: line.pageNumber });
      arithmeticReady = false;
    } else if (line.debit !== null && line.credit !== null && line.debit !== 0 && line.credit !== 0) {
      findings.push({ code: "line-with-two-amounts", severity: "review", message: `${where(line)} has both a debit and a credit. Check it is one transaction.`, lineOrder: line.lineOrder, pageNumber: line.pageNumber });
    }
  }

  if (paymentUnread > 0) {
    findings.push({
      code: "payment-unread",
      severity: "review",
      message: `${paymentUnread} payment line${paymentUnread === 1 ? " has a value" : "s have values"} that could not be read reliably. Payments are out of scope for document reconciliation, so this does not block; the raw text is kept.`,
    });
  }
  if (paymentAmountsUnread && input.openingBalance !== null && input.closingBalance !== null) {
    findings.push({
      code: "balance-not-verifiable",
      severity: "review",
      message: "The statement's balance arithmetic could not be checked because some payment amounts could not be read. Document lines are reconciled individually.",
    });
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

  // V3 — the printed running balance, line by line, in the order the
  // statement follows (printed, or reversed for a statement printed newest
  // first) — whichever its printed balances agree with. The first break is
  // located; each later line is re-anchored to its own printed figure so a
  // single misread does not condemn every line after it.
  const runningBreaks: StatementFinding[] = [];
  if (arithmeticReady) {
    const walk = (ordered: ValidationLine[]) => {
      let previous: number | null = input.openingBalance === null ? null : toCents(input.openingBalance);
      const found: { line: ValidationLine; expected: number; printed: number }[] = [];
      for (const line of ordered) {
        const expected = previous === null ? null : previous + movement(line, convention);
        if (line.runningBalance !== null) {
          const printed = toCents(line.runningBalance);
          if (expected !== null && expected !== printed) found.push({ line, expected, printed });
          previous = printed;
        } else {
          previous = expected;
        }
      }
      return found;
    };
    const asPrinted = walk(transactions);
    const reversed = walk([...transactions].reverse());
    const preferred = walk(inDateOrder(transactions));
    const breaks = [asPrinted, reversed].reduce((best, b) => (b.length < best.length ? b : best), preferred);
    if (breaks.length > 0) {
      const first = breaks[0];
      runningBreaks.push({
        code: "running-balance-break",
        severity: isPayment(first.line) ? "review" : "incomplete",
        message: `The running balance first stops adding up at ${where(first.line)}: expected ${rands(first.expected)}, printed ${rands(first.printed)}.`,
        lineOrder: first.line.lineOrder,
        pageNumber: first.line.pageNumber,
        expectedCents: first.expected,
        actualCents: first.printed,
        differenceCents: first.printed - first.expected,
      });
      if (breaks.length > 1) {
        runningBreaks.push({
          code: "running-balance-break",
          severity: breaks.every((b) => isPayment(b.line)) ? "review" : "incomplete",
          message: `The running balance breaks in ${breaks.length} places in total.`,
        });
      }
    }
  }

  // V11 — each PERIOD total adds up: the period's lines (those printed before
  // its total, after the previous one) come to the net the total prints.
  const periodTotals = input.lines.filter((l) => l.exclusionReason === "period-total").sort((a, b) => a.lineOrder - b.lineOrder);
  let periodsVerified = periodTotals.length > 0;
  {
    let from = -Infinity;
    for (const total of periodTotals) {
      const members = transactions.filter((l) => l.lineOrder > from && l.lineOrder < total.lineOrder);
      from = total.lineOrder;
      if (total.runningBalance === null || members.some((l) => l.unresolvedFields.some((f) => f === "debit" || f === "credit"))) {
        periodsVerified = false;
        continue;
      }
      const sum = members.reduce((acc, l) => acc + movement(l, convention), 0);
      const printed = toCents(total.runningBalance);
      if (sum !== printed) {
        periodsVerified = false;
        findings.push({
          code: "period-total-mismatch",
          severity: "review",
          message: `The lines before ${where(total)} come to ${rands(sum)}, but that period total prints ${rands(printed)}.`,
          lineOrder: total.lineOrder,
          pageNumber: total.pageNumber,
          expectedCents: sum,
          actualCents: printed,
          differenceCents: printed - sum,
        });
      }
    }
  }
  const statementTotalProven =
    arithmeticReady && input.openingBalance !== null && input.closingBalance !== null && !findings.some((f) => f.code === "balance-mismatch");
  if (runningBreaks.length > 0 && periodsVerified && statementTotalProven) {
    for (const f of runningBreaks) f.severity = "review";
    runningBreaks.push({
      code: "running-balance-break",
      severity: "review",
      message: "The printed running balance does not follow the order of the lines, but every period total and the statement's total add up exactly, so the amounts are proven. Not blocking.",
    });
  }
  findings.push(...runningBreaks);

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
    if (isPayment(line)) continue; // out of scope (SD-3G)
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
