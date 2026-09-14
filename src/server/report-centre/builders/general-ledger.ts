/**
 * General Ledger & accounting reports — Trial Balance family, General
 * Ledger, account activity/balances, journals, allocation history and
 * the audit trail. Balances come from the Trial Balance (`fn_trial_balance`,
 * the platform's one balance computation); transaction listings come from
 * the posted GL lines themselves.
 */

import {
  asAtLabel,
  col,
  dayBefore,
  drill,
  F,
  groupRow,
  numberFilter,
  periodLabel,
  row,
  section,
  shiftYears,
  subtotalRow,
  summaryCount,
  summaryMoney,
  summaryText,
  totalRow,
  type ReportDefinition,
} from "../kit";
import { check, inRange, round2, sum, ReportInputError, type DrillTarget, type ReconciliationCheck, type ReportRow } from "../types";
import { ACCOUNT_TYPE_ORDER, accountsById, financialYearFor, naturalBalance, netDebit, sourceDocumentDrill, sourceLabel } from "./shared";
import { compareGlAccountCodes, type ChartOfAccount, type TrialBalanceRow } from "@/server/general-ledger/types";
import type { Journal, JournalStatus } from "@/server/accounting/types";

const JOURNAL_STATUSES: JournalStatus[] = ["Draft", "Submitted", "Approved", "Rejected", "Posted", "Cancelled"];

function filterByType<T extends { accountType: string }>(rows: T[], accountType: string | undefined): T[] {
  return accountType ? rows.filter((r) => r.accountType === accountType) : rows;
}

function tbCheck(rows: TrialBalanceRow[], label: string): ReconciliationCheck {
  return check(label, sum(rows, (r) => r.debitBalance), sum(rows, (r) => r.creditBalance), "An out-of-balance Trial Balance means an unbalanced posting reached the General Ledger.");
}

export const GENERAL_LEDGER_REPORTS: ReportDefinition[] = [
  {
    id: "trial-balance",
    title: "Trial Balance",
    description: "Every account's debit or credit balance as at a date, grouped by account type. Debits must equal credits.",
    categories: ["general-ledger", "financial"],
    filters: [F.asAt, F.accountType],
    async build(ctx) {
      const { asAt, accountType } = ctx.filters;
      const all = await ctx.source.trialBalance(asAt);
      const fy = await financialYearFor(ctx, asAt);
      const rows: ReportRow[] = [];
      const visible = filterByType(all, accountType).filter((r) => r.debitBalance !== 0 || r.creditBalance !== 0);
      for (const type of ACCOUNT_TYPE_ORDER) {
        const group = visible.filter((r) => r.accountType === type);
        if (group.length === 0) continue;
        rows.push(groupRow({ code: type }));
        for (const r of group) rows.push(row({ code: r.accountCode, account: r.description, debit: r.debitBalance || null, credit: r.creditBalance || null }, { level: 1, drill: drill.report("gl-account-activity", { accountId: String(r.accountId), dateFrom: fy.start, dateTo: asAt }) }));
        rows.push(subtotalRow({ account: `Total ${type}`, debit: sum(group, (r) => r.debitBalance), credit: sum(group, (r) => r.creditBalance) }));
      }
      const totalDebit = sum(visible, (r) => r.debitBalance);
      const totalCredit = sum(visible, (r) => r.creditBalance);
      rows.push(totalRow({ account: "Total", debit: totalDebit, credit: totalCredit }));
      return {
        subtitle: asAtLabel(asAt),
        summary: [summaryMoney("Total Debits", totalDebit), summaryMoney("Total Credits", totalCredit), summaryMoney("Difference", round2(totalDebit - totalCredit)), summaryCount("Accounts with a balance", visible.length)],
        sections: [section([col("code", "Code"), col("account", "Account"), col("debit", "Debit", "money"), col("credit", "Credit", "money")], rows, undefined, "No balances as at this date.")],
        checks: accountType ? [] : [tbCheck(all, "Trial Balance debits equal credits")],
        notices: accountType ? [`Filtered to ${accountType} accounts — the balance check applies to the full Trial Balance only.`] : [],
      };
    },
  },
  {
    id: "detailed-trial-balance",
    title: "Detailed Trial Balance",
    description: "Opening balance, period debits and credits, and closing balance for every account.",
    categories: ["general-ledger"],
    filters: [...F.period, F.accountType],
    async build(ctx) {
      const { dateFrom, dateTo, accountType } = ctx.filters;
      const [start, end] = await Promise.all([ctx.source.trialBalance(dayBefore(dateFrom)), ctx.source.trialBalance(dateTo)]);
      const startById = new Map(start.map((r) => [r.accountId, r]));
      const lines = filterByType(end, accountType).map((r) => {
        const s = startById.get(r.accountId);
        return { r, opening: netDebit(s), debits: round2(r.totalDebit - (s?.totalDebit ?? 0)), credits: round2(r.totalCredit - (s?.totalCredit ?? 0)), closing: netDebit(r) };
      }).filter((l) => l.opening !== 0 || l.debits !== 0 || l.credits !== 0 || l.closing !== 0);
      const rows = lines.map((l) => row({ code: l.r.accountCode, account: l.r.description, type: l.r.accountType, opening: l.opening, debits: l.debits, credits: l.credits, closing: l.closing }, { drill: drill.report("gl-account-activity", { accountId: String(l.r.accountId), dateFrom, dateTo }) }));
      const totals = { opening: sum(lines, (l) => l.opening), debits: sum(lines, (l) => l.debits), credits: sum(lines, (l) => l.credits), closing: sum(lines, (l) => l.closing) };
      rows.push(totalRow({ account: "Total", ...totals }));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Period Debits", totals.debits), summaryMoney("Period Credits", totals.credits)],
        sections: [section([col("code", "Code"), col("account", "Account"), col("type", "Type"), col("opening", "Opening (Dr+ / Cr−)", "money"), col("debits", "Debits", "money"), col("credits", "Credits", "money"), col("closing", "Closing (Dr+ / Cr−)", "money")], rows, undefined, "No balances or movements.")],
        checks: accountType
          ? [check("Opening + debits − credits = closing", totals.closing, round2(totals.opening + totals.debits - totals.credits))]
          : [
              check("Opening Trial Balance nets to zero", 0, totals.opening),
              check("Period debits equal period credits", totals.debits, totals.credits),
              check("Closing Trial Balance nets to zero", 0, totals.closing),
            ],
        notices: ["Balances are signed debit-positive: a credit balance shows as a negative figure."],
      };
    },
  },
  {
    id: "comparative-trial-balance",
    title: "Comparative Trial Balance",
    description: "Trial Balance at two dates side by side with the movement between them.",
    categories: ["general-ledger"],
    filters: [F.asAt, { key: "compareDateTo", label: "Compare as at", control: "date" }, F.accountType],
    async build(ctx) {
      const { asAt, accountType } = ctx.filters;
      const compareAt = ctx.filters.compareDateTo || shiftYears(asAt, -1);
      const [current, prior] = await Promise.all([ctx.source.trialBalance(asAt), ctx.source.trialBalance(compareAt)]);
      const priorById = new Map(prior.map((r) => [r.accountId, r]));
      const lines = filterByType(current, accountType)
        .map((r) => ({ r, p: priorById.get(r.accountId) }))
        .filter(({ r, p }) => r.debitBalance || r.creditBalance || p?.debitBalance || p?.creditBalance);
      const rows = lines.map(({ r, p }) =>
        row({ code: r.accountCode, account: r.description, debit: r.debitBalance || null, credit: r.creditBalance || null, priorDebit: p?.debitBalance || null, priorCredit: p?.creditBalance || null, movement: round2(netDebit(r) - netDebit(p)) }),
      );
      rows.push(totalRow({ account: "Total", debit: sum(lines, (l) => l.r.debitBalance), credit: sum(lines, (l) => l.r.creditBalance), priorDebit: sum(lines, (l) => l.p?.debitBalance ?? 0), priorCredit: sum(lines, (l) => l.p?.creditBalance ?? 0), movement: sum(lines, (l) => netDebit(l.r) - netDebit(l.p)) }));
      return {
        subtitle: `${asAtLabel(asAt)} compared with ${asAtLabel(compareAt).toLowerCase()}`,
        summary: [summaryMoney("Debits (current)", sum(lines, (l) => l.r.debitBalance)), summaryMoney("Debits (comparative)", sum(lines, (l) => l.p?.debitBalance ?? 0))],
        sections: [
          section(
            [col("code", "Code"), col("account", "Account"), col("debit", `Debit ${asAt}`, "money"), col("credit", `Credit ${asAt}`, "money"), col("priorDebit", `Debit ${compareAt}`, "money"), col("priorCredit", `Credit ${compareAt}`, "money"), col("movement", "Movement (Dr+)", "money")],
            rows,
            undefined,
            "No balances at either date.",
          ),
        ],
        checks: accountType ? [] : [tbCheck(current, `Trial Balance at ${asAt} balances`), tbCheck(prior, `Trial Balance at ${compareAt} balances`)],
        notices: [],
      };
    },
  },
  {
    id: "general-ledger",
    title: "General Ledger",
    description: "Opening balance, debits, credits and closing balance for every account with activity, drillable to each account's transactions.",
    categories: ["general-ledger"],
    filters: [...F.period, F.accountType, F.account()],
    async build(ctx) {
      const { dateFrom, dateTo, accountType } = ctx.filters;
      const accountId = numberFilter(ctx.filters.accountId);
      const [start, end] = await Promise.all([ctx.source.trialBalance(dayBefore(dateFrom)), ctx.source.trialBalance(dateTo)]);
      const startById = new Map(start.map((r) => [r.accountId, r]));
      const lines = filterByType(end, accountType)
        .filter((r) => accountId === null || r.accountId === accountId)
        .map((r) => {
          const s = startById.get(r.accountId);
          return { r, opening: naturalBalance(r.normalBalance, s?.totalDebit ?? 0, s?.totalCredit ?? 0), debits: round2(r.totalDebit - (s?.totalDebit ?? 0)), credits: round2(r.totalCredit - (s?.totalCredit ?? 0)), closing: naturalBalance(r.normalBalance, r.totalDebit, r.totalCredit) };
        })
        .filter((l) => l.opening !== 0 || l.debits !== 0 || l.credits !== 0);
      const rows = lines.map((l) =>
        row({ code: l.r.accountCode, account: l.r.description, type: l.r.accountType, opening: l.opening, debits: l.debits, credits: l.credits, closing: l.closing }, { drill: drill.report("gl-account-activity", { accountId: String(l.r.accountId), dateFrom, dateTo }) }),
      );
      rows.push(totalRow({ account: `${lines.length} accounts`, debits: sum(lines, (l) => l.debits), credits: sum(lines, (l) => l.credits) }));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Accounts", lines.length), summaryMoney("Debits", sum(lines, (l) => l.debits)), summaryMoney("Credits", sum(lines, (l) => l.credits))],
        sections: [section([col("code", "Code"), col("account", "Account"), col("type", "Type"), col("opening", "Opening", "money"), col("debits", "Debits", "money"), col("credits", "Credits", "money"), col("closing", "Closing", "money")], rows, undefined, "No activity in this period.")],
        checks: accountType || accountId !== null ? [] : [check("Period debits equal period credits", sum(lines, (l) => l.debits), sum(lines, (l) => l.credits))],
        notices: ["Opening and closing balances are shown on each account's normal side (a debit-normal account's debit balance is positive)."],
      };
    },
  },
  {
    id: "detailed-general-ledger",
    title: "Detailed General Ledger",
    description: "Every posted GL line in the period by account, with running balances, drillable to the journal and its source document.",
    categories: ["general-ledger", "audit"],
    filters: [...F.period, F.accountType, F.account()],
    async build(ctx) {
      const { dateFrom, dateTo, accountType } = ctx.filters;
      const accountId = numberFilter(ctx.filters.accountId);
      const [accounts, start, end, gl] = await Promise.all([
        ctx.source.accounts(),
        ctx.source.trialBalance(dayBefore(dateFrom)),
        ctx.source.trialBalance(dateTo),
        ctx.source.glTransactions({ from: dateFrom, to: dateTo, ...(accountId !== null ? { accountId } : {}) }),
      ]);
      const byId = accountsById(accounts);
      const startById = new Map(start.map((r) => [r.accountId, r]));
      const endById = new Map(end.map((r) => [r.accountId, r]));
      const linesByAccount = new Map<number, typeof gl.items>();
      for (const t of gl.items) {
        const list = linesByAccount.get(t.accountId) ?? [];
        list.push(t);
        linesByAccount.set(t.accountId, list);
      }
      const accountIds = [...new Set([...linesByAccount.keys(), ...start.filter((r) => r.debitBalance || r.creditBalance).map((r) => r.accountId)])]
        .filter((id) => (accountId === null || id === accountId) && (!accountType || byId.get(id)?.accountType === accountType))
        .sort((a, b) => compareGlAccountCodes(byId.get(a)?.accountCode ?? "", byId.get(b)?.accountCode ?? ""));
      const rows: ReportRow[] = [];
      let mismatches = 0;
      for (const id of accountIds) {
        const account = byId.get(id);
        if (!account) continue;
        const s = startById.get(id);
        let balance = naturalBalance(account.normalBalance, s?.totalDebit ?? 0, s?.totalCredit ?? 0);
        rows.push(groupRow({ date: account.accountCode, journal: account.description }));
        rows.push(row({ description: "Opening balance", balance }, { level: 1 }));
        for (const t of linesByAccount.get(id) ?? []) {
          balance = round2(balance + (account.normalBalance === "Debit" ? t.debit - t.credit : t.credit - t.debit));
          rows.push(row({ date: t.postingDate, journal: t.journalNumber, reference: t.reference, description: t.description, source: sourceLabel(t.sourceType), debit: t.debit || null, credit: t.credit || null, balance }, { level: 1, drill: drill.journal(t.journalId) }));
        }
        const e = endById.get(id);
        if (e && round2(balance - naturalBalance(account.normalBalance, e.totalDebit, e.totalCredit)) !== 0) mismatches++;
        rows.push(subtotalRow({ description: `Closing balance — ${account.accountCode} ${account.description}`, balance }));
      }
      const checks: ReconciliationCheck[] = [check("Accounts whose closing balance disagrees with the Trial Balance", 0, mismatches)];
      if (!accountType && accountId === null) checks.push(check("Posted GL debits equal credits in the period", sum(gl.items, (t) => t.debit), sum(gl.items, (t) => t.credit)));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("GL lines", gl.items.length), summaryMoney("Debits", sum(gl.items, (t) => t.debit)), summaryMoney("Credits", sum(gl.items, (t) => t.credit))],
        sections: [section([col("date", "Date", "date"), col("journal", "Journal"), col("reference", "Reference"), col("description", "Description"), col("source", "Source", "badge"), col("debit", "Debit", "money"), col("credit", "Credit", "money"), col("balance", "Balance", "money")], rows, undefined, "No GL activity in this period.")],
        checks,
        notices: gl.truncated ? ["The GL exceeded the report read limit; narrow the date range for a complete listing."] : [],
      };
    },
  },
  {
    id: "gl-account-activity",
    title: "GL Account Activity",
    description: "One account's opening balance, every posting in the period with a running balance, and its closing balance.",
    categories: ["general-ledger"],
    filters: [F.account(true), ...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const accountId = numberFilter(ctx.filters.accountId);
      if (accountId === null) throw new ReportInputError("Choose a GL account.");
      const [accounts, start, end, gl] = await Promise.all([ctx.source.accounts(), ctx.source.trialBalance(dayBefore(dateFrom)), ctx.source.trialBalance(dateTo), ctx.source.glTransactions({ from: dateFrom, to: dateTo, accountId })]);
      const account = accounts.find((a) => a.id === accountId);
      if (!account) throw new ReportInputError("That GL account does not exist in this company.");
      const s = start.find((r) => r.accountId === accountId);
      const e = end.find((r) => r.accountId === accountId);
      const opening = naturalBalance(account.normalBalance, s?.totalDebit ?? 0, s?.totalCredit ?? 0);
      let balance = opening;
      const rows: ReportRow[] = [row({ description: "Opening balance", balance: opening })];
      for (const t of gl.items) {
        balance = round2(balance + (account.normalBalance === "Debit" ? t.debit - t.credit : t.credit - t.debit));
        rows.push(row({ date: t.postingDate, journal: t.journalNumber, reference: t.reference, description: t.description, source: sourceLabel(t.sourceType), debit: t.debit || null, credit: t.credit || null, balance }, { drill: drill.journal(t.journalId) }));
      }
      rows.push(totalRow({ description: "Closing balance", debit: sum(gl.items, (t) => t.debit), credit: sum(gl.items, (t) => t.credit), balance }));
      const tbClosing = naturalBalance(account.normalBalance, e?.totalDebit ?? 0, e?.totalCredit ?? 0);
      return {
        subtitle: `${account.accountCode} ${account.description} · ${periodLabel(dateFrom, dateTo)}`,
        summary: [summaryMoney("Opening Balance", opening), summaryMoney("Debits", sum(gl.items, (t) => t.debit)), summaryMoney("Credits", sum(gl.items, (t) => t.credit)), summaryMoney("Closing Balance", balance)],
        sections: [section([col("date", "Date", "date"), col("journal", "Journal"), col("reference", "Reference"), col("description", "Description"), col("source", "Source", "badge"), col("debit", "Debit", "money"), col("credit", "Credit", "money"), col("balance", "Balance", "money")], rows)],
        checks: [check("Closing balance agrees with the Trial Balance", tbClosing, balance)],
        notices: [`${account.accountType} account · normal balance ${account.normalBalance.toLowerCase()}.`, ...(gl.truncated ? ["The GL exceeded the report read limit; narrow the date range."] : [])],
      };
    },
  },
  {
    id: "gl-account-balances",
    title: "GL Account Balances",
    description: "Each account's balance on its normal side as at a date.",
    categories: ["general-ledger"],
    filters: [F.asAt, F.accountType],
    async build(ctx) {
      const { asAt, accountType } = ctx.filters;
      const [tb, fy] = await Promise.all([ctx.source.trialBalance(asAt), financialYearFor(ctx, asAt)]);
      const lines = filterByType(tb, accountType).filter((r) => r.totalDebit !== 0 || r.totalCredit !== 0);
      const rows = lines.map((r) => row({ code: r.accountCode, account: r.description, type: r.accountType, normal: r.normalBalance, balance: naturalBalance(r.normalBalance, r.totalDebit, r.totalCredit) }, { drill: drill.report("gl-account-activity", { accountId: String(r.accountId), dateFrom: fy.start, dateTo: asAt }) }));
      return {
        subtitle: asAtLabel(asAt),
        summary: [summaryCount("Accounts", lines.length)],
        sections: [section([col("code", "Code"), col("account", "Account"), col("type", "Type"), col("normal", "Normal"), col("balance", "Balance", "money")], rows, undefined, "No balances.")],
        checks: accountType ? [] : [tbCheck(tb, "Trial Balance debits equal credits")],
        notices: [],
      };
    },
  },
  journalRegister("journal-register", "Journal Register", "Every journal in the period with its source, status and totals.", null),
  journalRegister("posted-journals", "Posted Journal Report", "Journals that have been posted to the General Ledger in the period.", ["Posted"]),
  journalRegister("unposted-journals", "Unposted Journal Report", "Journals in the period that have not reached the General Ledger — Draft, Submitted, Approved or Rejected.", ["Draft", "Submitted", "Approved", "Rejected"]),
  {
    id: "journal-detail",
    title: "Journal Detail",
    description: "A journal's lines, its GL postings, and the source document or bank transactions it came from.",
    categories: ["general-ledger", "audit"],
    filters: [F.journal(true)],
    async build(ctx) {
      const journalId = numberFilter(ctx.filters.journalId);
      if (journalId === null) throw new ReportInputError("Choose a journal.");
      const [journals, accounts] = await Promise.all([ctx.source.journals(), ctx.source.accounts()]);
      const journal = journals.find((j) => j.id === journalId);
      if (!journal) throw new ReportInputError("That journal does not exist in this company.");
      const byCode = new Map(accounts.map((a) => [a.accountCode, a]));
      const fy = await financialYearFor(ctx, journal.journalDate);
      const lineRows = [...journal.lines]
        .sort((a, b) => a.lineOrder - b.lineOrder)
        .map((l) => {
          const account = byCode.get(l.accountCode);
          return row(
            { code: l.accountCode, account: account?.description ?? "Account not in chart", description: l.description, debit: l.debit || null, credit: l.credit || null },
            account ? { drill: drill.report("gl-account-activity", { accountId: String(account.id), dateFrom: fy.start, dateTo: journal.journalDate > fy.end ? journal.journalDate : fy.end }) } : {},
          );
        });
      const totalDebit = sum(journal.lines, (l) => l.debit);
      const totalCredit = sum(journal.lines, (l) => l.credit);
      lineRows.push(totalRow({ account: "Total", debit: totalDebit, credit: totalCredit }));

      const checks: ReconciliationCheck[] = [check("Journal debits equal credits", totalDebit, totalCredit)];
      const sections = [section([col("code", "Code"), col("account", "Account"), col("description", "Description"), col("debit", "Debit", "money"), col("credit", "Credit", "money")], lineRows, "Journal Lines")];

      const gl = await ctx.source.glTransactions({ from: journal.journalDate, to: journal.journalDate });
      const postings = gl.items.filter((t) => t.journalId === journal.id);
      if (journal.status === "Posted") {
        checks.push(check("Posted journal is fully in the General Ledger", totalDebit, sum(postings, (t) => t.debit)));
        sections.push(
          section(
            [col("date", "Posting Date", "date"), col("code", "Account"), col("description", "Description"), col("debit", "Debit", "money"), col("credit", "Credit", "money")],
            postings.map((t) => row({ date: t.postingDate, code: `${t.accountCode} ${t.accountDescription}`, description: t.description, debit: t.debit || null, credit: t.credit || null }, { drill: drill.report("gl-account-activity", { accountId: String(t.accountId), dateFrom: fy.start, dateTo: fy.end }) })),
            "General Ledger Postings",
            "No GL lines found for this journal on its journal date.",
          ),
        );
      }

      const trace: ReportRow[] = [];
      const docDrill = sourceDocumentDrill(journal.sourceType, journal.sourceId);
      if (docDrill) trace.push(row({ kind: sourceLabel(journal.sourceType), reference: `#${journal.sourceId}`, detail: "Source document" }, { drill: docDrill }));
      const bank = await ctx.source.bankTransactions({});
      for (const t of bank.items.filter((b) => b.journalId === journal.id)) {
        trace.push(row({ kind: "Bank Transaction", reference: t.reference || t.description, detail: `${t.transactionDate ?? ""} · ${t.bankAccount} · ${t.debit ? `out ${t.debit.toFixed(2)}` : `in ${t.credit.toFixed(2)}`}` }, { drill: drill.bank(t.id) }));
      }
      if (journal.reversalOfJournalId) trace.push(row({ kind: "Reverses", reference: `Journal #${journal.reversalOfJournalId}` }, { drill: drill.journal(journal.reversalOfJournalId) }));
      if (journal.reversedByJournalId) trace.push(row({ kind: "Reversed by", reference: `Journal #${journal.reversedByJournalId}` }, { drill: drill.journal(journal.reversedByJournalId) }));
      sections.push(section([col("kind", "Link", "badge"), col("reference", "Reference"), col("detail", "Detail")], trace, "Source & Traceability", "This journal was entered directly — it has no source document."));

      return {
        subtitle: `${journal.journalNumber} · ${journal.journalDate} · ${journal.status}`,
        summary: [
          summaryText("Journal", journal.journalNumber),
          summaryText("Status", journal.status),
          summaryText("Source", sourceLabel(journal.sourceType)),
          summaryText("Description", journal.description || journal.journalType || "—"),
          summaryMoney("Total", totalDebit),
        ],
        sections,
        checks,
        notices: [
          [journal.submittedBy && `Submitted by ${journal.submittedBy}`, journal.approvedBy && `approved by ${journal.approvedBy}`, journal.postedAt && `posted ${journal.postedAt.slice(0, 10)}`].filter(Boolean).join(", ") || "No workflow history recorded.",
        ],
      };
    },
  },
  {
    id: "allocation-history",
    title: "Allocation History",
    description: "Every change to a bank transaction's allocation — status, GL account and VAT code — with who made it and why.",
    categories: ["general-ledger", "banking", "audit"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const history = await ctx.source.allocationHistory({ from: dateFrom, to: dateTo });
      const rows = [...history.items]
        .reverse()
        .map((h) =>
          row(
            {
              when: h.createdAt.slice(0, 16).replace("T", " "),
              transaction: `#${h.transactionId}`,
              status: `${h.previousStatus ?? "—"} → ${h.newStatus}`,
              gl: h.previousGlAccount === h.newGlAccount ? h.newGlAccount ?? "" : `${h.previousGlAccount ?? "—"} → ${h.newGlAccount ?? "—"}`,
              vat: h.previousVatCode === h.newVatCode ? h.newVatCode ?? "" : `${h.previousVatCode ?? "—"} → ${h.newVatCode ?? "—"}`,
              method: h.allocationMethod,
              reason: h.allocationReason,
              override: h.isManualOverride ? "Manual" : "",
              by: h.performedBy,
            },
            { drill: drill.bank(h.transactionId) },
          ),
        );
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Changes", history.items.length), summaryCount("Manual overrides", history.items.filter((h) => h.isManualOverride).length)],
        sections: [section([col("when", "When"), col("transaction", "Transaction"), col("status", "Status"), col("gl", "GL Account"), col("vat", "VAT Code"), col("method", "Method"), col("reason", "Reason"), col("override", "Override", "badge"), col("by", "By")], rows, undefined, "No allocation changes in this period.")],
        checks: [],
        notices: history.truncated ? ["History exceeded the report read limit; narrow the date range."] : [],
      };
    },
  },
  {
    id: "audit-trail",
    title: "Audit Trail",
    description: "One chronological trail of accounting events — journal workflow, postings, reversals, allocation changes, imports, reconciliations and VAT returns — with who did what, when.",
    categories: ["audit", "general-ledger"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [journals, history, batches, reconciliations, vatReturns] = await Promise.all([
        ctx.source.journals(),
        ctx.source.allocationHistory({ from: dateFrom, to: dateTo }),
        ctx.source.importBatches(),
        ctx.source.bankReconciliations(),
        ctx.source.vatReturns(),
      ]);
      type Ev = { at: string; area: string; event: string; reference: string; detail: string; by: string; drill?: DrillTarget };
      const events: Ev[] = [];
      const push = (at: string | null | undefined, e: Omit<Ev, "at">) => {
        if (at && inRange(at, dateFrom, dateTo)) events.push({ at, ...e });
      };
      for (const j of journals) {
        const ref = j.journalNumber;
        const d = drill.journal(j.id);
        push(j.createdAt, { area: "Journal", event: "Created", reference: ref, detail: `${sourceLabel(j.sourceType)} · ${j.description}`, by: "", drill: d });
        push(j.submittedAt, { area: "Journal", event: "Submitted", reference: ref, detail: j.description, by: j.submittedBy ?? "", drill: d });
        push(j.approvedAt, { area: "Journal", event: "Approved", reference: ref, detail: j.description, by: j.approvedBy ?? "", drill: d });
        push(j.rejectedAt, { area: "Journal", event: "Rejected", reference: ref, detail: j.description, by: j.rejectedBy ?? "", drill: d });
        push(j.postedAt, { area: "Journal", event: "Posted to GL", reference: ref, detail: `${j.totalDebit.toFixed(2)} · ${j.description}`, by: "", drill: d });
        push(j.cancelledAt, { area: "Journal", event: "Cancelled", reference: ref, detail: j.description, by: j.cancelledBy ?? "", drill: d });
        if (j.reversalOfJournalId) push(j.createdAt, { area: "Journal", event: "Reversal", reference: ref, detail: `Reverses journal #${j.reversalOfJournalId}`, by: "", drill: d });
      }
      for (const h of history.items) {
        push(h.createdAt, { area: "Allocation", event: h.isManualOverride ? "Manual allocation" : "Allocation", reference: `Bank txn #${h.transactionId}`, detail: `${h.previousStatus ?? "—"} → ${h.newStatus}${h.newGlAccount ? ` · GL ${h.newGlAccount}` : ""}`, by: h.performedBy, drill: drill.bank(h.transactionId) });
      }
      for (const b of batches) {
        push(b.createdAt, { area: "Import", event: b.importType === "bills" ? "Bills imported" : "Bank transactions imported", reference: b.sourceFilename || b.batchId, detail: `${b.importedCount} imported · ${b.duplicateCount} duplicates · ${b.exceptionCount} exceptions`, by: b.importedBy, drill: drill.report("imported-transaction-audit", { importBatch: b.batchId, dateFrom, dateTo }) });
      }
      for (const r of reconciliations) {
        push(r.createdAt, { area: "Reconciliation", event: "Started", reference: `Statement ${r.statementDate}`, detail: `Closing ${r.statementClosingBalance.toFixed(2)}`, by: r.createdBy });
        push(r.completedAt, { area: "Reconciliation", event: "Completed", reference: `Statement ${r.statementDate}`, detail: r.monthEndLocked ? "Month-end locked" : "", by: r.completedBy ?? "" });
        push(r.reopenedAt, { area: "Reconciliation", event: "Reopened", reference: `Statement ${r.statementDate}`, detail: "", by: r.reopenedBy ?? "" });
      }
      for (const v of vatReturns) {
        push(v.generatedAt, { area: "VAT", event: "Return generated", reference: `${v.periodStart} – ${v.periodEnd}`, detail: `Net ${v.netPayable.toFixed(2)}`, by: v.generatedBy });
        push(v.approvedAt, { area: "VAT", event: "Return approved", reference: `${v.periodStart} – ${v.periodEnd}`, detail: "", by: v.approvedBy ?? "" });
        push(v.submittedAt, { area: "VAT", event: "Return submitted", reference: `${v.periodStart} – ${v.periodEnd}`, detail: v.sarsReference ?? "", by: "" });
      }
      events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Events", events.length)],
        sections: [section([col("at", "When"), col("area", "Area", "badge"), col("event", "Event"), col("reference", "Reference"), col("detail", "Detail"), col("by", "By")], events.map((e) => row({ at: e.at.slice(0, 16).replace("T", " "), area: e.area, event: e.event, reference: e.reference, detail: e.detail, by: e.by }, { drill: e.drill })), undefined, "No recorded events in this period.")],
        checks: [],
        notices: ["Built from the timestamps VYRON records on each record; an event with no recorded user shows a blank 'By'."],
      };
    },
  },
];

function journalRegister(id: string, title: string, description: string, statuses: JournalStatus[] | null): ReportDefinition {
  return {
    id,
    title,
    description,
    categories: ["general-ledger", "audit"],
    filters: [...F.period, ...(statuses === null ? [F.status(JOURNAL_STATUSES)] : [])],
    async build(ctx) {
      const { dateFrom, dateTo, status } = ctx.filters;
      const journals = (await ctx.source.journals())
        .filter((j) => inRange(j.journalDate, dateFrom, dateTo) && (statuses === null || statuses.includes(j.status)) && (!status || j.status === status))
        .sort((a, b) => (a.journalDate < b.journalDate ? -1 : a.journalDate > b.journalDate ? 1 : a.journalNumber.localeCompare(b.journalNumber)));
      const rows = journals.map((j: Journal) =>
        row({ date: j.journalDate, number: j.journalNumber, type: j.journalType, description: j.description, source: sourceLabel(j.sourceType), status: j.status + (j.isReversed ? " (reversed)" : ""), debit: j.totalDebit, credit: j.totalCredit }, { drill: drill.journal(j.id) }),
      );
      rows.push(totalRow({ number: `${journals.length} journals`, debit: sum(journals, (j) => j.totalDebit), credit: sum(journals, (j) => j.totalCredit) }));
      const counts = JOURNAL_STATUSES.map((s) => ({ s, n: journals.filter((j) => j.status === s).length })).filter((c) => c.n > 0);
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Journals", journals.length), ...counts.map((c) => summaryCount(c.s, c.n))],
        sections: [section([col("date", "Date", "date"), col("number", "Journal"), col("type", "Type"), col("description", "Description"), col("source", "Source", "badge"), col("status", "Status", "badge"), col("debit", "Debit", "money"), col("credit", "Credit", "money")], rows, undefined, "No journals in this period.")],
        checks: [check("Journal debits equal credits", sum(journals, (j) => j.totalDebit), sum(journals, (j) => j.totalCredit))],
        notices: [],
      };
    },
  };
}

export type { ChartOfAccount };
