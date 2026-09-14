/**
 * Banking reporting — bank transactions, the bank ledger in the GL,
 * reconciliations, deposits/payments/charges/interest, bank-to-GL
 * reconciliation, import and Xero import audits, duplicates, and the
 * transaction lifecycle.
 *
 * Every bank transaction stays traceable through
 *   Imported → Allocated → Ready to Post → Posted → Reconciled,
 * using the platform's own `transactionPostingStatus` (the same function
 * the Transaction Explorer badge uses), and the `bank-transaction-detail`
 * report shows each hop with its evidence: import batch, allocation and
 * its history, the posting journal and its GL lines, and the
 * reconciliation that cleared it.
 *
 * `ae_bank_transactions` uses the cashbook convention: `credit` is money
 * IN, `debit` is money OUT (migration 0093).
 */

import { isAllocatedForPosting, transactionPostingStatus, type BankAccount, type BankTransactionRecord, type TransactionPostingStatus } from "@/server/accounting/types";
import { REQUIRED_ACTION_DUPLICATE_PAYMENT } from "@/server/accounting/matching-engine";
import { buildReconciliationSummary } from "@/server/banking/reconciliation-engine";
import {
  asAtLabel,
  col,
  dayBefore,
  drill,
  F,
  formatDate,
  groupRow,
  numberFilter,
  periodLabel,
  row,
  section,
  subtotalRow,
  summaryCount,
  summaryMoney,
  summaryText,
  totalRow,
  type ReportContext,
  type ReportDefinition,
} from "../kit";
import { check, inRange, round2, sum, ReportInputError, type ReconciliationCheck, type ReportRow } from "../types";
import { naturalBalance, sourceLabel } from "./shared";

const LIFECYCLE: TransactionPostingStatus[] = ["Unprocessed", "Ready to Post", "Posted", "Reconciled"];
const XERO_BATCH_PREFIX = "XERO-";

const statusFilter = F.status(LIFECYCLE);

function accountLabel(accounts: Map<number, BankAccount>, t: BankTransactionRecord): string {
  const a = t.bankAccountId !== null ? accounts.get(t.bankAccountId) : undefined;
  return a ? `${a.accountName} (${a.accountNumber})` : t.bankAccount || "Unassigned";
}

async function context(ctx: ReportContext) {
  const [bankAccounts, customers, suppliers, accounts] = await Promise.all([ctx.source.bankAccounts(), ctx.source.customers(), ctx.source.suppliers(), ctx.source.accounts()]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const glName = new Map(accounts.map((a) => [a.accountCode, a.description]));
  return {
    bankAccounts,
    byId: new Map(bankAccounts.map((b) => [b.id, b])),
    allocation(t: BankTransactionRecord): string {
      if (t.allocationType === "S" && t.matchedSupplierId !== null) return `Supplier: ${supplierName.get(t.matchedSupplierId) ?? t.matchedSupplierName ?? `#${t.matchedSupplierId}`}`;
      if (t.allocationType === "C" && t.matchedCustomerId !== null) return `Customer: ${customerName.get(t.matchedCustomerId) ?? `#${t.matchedCustomerId}`}`;
      if (t.isSplit) return "Split across accounts";
      const code = t.suggestedGlAccount?.trim();
      if (code) return `${code} ${glName.get(code) ?? ""}`.trim();
      return "Unallocated";
    },
  };
}

function txnRow(c: Awaited<ReturnType<typeof context>>, t: BankTransactionRecord): ReportRow {
  return row(
    { date: t.transactionDate, account: accountLabel(c.byId, t), description: t.description, reference: t.reference, in: t.credit || null, out: t.debit || null, allocation: c.allocation(t), status: transactionPostingStatus(t) },
    { drill: drill.bank(t.id) },
  );
}

const TXN_COLUMNS = [col("date", "Date", "date"), col("account", "Bank Account"), col("description", "Description"), col("reference", "Reference"), col("in", "Money In", "money"), col("out", "Money Out", "money"), col("allocation", "Allocation"), col("status", "Status", "badge")];

function txnTotals(list: BankTransactionRecord[]): ReportRow {
  return totalRow({ description: `${list.length} transactions`, in: sum(list, (t) => t.credit), out: sum(list, (t) => t.debit) });
}

function listReport(id: string, title: string, description: string, pick: (t: BankTransactionRecord, ctx: ReportContext) => boolean, extra: Partial<ReportDefinition> = {}): ReportDefinition {
  return {
    id,
    title,
    description,
    categories: ["banking"],
    filters: [...F.period, F.bankAccount, statusFilter],
    ...extra,
    async build(ctx) {
      const { dateFrom, dateTo, status } = ctx.filters;
      const bankAccountId = numberFilter(ctx.filters.bankAccountId);
      const [c, bank] = await Promise.all([context(ctx), ctx.source.bankTransactions({ from: dateFrom, to: dateTo })]);
      const list = bank.items.filter((t) => (bankAccountId === null || t.bankAccountId === bankAccountId) && (!status || transactionPostingStatus(t) === status) && pick(t, ctx));
      const rows = list.map((t) => txnRow(c, t));
      rows.push(txnTotals(list));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Transactions", list.length), summaryMoney("Money In", sum(list, (t) => t.credit)), summaryMoney("Money Out", sum(list, (t) => t.debit)), ...LIFECYCLE.map((s) => summaryCount(s, list.filter((t) => transactionPostingStatus(t) === s).length)).filter((x) => Number(x.value) > 0)],
        sections: [section(TXN_COLUMNS, rows, undefined, "No matching bank transactions in this period.")],
        checks: [],
        notices: bank.truncated ? ["Bank transactions exceeded the report read limit; narrow the date range."] : [],
      };
    },
  };
}

/** GL accounts whose name marks them as bank charges / interest. */
function accountsMatching<T extends { description: string }>(accounts: T[], pattern: RegExp): T[] {
  return accounts.filter((a) => pattern.test(a.description));
}

function glAccountIdForBank(accounts: { id: number; accountCode: string }[], bank: BankAccount): number | null {
  const code = bank.glAccount?.trim();
  return code ? accounts.find((a) => a.accountCode === code)?.id ?? null : null;
}

export const BANKING_REPORTS: ReportDefinition[] = [
  listReport("bank-transactions", "Bank Transactions", "Every bank transaction in the period with its allocation and where it sits in the posting workflow.", () => true),
  listReport("deposits", "Deposits", "Money received into the bank in the period.", (t) => t.credit > 0),
  listReport("payments", "Payments", "Money paid out of the bank in the period.", (t) => t.debit > 0),
  {
    id: "unreconciled-transactions",
    title: "Unreconciled Transactions",
    description: "Bank transactions dated on or before a date that have not yet been reconciled.",
    categories: ["banking"],
    filters: [F.asAt, F.bankAccount],
    async build(ctx) {
      const { asAt } = ctx.filters;
      const bankAccountId = numberFilter(ctx.filters.bankAccountId);
      const [c, bank] = await Promise.all([context(ctx), ctx.source.bankTransactions({ to: asAt })]);
      const list = bank.items.filter((t) => t.reconciliationId === null && t.transactionDate !== null && (bankAccountId === null || t.bankAccountId === bankAccountId));
      const rows = list.map((t) => txnRow(c, t));
      rows.push(txnTotals(list));
      return {
        subtitle: asAtLabel(asAt),
        summary: [summaryCount("Unreconciled", list.length), summaryMoney("Deposits", sum(list, (t) => t.credit)), summaryMoney("Payments", sum(list, (t) => t.debit)), summaryCount("Not yet posted", list.filter((t) => !t.postedFlag).length)],
        sections: [section(TXN_COLUMNS, rows, undefined, "Every transaction up to this date is reconciled.")],
        checks: [],
        notices: [],
      };
    },
  },
  {
    id: "reconciled-transactions",
    title: "Reconciled Transactions",
    description: "Bank transactions in the period that have been reconciled, with the statement they were reconciled on.",
    categories: ["banking"],
    filters: [...F.period, F.bankAccount],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const bankAccountId = numberFilter(ctx.filters.bankAccountId);
      const [c, bank, recs] = await Promise.all([context(ctx), ctx.source.bankTransactions({ from: dateFrom, to: dateTo }), ctx.source.bankReconciliations()]);
      const recById = new Map(recs.map((r) => [r.id, r]));
      const list = bank.items.filter((t) => t.reconciliationId !== null && (bankAccountId === null || t.bankAccountId === bankAccountId));
      const rows = list.map((t) => {
        const r = txnRow(c, t);
        r.cells.status = `Statement ${recById.get(t.reconciliationId!)?.statementDate ?? `#${t.reconciliationId}`}`;
        return r;
      });
      rows.push(txnTotals(list));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Reconciled", list.length), summaryMoney("Deposits", sum(list, (t) => t.credit)), summaryMoney("Payments", sum(list, (t) => t.debit))],
        sections: [section(TXN_COLUMNS.map((cl) => (cl.key === "status" ? col("status", "Reconciled On") : cl)), rows, undefined, "No reconciled transactions in this period.")],
        checks: [],
        notices: [],
      };
    },
  },
  {
    id: "bank-ledger",
    title: "Bank Ledger",
    description: "Each bank account's GL account: opening balance, every posting with a running balance, and closing balance.",
    categories: ["banking", "general-ledger"],
    filters: [...F.period, F.bankAccount],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const bankAccountId = numberFilter(ctx.filters.bankAccountId);
      const [bankAccounts, accounts, start, end] = await Promise.all([ctx.source.bankAccounts(), ctx.source.accounts(), ctx.source.trialBalance(dayBefore(dateFrom)), ctx.source.trialBalance(dateTo)]);
      const rows: ReportRow[] = [];
      const checks: ReconciliationCheck[] = [];
      const notices: string[] = [];
      for (const b of bankAccounts.filter((x) => bankAccountId === null || x.id === bankAccountId)) {
        const accountId = glAccountIdForBank(accounts, b);
        if (accountId === null) {
          notices.push(`${b.accountName} (${b.accountNumber}) has no GL account in the Chart of Accounts, so it has no bank ledger.`);
          continue;
        }
        const gl = await ctx.source.glTransactions({ from: dateFrom, to: dateTo, accountId });
        const s = start.find((r) => r.accountId === accountId);
        const e = end.find((r) => r.accountId === accountId);
        let balance = naturalBalance("Debit", s?.totalDebit ?? 0, s?.totalCredit ?? 0);
        rows.push(groupRow({ date: b.glAccount, journal: `${b.accountName} (${b.accountNumber})` }));
        rows.push(row({ description: "Opening balance", balance }, { level: 1 }));
        for (const t of gl.items) {
          balance = round2(balance + t.debit - t.credit);
          rows.push(row({ date: t.postingDate, journal: t.journalNumber, source: sourceLabel(t.sourceType), description: t.description, in: t.debit || null, out: t.credit || null, balance }, { level: 1, drill: drill.journal(t.journalId) }));
        }
        rows.push(subtotalRow({ description: `Closing balance — ${b.accountName}`, in: sum(gl.items, (t) => t.debit), out: sum(gl.items, (t) => t.credit), balance }));
        checks.push(check(`${b.accountName} closing balance agrees with the Trial Balance`, naturalBalance("Debit", e?.totalDebit ?? 0, e?.totalCredit ?? 0), balance));
      }
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Bank accounts", bankAccounts.length)],
        sections: [section([col("date", "Date", "date"), col("journal", "Journal"), col("source", "Source", "badge"), col("description", "Description"), col("in", "Money In", "money"), col("out", "Money Out", "money"), col("balance", "Balance", "money")], rows, undefined, "No bank accounts with a GL account.")],
        checks,
        notices,
      };
    },
  },
  {
    id: "bank-reconciliation",
    title: "Bank Reconciliation",
    description: "A bank reconciliation: statement opening balance, cleared deposits and payments, the reconciled balance, outstanding items, and the GL balance.",
    categories: ["banking"],
    filters: [{ key: "reconciliationId", label: "Reconciliation", control: "select", options: "reconciliations" }, F.bankAccount],
    async build(ctx) {
      const recs = await ctx.source.bankReconciliations();
      const bankAccountId = numberFilter(ctx.filters.bankAccountId);
      const reconciliationId = numberFilter(ctx.filters.reconciliationId);
      const rec =
        reconciliationId !== null
          ? recs.find((r) => r.id === reconciliationId)
          : [...recs].filter((r) => bankAccountId === null || r.bankAccountId === bankAccountId).sort((a, b) => (a.statementDate < b.statementDate ? 1 : -1))[0];
      if (!rec) throw new ReportInputError(recs.length ? "Choose a reconciliation." : "No bank reconciliations have been started for this company.");
      const [bankAccounts, accounts, bank, tb] = await Promise.all([ctx.source.bankAccounts(), ctx.source.accounts(), ctx.source.bankTransactions({ to: rec.statementDate }), ctx.source.trialBalance(rec.statementDate)]);
      const account = bankAccounts.find((b) => b.id === rec.bankAccountId);
      const glId = account ? glAccountIdForBank(accounts, account) : null;
      const glRow = glId !== null ? tb.find((r) => r.accountId === glId) : undefined;
      const glClosing = naturalBalance("Debit", glRow?.totalDebit ?? 0, glRow?.totalCredit ?? 0);
      const summary = buildReconciliationSummary(
        bank.items.filter((t) => t.bankAccountId === rec.bankAccountId),
        rec.statementDate,
        rec.statementClosingBalance,
        glClosing,
        { periodStart: rec.statementPeriodStart, statementOpeningBalance: rec.statementOpeningBalance, reconciliationId: rec.id },
      );
      const itemRow = (i: (typeof summary.clearedDeposits)[number]) => row({ date: i.transactionDate, description: i.description, reference: i.reference, amount: i.amount, posted: i.isPosted ? "Posted" : "Not posted" }, { drill: drill.bank(i.transactionId), level: 1 });
      const itemCols = [col("date", "Date", "date"), col("description", "Description"), col("reference", "Reference"), col("amount", "Amount", "money"), col("posted", "In GL", "badge")];
      return {
        subtitle: `${account ? `${account.accountName} (${account.accountNumber})` : `Bank account #${rec.bankAccountId}`} · statement ${formatDate(rec.statementDate)} · ${rec.status}`,
        summary: [summaryMoney("Statement Closing", rec.statementClosingBalance), summaryMoney("Reconciled Balance", summary.reconciledBalance), summaryMoney("Out of Balance", summary.outOfBalanceBy), summaryMoney("GL Closing", glClosing), summaryText("Status", rec.status)],
        sections: [
          section(
            [col("label", ""), col("amount", "Amount", "money")],
            [
              row({ label: "Statement opening balance", amount: rec.statementOpeningBalance }),
              row({ label: `Add: cleared deposits (${summary.clearedDeposits.length})`, amount: summary.clearedDepositsTotal }),
              row({ label: `Less: cleared payments (${summary.clearedPayments.length})`, amount: -summary.clearedPaymentsTotal }),
              subtotalRow({ label: "Reconciled balance", amount: summary.reconciledBalance }),
              row({ label: "Statement closing balance", amount: rec.statementClosingBalance }),
              totalRow({ label: "Out of balance", amount: summary.outOfBalanceBy }),
              row({ label: "General Ledger closing balance", amount: glClosing }),
              row({ label: "Statement less General Ledger", amount: summary.difference }),
            ],
            "Reconciliation",
          ),
          section(itemCols, [...summary.unreconciledDeposits.map(itemRow), ...summary.unreconciledPayments.map((i) => ({ ...itemRow(i), cells: { ...itemRow(i).cells, amount: -i.amount } }))], "In-period items not yet reconciled", "Every in-period transaction is reconciled."),
          section(itemCols, [...summary.clearedDeposits.map(itemRow), ...summary.clearedPayments.map((i) => ({ ...itemRow(i), cells: { ...itemRow(i).cells, amount: -i.amount } }))], "Cleared on this statement", "Nothing has been cleared on this statement yet."),
        ],
        checks: [check("Cleared items explain the statement closing balance", rec.statementClosingBalance, summary.reconciledBalance)],
        notices: [`${summary.unpostedCount} in-period transaction(s) are not yet posted to the General Ledger (${summary.unpostedTotal.toFixed(2)}); the GL comparison cannot agree until they are.`],
      };
    },
  },
  {
    id: "bank-statement",
    title: "Bank Statement",
    description: "The bank account's imported statement lines for the period, with the balance column as imported.",
    categories: ["banking", "documents"],
    filters: [{ ...F.bankAccount, required: true }, ...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const bankAccountId = numberFilter(ctx.filters.bankAccountId);
      if (bankAccountId === null) throw new ReportInputError("Choose a bank account.");
      const [bankAccounts, bank] = await Promise.all([ctx.source.bankAccounts(), ctx.source.bankTransactions({ from: dateFrom, to: dateTo })]);
      const account = bankAccounts.find((b) => b.id === bankAccountId);
      if (!account) throw new ReportInputError("That bank account does not exist in this company.");
      const list = bank.items.filter((t) => t.bankAccountId === bankAccountId && t.entrySource === "Imported");
      let breaks = 0;
      let previous: number | null = null;
      const rows = list.map((t) => {
        if (previous !== null && t.balance !== null && Math.abs(round2(previous + t.credit - t.debit) - t.balance) > 0.01) breaks++;
        if (t.balance !== null) previous = t.balance;
        return row({ date: t.transactionDate, description: t.description, reference: t.reference, in: t.credit || null, out: t.debit || null, balance: t.balance }, { drill: drill.bank(t.id) });
      });
      rows.push(totalRow({ description: `${list.length} lines`, in: sum(list, (t) => t.credit), out: sum(list, (t) => t.debit) }));
      return {
        subtitle: `${account.accountName} · ${account.bankName} · ${account.accountNumber} · ${periodLabel(dateFrom, dateTo)}`,
        summary: [summaryMoney("Money In", sum(list, (t) => t.credit)), summaryMoney("Money Out", sum(list, (t) => t.debit)), summaryCount("Lines", list.length)],
        sections: [section([col("date", "Date", "date"), col("description", "Description"), col("reference", "Reference"), col("in", "Money In", "money"), col("out", "Money Out", "money"), col("balance", "Balance (as imported)", "money")], rows, undefined, "No imported statement lines in this period.")],
        checks: list.some((t) => t.balance !== null) ? [check("Imported running balances are continuous", 0, breaks, "A break means a statement line between two imported lines is missing, or lines were imported out of order.")] : [],
        notices: ["Only imported statement lines are shown; manually captured cashbook entries are in Bank Transactions."],
      };
    },
  },
  {
    id: "bank-charges",
    title: "Bank Charges",
    description: "Bank transactions allocated to bank-charge or bank-fee accounts.",
    categories: ["banking"],
    filters: [...F.period, F.bankAccount],
    build: (ctx) => allocatedTo(ctx, /bank\s*(charge|fee)|charges/i, "bank-charge"),
  },
  {
    id: "interest",
    title: "Interest",
    description: "Bank transactions allocated to interest accounts — interest received and interest paid.",
    categories: ["banking"],
    filters: [...F.period, F.bankAccount],
    build: (ctx) => allocatedTo(ctx, /interest/i, "interest"),
  },
  {
    id: "bank-account-movement",
    title: "Bank Account Movement",
    description: "Per bank account: GL opening balance, money in, money out and closing balance, beside the bank transactions recorded and how many are still unposted.",
    categories: ["banking", "management"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [bankAccounts, accounts, start, end, bank] = await Promise.all([ctx.source.bankAccounts(), ctx.source.accounts(), ctx.source.trialBalance(dayBefore(dateFrom)), ctx.source.trialBalance(dateTo), ctx.source.bankTransactions({ from: dateFrom, to: dateTo })]);
      const rows = bankAccounts.map((b) => {
        const id = glAccountIdForBank(accounts, b);
        const s = id !== null ? start.find((r) => r.accountId === id) : undefined;
        const e = id !== null ? end.find((r) => r.accountId === id) : undefined;
        const own = bank.items.filter((t) => t.bankAccountId === b.id);
        return row(
          {
            account: `${b.accountName} (${b.accountNumber})`,
            opening: id !== null ? naturalBalance("Debit", s?.totalDebit ?? 0, s?.totalCredit ?? 0) : null,
            glIn: id !== null ? round2((e?.totalDebit ?? 0) - (s?.totalDebit ?? 0)) : null,
            glOut: id !== null ? round2((e?.totalCredit ?? 0) - (s?.totalCredit ?? 0)) : null,
            closing: id !== null ? naturalBalance("Debit", e?.totalDebit ?? 0, e?.totalCredit ?? 0) : null,
            bankIn: sum(own, (t) => t.credit),
            bankOut: sum(own, (t) => t.debit),
            unposted: own.filter((t) => !t.postedFlag).length,
          },
          { drill: drill.report("bank-ledger", { bankAccountId: String(b.id), dateFrom, dateTo }) },
        );
      });
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Bank accounts", bankAccounts.length), summaryCount("Unposted transactions", bank.items.filter((t) => !t.postedFlag).length)],
        sections: [section([col("account", "Bank Account"), col("opening", "GL Opening", "money"), col("glIn", "GL In", "money"), col("glOut", "GL Out", "money"), col("closing", "GL Closing", "money"), col("bankIn", "Bank In", "money"), col("bankOut", "Bank Out", "money"), col("unposted", "Unposted", "number")], rows, undefined, "No bank accounts are set up.")],
        checks: [],
        notices: ["GL columns are the bank account's GL account; Bank columns are the bank transactions recorded in VYRON. They differ by transactions not yet posted and by GL postings that don't come from the bank feed (e.g. receipts captured in Sales, opening balances)."],
      };
    },
  },
  {
    id: "bank-gl-reconciliation",
    title: "Bank GL Reconciliation",
    description: "Proves every posted bank transaction reached the bank's GL account, and explains the rest of the GL balance by source.",
    categories: ["banking", "audit"],
    filters: [F.asAt, F.bankAccount],
    async build(ctx) {
      const { asAt } = ctx.filters;
      const bankAccountId = numberFilter(ctx.filters.bankAccountId);
      const [bankAccounts, accounts, bank] = await Promise.all([ctx.source.bankAccounts(), ctx.source.accounts(), ctx.source.bankTransactions({ to: asAt })]);
      const rows: ReportRow[] = [];
      const checks: ReconciliationCheck[] = [];
      const notices: string[] = [];
      for (const b of bankAccounts.filter((x) => bankAccountId === null || x.id === bankAccountId)) {
        const accountId = glAccountIdForBank(accounts, b);
        if (accountId === null) {
          notices.push(`${b.accountName} has no GL account in the Chart of Accounts.`);
          continue;
        }
        const gl = await ctx.source.glTransactions({ to: asAt, accountId });
        const own = bank.items.filter((t) => t.bankAccountId === b.id);
        const posted = own.filter((t) => t.postedFlag);
        const unposted = own.filter((t) => !t.postedFlag);
        const postedJournals = new Set(posted.map((t) => t.journalId).filter((j): j is number => j !== null));
        const fromBank = gl.items.filter((t) => postedJournals.has(t.journalId));
        const other = gl.items.filter((t) => !postedJournals.has(t.journalId));
        const bankNet = sum(posted, (t) => t.credit - t.debit);
        const glFromBank = sum(fromBank, (t) => t.debit - t.credit);
        const glBalance = sum(gl.items, (t) => t.debit - t.credit);
        rows.push(groupRow({ label: `${b.accountName} (${b.accountNumber}) — GL ${b.glAccount}` }));
        rows.push(row({ label: "Posted bank transactions (net money in)", amount: bankNet, count: posted.length }, { level: 1, drill: drill.report("bank-transactions", { bankAccountId: String(b.id), status: "Posted", dateTo: asAt }) }));
        rows.push(row({ label: "GL lines from those transactions' journals", amount: glFromBank }, { level: 1 }));
        const bySource = new Map<string, number>();
        for (const t of other) bySource.set(sourceLabel(t.sourceType), round2((bySource.get(sourceLabel(t.sourceType)) ?? 0) + t.debit - t.credit));
        for (const [label, amount] of bySource) rows.push(row({ label: `Other GL postings — ${label}`, amount }, { level: 1 }));
        rows.push(subtotalRow({ label: "GL balance", amount: glBalance }));
        rows.push(row({ label: "Bank transactions not yet posted (net)", amount: sum(unposted, (t) => t.credit - t.debit), count: unposted.length }, { level: 1, drill: drill.report("bank-transactions", { bankAccountId: String(b.id), status: "Ready to Post", dateTo: asAt }) }));
        checks.push(check(`${b.accountName}: every posted bank transaction is in the GL`, bankNet, glFromBank, "A difference means a posted bank transaction's journal did not post to this bank's GL account, or a shared journal also carries lines for another bank account."));
      }
      return {
        subtitle: asAtLabel(asAt),
        summary: [summaryCount("Bank accounts", bankAccounts.length)],
        sections: [section([col("label", ""), col("count", "Transactions", "number"), col("amount", "Amount (Dr+)", "money")], rows, undefined, "No bank accounts with a GL account.")],
        checks,
        notices,
      };
    },
  },
  {
    id: "imported-transaction-audit",
    title: "Imported Transaction Audit",
    description: "Every import batch — file, rows, imported, duplicates, exceptions, statement balances — and, for one batch, its transactions and their current status.",
    categories: ["banking", "audit"],
    filters: [...F.period, { key: "importBatch", label: "Import Batch", control: "select", options: "importBatches" }],
    async build(ctx) {
      const { dateFrom, dateTo, importBatch } = ctx.filters;
      const [batches, bank, c] = await Promise.all([ctx.source.importBatches(), ctx.source.bankTransactions({}), context(ctx)]);
      const inBatch = new Map<string, BankTransactionRecord[]>();
      for (const t of bank.items) if (t.importBatch) inBatch.set(t.importBatch, [...(inBatch.get(t.importBatch) ?? []), t]);
      const list = batches.filter((b) => (importBatch ? b.batchId === importBatch : inRange(b.createdAt, dateFrom, dateTo)));
      const checks: ReconciliationCheck[] = [];
      const rows = list.map((b) => {
        const present = b.importType === "bank_transactions" ? inBatch.get(b.batchId)?.length ?? 0 : null;
        if (present !== null && importBatch) checks.push(check("Rows still in VYRON equal rows imported", b.importedCount, present, "Fewer rows now than imported means rows were deleted after import."));
        return row(
          {
            date: b.createdAt.slice(0, 10),
            file: b.sourceFilename || b.batchId,
            type: b.importType === "bills" ? "Bills" : "Bank",
            rows: b.rowCount,
            imported: b.importedCount,
            duplicates: b.duplicateCount,
            exceptions: b.exceptionCount,
            present,
            statement: b.statementPeriodStart ? `${b.statementPeriodStart} – ${b.statementPeriodEnd}` : "",
            balances: b.balanceReconciles === null ? "" : b.balanceReconciles ? "Reconciles" : "Does not reconcile",
            by: b.importedBy,
          },
          { drill: drill.report("imported-transaction-audit", { importBatch: b.batchId, dateFrom, dateTo }) },
        );
      });
      const sections = [section([col("date", "Imported", "date"), col("file", "File"), col("type", "Type", "badge"), col("rows", "Rows", "number"), col("imported", "Imported", "number"), col("duplicates", "Duplicates", "number"), col("exceptions", "Exceptions", "number"), col("present", "Rows in VYRON", "number"), col("statement", "Statement Period"), col("balances", "Statement Balances", "badge"), col("by", "By")], rows, "Import Batches", "No imports in this period.")];
      if (importBatch) {
        const txns = inBatch.get(importBatch) ?? [];
        const tRows = txns.map((t) => txnRow(c, t));
        tRows.push(txnTotals(txns));
        sections.push(section(TXN_COLUMNS, tRows, "Transactions in this batch", "No bank transactions from this batch remain."));
      }
      return {
        subtitle: importBatch ? `Batch ${importBatch}` : periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Batches", list.length), summaryCount("Rows imported", sum(list, (b) => b.importedCount)), summaryCount("Duplicates skipped", sum(list, (b) => b.duplicateCount))],
        sections,
        checks,
        notices: ["Batches are listed from the import history VYRON records; the Xero migration imports its bank rows under batches named XERO-<account>."],
      };
    },
  },
  {
    id: "xero-import-audit",
    title: "Xero Import Audit",
    description: "Bank transactions migrated from Xero, per Xero account: counts, money in and out, date range, and how far each has progressed from import to reconciliation.",
    categories: ["banking", "audit"],
    filters: [F.bankAccount],
    async build(ctx) {
      const bankAccountId = numberFilter(ctx.filters.bankAccountId);
      const [bank, c] = await Promise.all([ctx.source.bankTransactions({}), context(ctx)]);
      const xero = bank.items.filter((t) => t.importBatch.startsWith(XERO_BATCH_PREFIX) && (bankAccountId === null || t.bankAccountId === bankAccountId));
      const batches = new Map<string, BankTransactionRecord[]>();
      for (const t of xero) batches.set(t.importBatch, [...(batches.get(t.importBatch) ?? []), t]);
      const rows = [...batches.entries()].map(([batch, list]) => {
        const dates = list.map((t) => t.transactionDate).filter((d): d is string => !!d).sort();
        return row(
          {
            batch: batch.slice(XERO_BATCH_PREFIX.length),
            account: list[0] ? accountLabel(c.byId, list[0]) : "",
            count: list.length,
            in: sum(list, (t) => t.credit),
            out: sum(list, (t) => t.debit),
            from: dates[0] ?? "",
            to: dates[dates.length - 1] ?? "",
            ...Object.fromEntries(LIFECYCLE.map((s) => [s, list.filter((t) => transactionPostingStatus(t) === s).length])),
          },
          { drill: drill.report("imported-transaction-audit", { importBatch: batch }) },
        );
      });
      rows.push(totalRow({ batch: "Total", count: xero.length, in: sum(xero, (t) => t.credit), out: sum(xero, (t) => t.debit), ...Object.fromEntries(LIFECYCLE.map((s) => [s, xero.filter((t) => transactionPostingStatus(t) === s).length])) }));
      return {
        subtitle: `${xero.length} transactions migrated from Xero`,
        summary: [summaryCount("Transactions", xero.length), ...LIFECYCLE.map((s) => summaryCount(s, xero.filter((t) => transactionPostingStatus(t) === s).length))],
        sections: [section([col("batch", "Xero Account"), col("account", "VYRON Bank Account"), col("count", "Transactions", "number"), col("in", "Money In", "money"), col("out", "Money Out", "money"), col("from", "From", "date"), col("to", "To", "date"), ...LIFECYCLE.map((s) => col(s, s, "number"))], rows, undefined, "No Xero-migrated bank transactions.")],
        checks: [],
        notices: ["Xero exports state debits and credits from the bank ledger's perspective; VYRON stores them in cashbook convention (money in as credit). Rows imported before that mapping was corrected were repaired by migration 0093 — these figures are the corrected ones."],
      };
    },
  },
  {
    id: "duplicate-transactions",
    title: "Duplicate Transaction Report",
    description: "Bank transactions the matching engine flagged as possible duplicate payments, and look-alike groups (same account, date, amount and description).",
    categories: ["banking", "audit"],
    filters: [...F.period, F.bankAccount],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const bankAccountId = numberFilter(ctx.filters.bankAccountId);
      const [c, bank] = await Promise.all([context(ctx), ctx.source.bankTransactions({ from: dateFrom, to: dateTo })]);
      const scoped = bank.items.filter((t) => bankAccountId === null || t.bankAccountId === bankAccountId);
      const flagged = scoped.filter((t) => t.requiredAction === REQUIRED_ACTION_DUPLICATE_PAYMENT);
      const groups = new Map<string, BankTransactionRecord[]>();
      for (const t of scoped) {
        const key = [t.bankAccountId, t.transactionDate, t.debit, t.credit, t.description.trim().toLowerCase()].join("|");
        groups.set(key, [...(groups.get(key) ?? []), t]);
      }
      const lookAlike = [...groups.values()].filter((g) => g.length > 1);
      const lookRows: ReportRow[] = [];
      for (const g of lookAlike) {
        lookRows.push(groupRow({ date: g[0].transactionDate, description: `${g.length} identical rows — ${g[0].description}` }));
        for (const t of g) {
          const r = txnRow(c, t);
          r.level = 1;
          r.cells.reference = `${t.reference}${t.sourceOccurrence > 1 ? ` · occurrence ${t.sourceOccurrence} in source` : ""}`;
          lookRows.push(r);
        }
      }
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Flagged by matching", flagged.length), summaryCount("Look-alike groups", lookAlike.length)],
        sections: [
          section(TXN_COLUMNS, flagged.map((t) => txnRow(c, t)), "Flagged as possible duplicate payments", "Nothing flagged in this period."),
          section(TXN_COLUMNS, lookRows, "Look-alike groups", "No look-alike groups in this period."),
        ],
        checks: [],
        notices: ["A look-alike is not necessarily a duplicate: rows with different 'occurrence' numbers were separate lines in the same source file (for example two identical card purchases on one day) and were deliberately kept. Review before acting — this report changes nothing."],
      };
    },
  },
  {
    id: "transaction-lifecycle",
    title: "Transaction Lifecycle",
    description: "Where every bank transaction in the period stands: Imported → Allocated → Ready to Post → Posted → Reconciled.",
    categories: ["banking", "audit"],
    filters: [...F.period, F.bankAccount],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const bankAccountId = numberFilter(ctx.filters.bankAccountId);
      const [c, bank] = await Promise.all([context(ctx), ctx.source.bankTransactions({ from: dateFrom, to: dateTo })]);
      const list = bank.items.filter((t) => bankAccountId === null || t.bankAccountId === bankAccountId);
      const allocated = list.filter((t) => t.postedFlag || t.reconciliationId !== null || isAllocatedForPosting(t));
      const stage = (label: string, items: BankTransactionRecord[], status?: TransactionPostingStatus) =>
        row({ stage: label, count: items.length, in: sum(items, (t) => t.credit), out: sum(items, (t) => t.debit), share: list.length ? round2((items.length / list.length) * 100) : null }, status ? { drill: drill.report("bank-transactions", { dateFrom, dateTo, status, ...(bankAccountId !== null ? { bankAccountId: String(bankAccountId) } : {}) }) } : { drill: drill.report("bank-transactions", { dateFrom, dateTo }) });
      const byStatus = (s: TransactionPostingStatus) => list.filter((t) => transactionPostingStatus(t) === s);
      const funnel = [
        stage("Imported / captured", list),
        stage("Allocated (VYRON knows where it belongs)", allocated),
        stage("Posted to the General Ledger", list.filter((t) => t.postedFlag)),
        stage("Reconciled to a bank statement", byStatus("Reconciled"), "Reconciled"),
      ];
      const current = LIFECYCLE.map((s) => stage(s, byStatus(s), s));
      const perAccount = c.bankAccounts
        .filter((b) => bankAccountId === null || b.id === bankAccountId)
        .map((b) => {
          const own = list.filter((t) => t.bankAccountId === b.id);
          return row({ account: `${b.accountName} (${b.accountNumber})`, total: own.length, ...Object.fromEntries(LIFECYCLE.map((s) => [s, own.filter((t) => transactionPostingStatus(t) === s).length])) });
        });
      const cols = [col("stage", "Stage"), col("count", "Transactions", "number"), col("in", "Money In", "money"), col("out", "Money Out", "money"), col("share", "% of Imported", "percent")];
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Imported", list.length), ...LIFECYCLE.map((s) => summaryCount(s, byStatus(s).length))],
        sections: [
          section(cols, funnel, "Progress (cumulative)"),
          section(cols, current, "Current status (each transaction counted once)"),
          section([col("account", "Bank Account"), col("total", "Transactions", "number"), ...LIFECYCLE.map((s) => col(s, s, "number"))], perAccount, "By bank account", "No bank accounts."),
        ],
        checks: [check("Every transaction has exactly one status", list.length, sum(LIFECYCLE, (s) => byStatus(s).length))],
        notices: ["Statuses use the same rule as the Transaction Explorer: Reconciled if on a completed statement, else Posted if in the GL, else Ready to Post if allocated, else Unprocessed."],
      };
    },
  },
  {
    id: "bank-transaction-detail",
    title: "Bank Transaction Trace",
    description: "One bank transaction's full trail: import, allocation and its history, posting journal and GL lines, and reconciliation.",
    categories: ["banking", "audit"],
    filters: [{ key: "transactionId", label: "Transaction ID", control: "text", required: true }],
    async build(ctx) {
      const id = numberFilter(ctx.filters.transactionId);
      if (id === null) throw new ReportInputError("Enter a bank transaction ID.");
      const [bank, c, recs, batches, journals] = await Promise.all([ctx.source.bankTransactions({}), context(ctx), ctx.source.bankReconciliations(), ctx.source.importBatches(), ctx.source.journals()]);
      const t = bank.items.find((x) => x.id === id);
      if (!t) throw new ReportInputError("That bank transaction does not exist in this company.");
      const history = (await ctx.source.allocationHistory({})).items.filter((h) => h.transactionId === id);
      const rec = t.reconciliationId !== null ? recs.find((r) => r.id === t.reconciliationId) : undefined;
      const batch = batches.find((b) => b.batchId === t.importBatch);
      const journal = t.journalId !== null ? journals.find((j) => j.id === t.journalId) : undefined;
      const status = transactionPostingStatus(t);
      const allocated = t.postedFlag || t.reconciliationId !== null || isAllocatedForPosting(t);
      const steps: ReportRow[] = [
        row({ step: "Imported", done: "✓", when: t.createdAt.slice(0, 16).replace("T", " "), detail: t.entrySource === "Manual" ? "Captured manually in the Cashbook" : `${batch?.sourceFilename || t.sourceFilename || t.importBatch}${t.sourceOccurrence > 1 ? ` · occurrence ${t.sourceOccurrence}` : ""}` }, batch ? { drill: drill.report("imported-transaction-audit", { importBatch: batch.batchId }) } : {}),
        row({ step: "Allocated", done: allocated ? "✓" : "—", detail: `${c.allocation(t)}${t.suggestedVatCode ? ` · VAT ${t.suggestedVatCode}` : ""}${t.allocationMethod ? ` · ${t.allocationMethod}` : ""}${t.isManualOverride ? " · manual override" : ""}${t.allocationReason ? ` · ${t.allocationReason}` : ""}` }),
        row({ step: "Ready to Post", done: allocated ? "✓" : "—", detail: t.reviewHold ? `On review hold: ${t.reviewHoldReason}` : allocated ? "Eligible for posting" : "Needs an allocation first" }),
        row({ step: "Posted", done: t.postedFlag ? "✓" : "—", when: t.postedAt ? t.postedAt.slice(0, 16).replace("T", " ") : "", detail: journal ? `Journal ${journal.journalNumber}${t.postingBatchId ? ` · posting batch #${t.postingBatchId}` : ""}` : t.journalId ? `Journal #${t.journalId}` : "Not in the General Ledger" }, t.journalId !== null ? { drill: drill.journal(t.journalId) } : {}),
        row({ step: "Reconciled", done: rec ? "✓" : "—", when: rec?.completedAt ? rec.completedAt.slice(0, 16).replace("T", " ") : "", detail: rec ? `Statement ${rec.statementDate} · ${rec.status}` : "Not yet reconciled" }, rec ? { drill: drill.report("bank-reconciliation", { reconciliationId: String(rec.id) }) } : {}),
      ];
      const sections = [section([col("step", "Stage"), col("done", ""), col("when", "When"), col("detail", "Detail")], steps, "Lifecycle")];
      if (t.journalId !== null && t.transactionDate) {
        const gl = (await ctx.source.glTransactions({ from: t.transactionDate, to: t.transactionDate })).items.filter((g) => g.journalId === t.journalId);
        sections.push(section([col("account", "Account"), col("description", "Description"), col("debit", "Debit", "money"), col("credit", "Credit", "money")], gl.map((g) => row({ account: `${g.accountCode} ${g.accountDescription}`, description: g.description, debit: g.debit || null, credit: g.credit || null }, { drill: drill.report("gl-account-activity", { accountId: String(g.accountId), dateFrom: t.transactionDate!, dateTo: t.transactionDate! }) })), "General Ledger lines of the posting journal", "The journal has no GL lines on the transaction date."));
      }
      const links: ReportRow[] = [];
      if (t.matchedBillId !== null) links.push(row({ link: "Supplier bill", detail: `Bill #${t.matchedBillId}` }, { drill: drill.document("purchase-bill", t.matchedBillId) }));
      if (t.matchedSupplierId !== null) links.push(row({ link: "Supplier ledger", detail: c.allocation(t) }, { drill: drill.report("supplier-detailed-ledger", { supplierId: String(t.matchedSupplierId) }) }));
      if (t.matchedCustomerId !== null) links.push(row({ link: "Customer ledger", detail: c.allocation(t) }, { drill: drill.report("customer-detailed-ledger", { customerId: String(t.matchedCustomerId) }) }));
      sections.push(section([col("link", "Linked To", "badge"), col("detail", "Detail")], links, "Linked documents & ledgers", "Not linked to a customer, supplier or document."));
      sections.push(
        section(
          [col("when", "When"), col("status", "Status"), col("gl", "GL Account"), col("vat", "VAT"), col("reason", "Reason"), col("by", "By")],
          history.map((h) => row({ when: h.createdAt.slice(0, 16).replace("T", " "), status: `${h.previousStatus ?? "—"} → ${h.newStatus}`, gl: `${h.previousGlAccount ?? "—"} → ${h.newGlAccount ?? "—"}`, vat: `${h.previousVatCode ?? "—"} → ${h.newVatCode ?? "—"}`, reason: h.allocationReason, by: h.performedBy })),
          "Allocation history",
          "No allocation changes recorded.",
        ),
      );
      return {
        subtitle: `${t.transactionDate ?? ""} · ${accountLabel(c.byId, t)} · ${t.description}`,
        summary: [summaryText("Status", status), summaryMoney(t.credit > 0 ? "Money In" : "Money Out", t.credit > 0 ? t.credit : t.debit), summaryText("Allocation", c.allocation(t))],
        sections,
        checks: journal ? [check("Posting journal balances", journal.totalDebit, journal.totalCredit)] : [],
        notices: journal && journal.lines.length > 2 ? ["A bank posting journal can carry several transactions of the same date; all its GL lines are shown."] : [],
      };
    },
  },
];

async function allocatedTo(ctx: ReportContext, pattern: RegExp, kind: string) {
  const { dateFrom, dateTo } = ctx.filters;
  const bankAccountId = numberFilter(ctx.filters.bankAccountId);
  const [c, bank, accounts, start, end] = await Promise.all([context(ctx), ctx.source.bankTransactions({ from: dateFrom, to: dateTo }), ctx.source.accounts(), ctx.source.trialBalance(dayBefore(dateFrom)), ctx.source.trialBalance(dateTo)]);
  const matched = accountsMatching(accounts, pattern);
  const codes = new Set(matched.map((a) => a.accountCode));
  const list = bank.items.filter((t) => codes.has((t.suggestedGlAccount ?? "").trim()) && (bankAccountId === null || t.bankAccountId === bankAccountId));
  const rows = list.map((t) => txnRow(c, t));
  rows.push(txnTotals(list));
  const glRows = matched.map((a) => {
    const s = start.find((r) => r.accountId === a.id);
    const e = end.find((r) => r.accountId === a.id);
    return row({ account: `${a.accountCode} ${a.description}`, type: a.accountType, debits: round2((e?.totalDebit ?? 0) - (s?.totalDebit ?? 0)), credits: round2((e?.totalCredit ?? 0) - (s?.totalCredit ?? 0)) }, { drill: drill.report("gl-account-activity", { accountId: String(a.id), dateFrom, dateTo }) });
  });
  return {
    subtitle: periodLabel(dateFrom, dateTo),
    summary: [summaryCount("Transactions", list.length), summaryMoney("Money In", sum(list, (t) => t.credit)), summaryMoney("Money Out", sum(list, (t) => t.debit))],
    sections: [
      section(TXN_COLUMNS, rows, "Bank transactions", `No bank transactions allocated to ${kind} accounts in this period.`),
      section([col("account", "GL Account"), col("type", "Type"), col("debits", "Period Debits", "money"), col("credits", "Period Credits", "money")], glRows, "Per General Ledger", `No ${kind} accounts in the Chart of Accounts.`),
    ],
    checks: [],
    notices: [`Accounts treated as ${kind} accounts (by name): ${matched.map((a) => `${a.accountCode} ${a.description}`).join(", ") || "none"}. The GL figures also include postings that did not come from the bank feed.`],
  };
}
