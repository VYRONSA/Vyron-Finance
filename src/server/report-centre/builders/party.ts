/**
 * Customer and Supplier reporting — ONE implementation, two sides.
 *
 * Every report here reads the subsidiary ledger built by
 * `party-ledger.ts`, so a Customer Statement, the Customer Aging, the
 * Balance Summary and the Debtors control-account check can never
 * disagree about what a customer owes. The supplier reports are the
 * same code with the Creditors vocabulary.
 */

import {
  balancesAt,
  buildAging,
  buildCustomerLedger,
  buildSupplierLedger,
  bucketFor,
  customerOpenItems,
  daysOverdue,
  isPostedBill,
  supplierOpenItems,
  AGING_BUCKETS,
  type OpenItem,
  type PartyLedgerEntry,
  type PartySide,
} from "../party-ledger";
import {
  asAtLabel,
  col,
  controlAccountCheck,
  dayBefore,
  drill,
  F,
  groupRow,
  numberFilter,
  periodLabel,
  row,
  section,
  subtotalRow,
  summaryCount,
  summaryMoney,
  totalRow,
  type ReportContext,
  type ReportDefinition,
} from "../kit";
import { check, inRange, round2, sum, ReportInputError, type DrillTarget, type ReconciliationCheck, type ReportRow } from "../types";

type SideConfig = {
  side: PartySide;
  party: string;
  parties: string;
  category: "customers" | "suppliers";
  filterKey: "customerId" | "supplierId";
  control: string;
  increaseLabel: string;
  decreaseLabel: string;
  limitLabel: string;
  documentTypes: string[];
  documentLabel: string;
  documentsLabel: string;
  paymentLabel: string;
  paymentsLabel: string;
};

const CUSTOMER: SideConfig = {
  side: "customer",
  party: "Customer",
  parties: "Customers",
  category: "customers",
  filterKey: "customerId",
  control: "Debtors",
  increaseLabel: "Invoices & Charges",
  decreaseLabel: "Receipts & Credits",
  limitLabel: "Credit Limit",
  documentTypes: ["Invoice", "Debit Note"],
  documentLabel: "Invoice",
  documentsLabel: "Invoices",
  paymentLabel: "Receipt",
  paymentsLabel: "Receipts",
};

const SUPPLIER: SideConfig = {
  side: "supplier",
  party: "Supplier",
  parties: "Suppliers",
  category: "suppliers",
  filterKey: "supplierId",
  control: "Creditors",
  increaseLabel: "Bills & Charges",
  decreaseLabel: "Payments & Credits",
  limitLabel: "Spending Limit",
  documentTypes: ["Bill", "Debit Note"],
  documentLabel: "Bill",
  documentsLabel: "Bills",
  paymentLabel: "Payment",
  paymentsLabel: "Payments",
};

type Party = { id: number; code: string; name: string; limit: number; terms: number; vatNumber: string };

async function loadParties(ctx: ReportContext, cfg: SideConfig): Promise<Map<number, Party>> {
  if (cfg.side === "customer") {
    const customers = await ctx.source.customers();
    return new Map(customers.map((c) => [c.id, { id: c.id, code: c.customerCode, name: c.name, limit: c.creditLimit, terms: c.paymentTermsDays, vatNumber: c.vatNumber }]));
  }
  const suppliers = await ctx.source.suppliers();
  return new Map(suppliers.map((s) => [s.id, { id: s.id, code: s.supplierCode, name: s.name, limit: s.spendingLimit, terms: s.paymentTermsDays, vatNumber: s.vatNumber }]));
}

function partyLabel(parties: Map<number, Party>, cfg: SideConfig, id: number): { code: string; name: string } {
  const p = parties.get(id);
  return p ? { code: p.code, name: p.name } : { code: "", name: `${cfg.party} #${id}` };
}

/** The whole subsidiary ledger up to `to` (every earlier entry is needed
 * for opening balances). */
async function loadLedger(ctx: ReportContext, cfg: SideConfig, to: string): Promise<{ entries: PartyLedgerEntry[]; notices: string[] }> {
  const { source } = ctx;
  const [bank, openingBalances] = await Promise.all([source.bankTransactions({ to }), source.openingBalances()]);
  const notices: string[] = [];
  if (bank.truncated) notices.push("Bank transactions exceeded the report read limit; bank-settled amounts may be incomplete.");
  if (cfg.side === "customer") {
    const [invoices, receipts] = await Promise.all([source.salesInvoices(), source.customerReceipts()]);
    return { entries: buildCustomerLedger({ invoices, receipts, bankTransactions: bank.items, openingBalances }), notices };
  }
  const [bills, payments] = await Promise.all([source.bills(), source.supplierPayments()]);
  return { entries: buildSupplierLedger({ bills, payments, bankTransactions: bank.items, openingBalances }), notices };
}

async function loadOpenItems(ctx: ReportContext, cfg: SideConfig, asAt: string): Promise<OpenItem[]> {
  if (cfg.side === "customer") {
    const [invoices, receipts] = await Promise.all([ctx.source.salesInvoices(), ctx.source.customerReceipts()]);
    return customerOpenItems(invoices, receipts, asAt, ctx.today);
  }
  const [bills, payments] = await Promise.all([ctx.source.bills(), ctx.source.supplierPayments()]);
  return supplierOpenItems(bills, payments, asAt, ctx.today);
}

/** Debit/Credit presentation in the party's natural convention: a
 * customer account is debit-normal, a supplier account credit-normal. */
function debitCredit(cfg: SideConfig, amount: number): { debit: number | null; credit: number | null } {
  const increase = amount > 0 ? amount : 0;
  const decrease = amount < 0 ? -amount : 0;
  return cfg.side === "customer"
    ? { debit: increase || null, credit: decrease || null }
    : { debit: decrease || null, credit: increase || null };
}

function entryDrill(e: PartyLedgerEntry): DrillTarget | undefined {
  if (e.docType && e.docId !== null) return drill.document(e.docType, e.docId);
  if (e.bankTransactionId !== null) return drill.bank(e.bankTransactionId);
  if (e.journalId !== null) return drill.journal(e.journalId);
  return undefined;
}

const ENTRY_COLUMNS = [
  col("date", "Date", "date"),
  col("type", "Type", "badge"),
  col("reference", "Reference"),
  col("description", "Description"),
  col("debit", "Debit", "money"),
  col("credit", "Credit", "money"),
  col("balance", "Balance", "money"),
];

function entryRow(cfg: SideConfig, e: PartyLedgerEntry, balance: number): ReportRow {
  const dc = debitCredit(cfg, e.amount);
  return row({ date: e.date, type: e.type, reference: e.reference, description: e.description, debit: dc.debit, credit: dc.credit, balance }, { drill: entryDrill(e) });
}

async function withControlCheck(ctx: ReportContext, cfg: SideConfig, total: number, asAt: string, partyFiltered: boolean) {
  if (partyFiltered) return { checks: [] as ReconciliationCheck[], notices: [`Filtered to one ${cfg.party.toLowerCase()}, so the ${cfg.control} control-account reconciliation is not shown (it applies to the whole ledger).`] };
  return controlAccountCheck(ctx, cfg.side, total, asAt);
}

function agingOf(ctx: ReportContext, cfg: SideConfig, entries: PartyLedgerEntry[], items: OpenItem[], asAt: string, partyId: number | null) {
  const rows = buildAging(entries, items, asAt);
  return partyId === null ? rows : rows.filter((r) => r.partyId === partyId);
}

function partyReports(cfg: SideConfig): ReportDefinition[] {
  const p = cfg.side;
  const partyFilter = F[p](false);
  const L = cfg.party.toLowerCase();

  return [
    {
      id: `${p}-ledger`,
      title: `${cfg.party} Ledger`,
      description: `Opening balance, ${cfg.increaseLabel.toLowerCase()}, ${cfg.decreaseLabel.toLowerCase()} and closing balance for every ${L} in the period.`,
      categories: [cfg.category],
      filters: [...F.period, partyFilter],
      async build(ctx) {
        const { dateFrom, dateTo } = ctx.filters;
        const partyId = numberFilter(ctx.filters[cfg.filterKey]);
        const [parties, { entries, notices }] = await Promise.all([loadParties(ctx, cfg), loadLedger(ctx, cfg, dateTo)]);
        const scoped = partyId === null ? entries : entries.filter((e) => e.partyId === partyId);
        const opening = balancesAt(scoped, dayBefore(dateFrom));
        const closing = balancesAt(scoped, dateTo);
        const inc = new Map<number, number>();
        const dec = new Map<number, number>();
        for (const e of scoped) {
          if (!inRange(e.date, dateFrom, dateTo)) continue;
          if (e.amount > 0) inc.set(e.partyId, round2((inc.get(e.partyId) ?? 0) + e.amount));
          else dec.set(e.partyId, round2((dec.get(e.partyId) ?? 0) - e.amount));
        }
        const ids = [...new Set([...opening.keys(), ...closing.keys(), ...inc.keys(), ...dec.keys()])].filter(
          (id) => (opening.get(id) ?? 0) !== 0 || (closing.get(id) ?? 0) !== 0 || inc.has(id) || dec.has(id),
        );
        const rows = ids
          .map((id) => ({ id, ...partyLabel(parties, cfg, id) }))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(({ id, code, name }) =>
            row(
              { code, name, opening: opening.get(id) ?? 0, increase: inc.get(id) ?? 0, decrease: dec.get(id) ?? 0, closing: closing.get(id) ?? 0 },
              { drill: drill.report(`${p}-detailed-ledger`, { [cfg.filterKey]: String(id), dateFrom, dateTo }) },
            ),
          );
        const totalOpening = sum(ids, (id) => opening.get(id) ?? 0);
        const totalInc = sum(ids, (id) => inc.get(id) ?? 0);
        const totalDec = sum(ids, (id) => dec.get(id) ?? 0);
        const totalClosing = sum(ids, (id) => closing.get(id) ?? 0);
        rows.push(totalRow({ name: `Total — ${ids.length} ${cfg.parties.toLowerCase()}`, opening: totalOpening, increase: totalInc, decrease: totalDec, closing: totalClosing }));
        const closingCheck = await withControlCheck(ctx, cfg, totalClosing, dateTo, partyId !== null);
        const openingCheck = partyId === null ? await controlAccountCheck(ctx, p, totalOpening, dayBefore(dateFrom)) : { checks: [], notices: [] };
        return {
          subtitle: periodLabel(dateFrom, dateTo),
          summary: [summaryMoney("Opening Balance", totalOpening), summaryMoney(cfg.increaseLabel, totalInc), summaryMoney(cfg.decreaseLabel, totalDec), summaryMoney("Closing Balance", totalClosing)],
          sections: [
            section(
              [col("code", "Code"), col("name", cfg.party), col("opening", "Opening", "money"), col("increase", cfg.increaseLabel, "money"), col("decrease", cfg.decreaseLabel, "money"), col("closing", "Closing", "money")],
              rows,
              undefined,
              `No ${L} ledger activity or balances in this period.`,
            ),
          ],
          checks: [check("Opening + movements = closing", totalClosing, round2(totalOpening + totalInc - totalDec)), ...openingCheck.checks, ...closingCheck.checks],
          notices: [...notices, ...openingCheck.notices, ...closingCheck.notices],
        };
      },
    },
    {
      id: `${p}-detailed-ledger`,
      title: `${cfg.party} Detailed Ledger`,
      description: `Every ${L} transaction in the period with its opening balance, running balance and closing balance, drillable to the source document.`,
      categories: [cfg.category],
      filters: [...F.period, partyFilter],
      async build(ctx) {
        const { dateFrom, dateTo } = ctx.filters;
        const partyId = numberFilter(ctx.filters[cfg.filterKey]);
        const [parties, { entries, notices }] = await Promise.all([loadParties(ctx, cfg), loadLedger(ctx, cfg, dateTo)]);
        const scoped = partyId === null ? entries : entries.filter((e) => e.partyId === partyId);
        const opening = balancesAt(scoped, dayBefore(dateFrom));
        const byParty = new Map<number, PartyLedgerEntry[]>();
        for (const e of scoped) {
          if (!inRange(e.date, dateFrom, dateTo)) continue;
          const list = byParty.get(e.partyId) ?? [];
          list.push(e);
          byParty.set(e.partyId, list);
        }
        const ids = [...new Set([...opening.keys(), ...byParty.keys()])].filter((id) => (opening.get(id) ?? 0) !== 0 || byParty.has(id));
        const rows: ReportRow[] = [];
        let grandClosing = 0;
        for (const { id, name, code } of ids.map((id) => ({ id, ...partyLabel(parties, cfg, id) })).sort((a, b) => a.name.localeCompare(b.name))) {
          let balance = opening.get(id) ?? 0;
          rows.push(groupRow({ date: code, type: name }));
          rows.push(row({ description: "Opening balance", balance }, { level: 1 }));
          for (const e of byParty.get(id) ?? []) {
            balance = round2(balance + e.amount);
            rows.push({ ...entryRow(cfg, e, balance), level: 1 });
          }
          rows.push(subtotalRow({ description: `Closing balance — ${name}`, balance }));
          grandClosing = round2(grandClosing + balance);
        }
        rows.push(totalRow({ description: "Total closing balance", balance: grandClosing }));
        const control = await withControlCheck(ctx, cfg, grandClosing, dateTo, partyId !== null);
        return {
          subtitle: periodLabel(dateFrom, dateTo),
          summary: [summaryCount(cfg.parties, ids.length), summaryCount("Transactions", sum([...byParty.values()], (l) => l.length)), summaryMoney("Closing Balance", grandClosing)],
          sections: [section(ENTRY_COLUMNS, rows, undefined, `No ${L} ledger activity in this period.`)],
          checks: control.checks,
          notices: [...notices, ...control.notices],
        };
      },
    },
    {
      id: `${p}-statement`,
      title: `${cfg.party} Statement`,
      description: `A client-ready statement of account: opening balance, every transaction in the period, closing balance and aging.`,
      categories: [cfg.category, "documents"],
      filters: [F[p](true), ...F.period],
      emailable: p === "customer",
      async build(ctx) {
        const { dateFrom, dateTo } = ctx.filters;
        const partyId = numberFilter(ctx.filters[cfg.filterKey]);
        if (partyId === null) throw new ReportInputError(`Choose a ${L} to produce a statement.`);
        const [parties, { entries, notices }, items] = await Promise.all([loadParties(ctx, cfg), loadLedger(ctx, cfg, dateTo), loadOpenItems(ctx, cfg, dateTo)]);
        const party = partyLabel(parties, cfg, partyId);
        const mine = entries.filter((e) => e.partyId === partyId);
        const openingBalance = balancesAt(mine, dayBefore(dateFrom)).get(partyId) ?? 0;
        let balance = openingBalance;
        const rows: ReportRow[] = [row({ date: dateFrom, type: "Opening", description: "Balance brought forward", balance: openingBalance })];
        let charges = 0;
        let credits = 0;
        for (const e of mine) {
          if (!inRange(e.date, dateFrom, dateTo)) continue;
          balance = round2(balance + e.amount);
          if (e.amount > 0) charges = round2(charges + e.amount);
          else credits = round2(credits - e.amount);
          rows.push(entryRow(cfg, e, balance));
        }
        rows.push(totalRow({ description: "Closing balance", balance }));
        const aging = agingOf(ctx, cfg, entries, items.filter((i) => i.partyId === partyId), dateTo, partyId)[0];
        const overdue = aging ? round2(aging.days30 + aging.days60 + aging.days90 + aging.days120Plus) : 0;
        const agingRow = aging
          ? row({ current: aging.current, days30: aging.days30, days60: aging.days60, days90: aging.days90, days120Plus: aging.days120Plus, unallocated: aging.unallocated, balance: aging.balance })
          : row({ balance: 0 });
        return {
          subtitle: `${party.name}${party.code ? ` (${party.code})` : ""} · ${periodLabel(dateFrom, dateTo)}`,
          summary: [summaryMoney("Opening Balance", openingBalance), summaryMoney(cfg.increaseLabel, charges), summaryMoney(cfg.decreaseLabel, credits), summaryMoney(p === "customer" ? "Amount Due" : "Amount Owing", balance), summaryMoney("Overdue", overdue)],
          sections: [
            section(ENTRY_COLUMNS, rows, "Account Activity"),
            section(
              [...AGING_BUCKETS.map((b) => col(b.key, b.label, "money")), col("unallocated", "Unallocated", "money"), col("balance", "Total Due", "money")],
              [agingRow],
              `Aging ${asAtLabel(dateTo)}`,
            ),
          ],
          checks: [check("Statement closing balance equals the aging total", balance, aging?.balance ?? 0)],
          notices,
        };
      },
    },
    {
      id: `${p}-balance-summary`,
      title: `${cfg.party} Balance Summary`,
      description: `What every ${L} ${p === "customer" ? "owes" : "is owed"} as at a date, against their ${cfg.limitLabel.toLowerCase()} and terms.`,
      categories: [cfg.category],
      filters: [F.asAt, partyFilter],
      async build(ctx) {
        const { asAt } = ctx.filters;
        const partyId = numberFilter(ctx.filters[cfg.filterKey]);
        const [parties, { entries, notices }] = await Promise.all([loadParties(ctx, cfg), loadLedger(ctx, cfg, asAt)]);
        const balances = balancesAt(partyId === null ? entries : entries.filter((e) => e.partyId === partyId), asAt);
        const ids = [...balances.keys()].filter((id) => balances.get(id) !== 0);
        const rows = ids
          .map((id) => {
            const label = partyLabel(parties, cfg, id);
            const party = parties.get(id);
            const balance = balances.get(id) ?? 0;
            const limit = party?.limit ?? 0;
            return {
              name: label.name,
              r: row(
                { code: label.code, name: label.name, balance, limit: limit || null, available: limit ? round2(limit - balance) : null, terms: party ? `${party.terms} days` : "", utilisation: limit ? round2((balance / limit) * 100) : null },
                { drill: drill.report(`${p}-statement`, { [cfg.filterKey]: String(id), dateTo: asAt }) },
              ),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((x) => x.r);
        const total = sum(ids, (id) => balances.get(id) ?? 0);
        rows.push(totalRow({ name: `Total — ${ids.length} ${cfg.parties.toLowerCase()}`, balance: total }));
        const control = await withControlCheck(ctx, cfg, total, asAt, partyId !== null);
        return {
          subtitle: asAtLabel(asAt),
          summary: [summaryMoney("Total Balance", total), summaryCount(`${cfg.parties} with a balance`, ids.length)],
          sections: [
            section(
              [col("code", "Code"), col("name", cfg.party), col("balance", "Balance", "money"), col("limit", cfg.limitLabel, "money"), col("available", "Available", "money"), col("terms", "Terms"), col("utilisation", "Utilisation", "percent")],
              rows,
              undefined,
              `No ${L} balances as at this date.`,
            ),
          ],
          checks: control.checks,
          notices: [...notices, ...control.notices],
        };
      },
    },
    {
      id: `${p}-aging`,
      title: `${cfg.party} Aging`,
      description: `Outstanding balances by how long they are overdue, reconciled to the ${cfg.control} control account.`,
      categories: [cfg.category],
      filters: [F.asAt, partyFilter],
      async build(ctx) {
        const { asAt } = ctx.filters;
        const partyId = numberFilter(ctx.filters[cfg.filterKey]);
        const [parties, { entries, notices }, items] = await Promise.all([loadParties(ctx, cfg), loadLedger(ctx, cfg, asAt), loadOpenItems(ctx, cfg, asAt)]);
        const aging = agingOf(ctx, cfg, entries, items, asAt, partyId);
        const labelled = aging.map((a) => ({ a, ...partyLabel(parties, cfg, a.partyId) })).sort((x, y) => x.name.localeCompare(y.name));
        const rows = labelled.map(({ a, code, name }) =>
          row({ code, name, current: a.current, days30: a.days30, days60: a.days60, days90: a.days90, days120Plus: a.days120Plus, unallocated: a.unallocated, balance: a.balance }, { drill: drill.report(`${p}-aging-detail`, { [cfg.filterKey]: String(a.partyId), asAt }) }),
        );
        const t = (k: "current" | "days30" | "days60" | "days90" | "days120Plus" | "unallocated" | "balance") => sum(aging, (a) => a[k]);
        rows.push(totalRow({ name: "Total", current: t("current"), days30: t("days30"), days60: t("days60"), days90: t("days90"), days120Plus: t("days120Plus"), unallocated: t("unallocated"), balance: t("balance") }));
        const control = await withControlCheck(ctx, cfg, t("balance"), asAt, partyId !== null);
        return {
          subtitle: asAtLabel(asAt),
          summary: [summaryMoney("Total Outstanding", t("balance")), summaryMoney("Current", t("current")), summaryMoney("Overdue", round2(t("days30") + t("days60") + t("days90") + t("days120Plus"))), summaryMoney("Unallocated", t("unallocated"))],
          sections: [
            section(
              [col("code", "Code"), col("name", cfg.party), ...AGING_BUCKETS.map((b) => col(b.key, b.label, "money")), col("unallocated", "Unallocated", "money"), col("balance", "Balance", "money")],
              rows,
              undefined,
              `Nothing outstanding as at this date.`,
            ),
          ],
          checks: [check("Aging buckets add up to the ledger balance", t("balance"), round2(t("current") + t("days30") + t("days60") + t("days90") + t("days120Plus") + t("unallocated"))), ...control.checks],
          notices: [
            ...notices,
            ...control.notices,
            `Buckets age each open document by its due date. "Unallocated" holds amounts on the account that are not applied to a specific document — for example bank-posted ${cfg.paymentsLabel.toLowerCase()} settled against the ${cfg.control} account, unapplied credit notes, or opening balances.`,
          ],
        };
      },
    },
    {
      id: `${p}-aging-detail`,
      title: `${cfg.party} Aging Detail`,
      description: `Every open ${cfg.documentLabel.toLowerCase()} and credit by due date and days overdue.`,
      categories: [cfg.category],
      filters: [F.asAt, partyFilter],
      async build(ctx) {
        const { asAt } = ctx.filters;
        const partyId = numberFilter(ctx.filters[cfg.filterKey]);
        const [parties, { entries, notices }, items] = await Promise.all([loadParties(ctx, cfg), loadLedger(ctx, cfg, asAt), loadOpenItems(ctx, cfg, asAt)]);
        const aging = agingOf(ctx, cfg, entries, items, asAt, partyId);
        const rows: ReportRow[] = [];
        for (const { a, name, code } of aging.map((a) => ({ a, ...partyLabel(parties, cfg, a.partyId) })).sort((x, y) => x.name.localeCompare(y.name))) {
          rows.push(groupRow({ date: code, type: name }));
          for (const item of items.filter((i) => i.partyId === a.partyId).sort((x, y) => (x.date < y.date ? -1 : 1))) {
            rows.push(
              row(
                { date: item.date, type: item.type, reference: item.reference, dueDate: item.dueDate, days: daysOverdue(item.dueDate, asAt), bucket: AGING_BUCKETS.find((b) => b.key === bucketFor(item.dueDate, asAt))?.label ?? "", outstanding: item.outstanding },
                { level: 1, drill: drill.document(item.docType, item.docId) },
              ),
            );
          }
          if (a.unallocated !== 0) rows.push(row({ type: "Unallocated", reference: `Not applied to a ${cfg.documentLabel.toLowerCase()}`, outstanding: a.unallocated }, { level: 1 }));
          rows.push(subtotalRow({ reference: `Balance — ${name}`, outstanding: a.balance }));
        }
        const total = sum(aging, (a) => a.balance);
        rows.push(totalRow({ reference: "Total outstanding", outstanding: total }));
        const control = await withControlCheck(ctx, cfg, total, asAt, partyId !== null);
        return {
          subtitle: asAtLabel(asAt),
          summary: [summaryMoney("Total Outstanding", total), summaryCount("Open documents", items.filter((i) => partyId === null || i.partyId === partyId).length)],
          sections: [
            section(
              [col("date", "Date", "date"), col("type", "Type", "badge"), col("reference", "Reference"), col("dueDate", "Due", "date"), col("days", "Days Overdue", "number"), col("bucket", "Bucket"), col("outstanding", "Outstanding", "money")],
              rows,
              undefined,
              "Nothing outstanding as at this date.",
            ),
          ],
          checks: control.checks,
          notices: [...notices, ...control.notices],
        };
      },
    },
    {
      id: `${p}-transactions`,
      title: `${cfg.party} Transactions`,
      description: `Every posted ${L} transaction in the period — documents, ${cfg.paymentsLabel.toLowerCase()}, bank settlements and opening balances.`,
      categories: [cfg.category],
      filters: [...F.period, partyFilter, F.documentType(p === "customer" ? ["Invoice", "Credit Note", "Debit Note", "Receipt", "Bank Receipt", "Customer Refund", "Opening Balance"] : ["Bill", "Credit Note", "Debit Note", "Payment", "Bank Payment", "Supplier Refund", "Opening Balance"])],
      async build(ctx) {
        const { dateFrom, dateTo, documentType } = ctx.filters;
        const partyId = numberFilter(ctx.filters[cfg.filterKey]);
        const [parties, { entries, notices }] = await Promise.all([loadParties(ctx, cfg), loadLedger(ctx, cfg, dateTo)]);
        const list = entries.filter((e) => inRange(e.date, dateFrom, dateTo) && (partyId === null || e.partyId === partyId) && (!documentType || e.type === documentType));
        const rows = list.map((e) => {
          const dc = debitCredit(cfg, e.amount);
          return row({ date: e.date, party: partyLabel(parties, cfg, e.partyId).name, type: e.type, reference: e.reference, description: e.description, debit: dc.debit, credit: dc.credit }, { drill: entryDrill(e) });
        });
        const totalDebit = sum(list, (e) => debitCredit(cfg, e.amount).debit ?? 0);
        const totalCredit = sum(list, (e) => debitCredit(cfg, e.amount).credit ?? 0);
        rows.push(totalRow({ description: `${list.length} transactions`, debit: totalDebit, credit: totalCredit }));
        return {
          subtitle: periodLabel(dateFrom, dateTo),
          summary: [summaryCount("Transactions", list.length), summaryMoney("Debits", totalDebit), summaryMoney("Credits", totalCredit)],
          sections: [section([col("date", "Date", "date"), col("party", cfg.party), col("type", "Type", "badge"), col("reference", "Reference"), col("description", "Description"), col("debit", "Debit", "money"), col("credit", "Credit", "money")], rows, undefined, "No transactions in this period.")],
          checks: [],
          notices,
        };
      },
    },
    {
      id: `${p}-outstanding-balances`,
      title: p === "customer" ? "Customer Outstanding Balances" : "Supplier Outstanding Balances",
      description: `${cfg.parties} with a balance, largest first, with the overdue portion and the oldest overdue item.`,
      categories: [cfg.category],
      filters: [F.asAt],
      async build(ctx) {
        const { asAt } = ctx.filters;
        const [parties, { entries, notices }, items] = await Promise.all([loadParties(ctx, cfg), loadLedger(ctx, cfg, asAt), loadOpenItems(ctx, cfg, asAt)]);
        const aging = agingOf(ctx, cfg, entries, items, asAt, null).filter((a) => a.balance !== 0);
        const rows = aging
          .sort((a, b) => b.balance - a.balance)
          .map((a) => {
            const oldest = items.filter((i) => i.partyId === a.partyId && i.outstanding > 0).reduce((m, i) => Math.max(m, daysOverdue(i.dueDate, asAt)), 0);
            const label = partyLabel(parties, cfg, a.partyId);
            return row(
              { code: label.code, name: label.name, balance: a.balance, overdue: round2(a.days30 + a.days60 + a.days90 + a.days120Plus), oldest, openDocs: items.filter((i) => i.partyId === a.partyId).length },
              { drill: drill.report(`${p}-statement`, { [cfg.filterKey]: String(a.partyId), dateTo: asAt }) },
            );
          });
        const total = sum(aging, (a) => a.balance);
        const overdue = sum(aging, (a) => a.days30 + a.days60 + a.days90 + a.days120Plus);
        rows.push(totalRow({ name: "Total", balance: total, overdue }));
        const control = await controlAccountCheck(ctx, p, total, asAt);
        return {
          subtitle: asAtLabel(asAt),
          summary: [summaryMoney("Total Outstanding", total), summaryMoney("Overdue", overdue), summaryCount(`${cfg.parties} with a balance`, aging.length)],
          sections: [section([col("code", "Code"), col("name", cfg.party), col("balance", "Balance", "money"), col("overdue", "Overdue", "money"), col("oldest", "Oldest Overdue (days)", "number"), col("openDocs", "Open Documents", "number")], rows, undefined, "Nothing outstanding.")],
          checks: control.checks,
          notices: [...notices, ...control.notices],
        };
      },
    },
    {
      id: `${p}-payment-history`,
      title: `${cfg.party} Payment History`,
      description: `Every ${cfg.paymentLabel.toLowerCase()} in the period — recorded ${cfg.paymentsLabel.toLowerCase()} and bank transactions settled against the account — and what each one paid.`,
      categories: [cfg.category],
      filters: [...F.period, partyFilter],
      async build(ctx) {
        const { dateFrom, dateTo } = ctx.filters;
        const partyId = numberFilter(ctx.filters[cfg.filterKey]);
        const [parties, { entries, notices }] = await Promise.all([loadParties(ctx, cfg), loadLedger(ctx, cfg, dateTo)]);
        const docRef = new Map<number, { ref: string; date: string }>();
        const allocationsByPayment = new Map<number, { docId: number; amount: number }[]>();
        const bankBill = new Map<number, number>();
        if (p === "customer") {
          const [invoices, receipts] = await Promise.all([ctx.source.salesInvoices(), ctx.source.customerReceipts()]);
          for (const i of invoices) docRef.set(i.id, { ref: i.invoiceNumber, date: i.invoiceDate });
          for (const r of receipts) allocationsByPayment.set(r.id, r.allocations.map((a) => ({ docId: a.invoiceId, amount: a.amountAllocated })));
        } else {
          const [bills, payments, bank] = await Promise.all([ctx.source.bills(), ctx.source.supplierPayments(), ctx.source.bankTransactions({ from: dateFrom, to: dateTo })]);
          for (const b of bills) docRef.set(b.id, { ref: b.invoiceNumber, date: b.invoiceDate ?? "" });
          for (const pay of payments) allocationsByPayment.set(pay.id, pay.allocations.map((a) => ({ docId: a.billId, amount: a.amountAllocated })));
          for (const t of bank.items) if (t.matchedBillId !== null) bankBill.set(t.id, t.matchedBillId);
        }
        const list = entries.filter((e) => (e.source === "payment" || e.source === "bank") && inRange(e.date, dateFrom, dateTo) && (partyId === null || e.partyId === partyId));
        const daysToPay: number[] = [];
        const rows = list.map((e) => {
          let allocatedTo = "";
          if (e.source === "payment" && e.docId !== null) {
            const allocs = allocationsByPayment.get(e.docId) ?? [];
            allocatedTo = allocs.map((a) => docRef.get(a.docId)?.ref ?? `#${a.docId}`).join(", ");
            for (const a of allocs) {
              const d = docRef.get(a.docId)?.date;
              if (d) daysToPay.push(Math.max(0, Math.round((Date.parse(e.date) - Date.parse(d)) / 86_400_000)));
            }
          } else if (e.bankTransactionId !== null && bankBill.has(e.bankTransactionId)) {
            const billId = bankBill.get(e.bankTransactionId)!;
            allocatedTo = docRef.get(billId)?.ref ?? `#${billId}`;
          } else if (e.source === "bank") {
            allocatedTo = `Settled against the ${cfg.control} account`;
          }
          return row({ date: e.date, party: partyLabel(parties, cfg, e.partyId).name, type: e.type, reference: e.reference, amount: round2(-e.amount), allocatedTo }, { drill: entryDrill(e) });
        });
        const total = sum(list, (e) => -e.amount);
        rows.push(totalRow({ reference: `${list.length} ${cfg.paymentsLabel.toLowerCase()}`, amount: total }));
        const avg = daysToPay.length ? Math.round(daysToPay.reduce((a, b) => a + b, 0) / daysToPay.length) : null;
        return {
          subtitle: periodLabel(dateFrom, dateTo),
          summary: [summaryMoney(`Total ${cfg.paymentsLabel}`, total), summaryCount(cfg.paymentsLabel, list.length), ...(avg !== null ? [summaryCount("Average days to pay (allocated)", avg)] : [])],
          sections: [section([col("date", "Date", "date"), col("party", cfg.party), col("type", "Source", "badge"), col("reference", "Reference"), col("amount", "Amount", "money"), col("allocatedTo", "Paid Against")], rows, undefined, `No ${cfg.paymentsLabel.toLowerCase()} in this period.`)],
          checks: [],
          notices: [...notices, "Refunds appear as negative amounts."],
        };
      },
    },
    {
      id: `${p}-credit-notes`,
      title: `${cfg.party} Credit Notes`,
      description: `Register of ${L} credit notes in the period.`,
      categories: [cfg.category, cfg.side === "customer" ? "sales" : "purchasing"],
      filters: [...F.period, partyFilter],
      build: (ctx) => documentRegister(ctx, cfg, ["Credit Note"], `${cfg.party} Credit Notes`),
    },
    {
      id: p === "customer" ? "customer-invoice-register" : "supplier-bill-register",
      title: p === "customer" ? "Customer Invoice Register" : "Supplier Bill Register",
      description: `Every ${cfg.documentLabel.toLowerCase()} and debit note in the period with net, VAT, total, outstanding and status.`,
      categories: [cfg.category, cfg.side === "customer" ? "sales" : "purchasing"],
      filters: [...F.period, partyFilter, F.status(p === "customer" ? ["Draft", "Submitted", "Approved", "Posted", "Cancelled"] : ["Draft", "Submitted", "Approved", "Posted", "Cancelled", "Open"])],
      build: (ctx) => documentRegister(ctx, cfg, cfg.documentTypes, cfg.documentsLabel),
    },
    {
      id: p === "customer" ? "customer-receipt-register" : "supplier-payment-register",
      title: p === "customer" ? "Customer Receipt Register" : "Supplier Payment Register",
      description: `Every ${cfg.paymentLabel.toLowerCase()} in the period with its allocated and unallocated amounts, including bank transactions settled against the account.`,
      categories: [cfg.category, "banking"],
      filters: [...F.period, partyFilter],
      async build(ctx) {
        const { dateFrom, dateTo } = ctx.filters;
        const partyId = numberFilter(ctx.filters[cfg.filterKey]);
        const [parties, bank] = await Promise.all([loadParties(ctx, cfg), ctx.source.bankTransactions({ from: dateFrom, to: dateTo })]);
        type Line = { date: string; partyId: number; number: string; source: string; amount: number; allocated: number | null; status: string; drill?: DrillTarget };
        const lines: Line[] = [];
        if (p === "customer") {
          for (const r of await ctx.source.customerReceipts()) {
            if (!inRange(r.receiptDate, dateFrom, dateTo)) continue;
            lines.push({ date: r.receiptDate, partyId: r.customerId, number: r.receiptNumber || r.reference, source: "Receipt", amount: r.amount, allocated: sum(r.allocations, (a) => a.amountAllocated), status: r.status, drill: drill.document("customer-receipt", r.id) });
          }
        } else {
          for (const pay of await ctx.source.supplierPayments()) {
            if (!inRange(pay.paymentDate, dateFrom, dateTo)) continue;
            lines.push({ date: pay.paymentDate, partyId: pay.supplierId, number: pay.paymentNumber || pay.reference, source: "Payment", amount: pay.amount, allocated: sum(pay.allocations, (a) => a.amountAllocated), status: pay.status, drill: drill.document("supplier-payment", pay.id) });
          }
        }
        for (const t of bank.items) {
          const id = p === "customer" ? (t.allocationType === "C" ? t.matchedCustomerId : null) : t.allocationType === "S" ? t.matchedSupplierId : null;
          if (id === null || !t.transactionDate) continue;
          const amount = p === "customer" ? round2(t.credit - t.debit) : round2(t.debit - t.credit);
          lines.push({ date: t.transactionDate, partyId: id, number: t.reference || t.description, source: "Bank", amount, allocated: null, status: t.postedFlag ? "Posted" : "Not yet posted", drill: drill.bank(t.id) });
        }
        const scoped = lines.filter((l) => partyId === null || l.partyId === partyId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const rows = scoped.map((l) =>
          row({ date: l.date, number: l.number, party: partyLabel(parties, cfg, l.partyId).name, source: l.source, amount: l.amount, allocated: l.allocated, unallocated: l.allocated === null ? null : round2(l.amount - l.allocated), status: l.status }, { drill: l.drill }),
        );
        const posted = scoped.filter((l) => l.status === "Posted");
        rows.push(totalRow({ number: `${scoped.length} ${cfg.paymentsLabel.toLowerCase()}`, amount: sum(scoped, (l) => l.amount) }));
        return {
          subtitle: periodLabel(dateFrom, dateTo),
          summary: [summaryMoney(`Total ${cfg.paymentsLabel}`, sum(scoped, (l) => l.amount)), summaryMoney("Posted", sum(posted, (l) => l.amount)), summaryCount(cfg.paymentsLabel, scoped.length)],
          sections: [section([col("date", "Date", "date"), col("number", "Number / Reference"), col("party", cfg.party), col("source", "Source", "badge"), col("amount", "Amount", "money"), col("allocated", "Allocated", "money"), col("unallocated", "Unallocated", "money"), col("status", "Status", "badge")], rows, undefined, `No ${cfg.paymentsLabel.toLowerCase()} in this period.`)],
          checks: [],
          notices: [`Bank rows are bank transactions allocated to a ${L}; they settle the ${cfg.control} account as a whole rather than a specific document, so they carry no allocation split.`],
        };
      },
    },
    {
      id: `${p}-activity`,
      title: `${cfg.party} Activity`,
      description: `A timeline of everything that happened with a ${L}: ${p === "customer" ? "quotes, orders" : "purchase orders"}, documents, ${cfg.paymentsLabel.toLowerCase()} and bank settlements.`,
      categories: [cfg.category],
      filters: [...F.period, partyFilter],
      async build(ctx) {
        const { dateFrom, dateTo } = ctx.filters;
        const partyId = numberFilter(ctx.filters[cfg.filterKey]);
        const [parties, { entries, notices }] = await Promise.all([loadParties(ctx, cfg), loadLedger(ctx, cfg, dateTo)]);
        type Event = { date: string; partyId: number; event: string; reference: string; amount: number | null; status: string; drill?: DrillTarget };
        const events: Event[] = entries
          .filter((e) => inRange(e.date, dateFrom, dateTo))
          .map((e) => ({ date: e.date, partyId: e.partyId, event: e.type, reference: e.reference, amount: Math.abs(e.amount), status: "Posted", drill: entryDrill(e) }));
        if (p === "customer") {
          const [quotes, orders] = await Promise.all([ctx.source.quotations(), ctx.source.salesOrders()]);
          for (const q of quotes) if (inRange(q.quotationDate, dateFrom, dateTo)) events.push({ date: q.quotationDate, partyId: q.customerId, event: "Quotation", reference: q.quotationNumber, amount: sum(q.lines, (l) => l.lineTotal + l.vatAmount), status: q.status, drill: drill.document("quotation", q.id) });
          for (const o of orders) if (inRange(o.orderDate, dateFrom, dateTo)) events.push({ date: o.orderDate, partyId: o.customerId, event: "Sales Order", reference: o.orderNumber, amount: sum(o.lines, (l) => l.netAmount + l.vatAmount), status: o.status, drill: drill.document("sales-order", o.id) });
        } else {
          for (const o of await ctx.source.purchaseOrders()) if (inRange(o.orderDate, dateFrom, dateTo)) events.push({ date: o.orderDate, partyId: o.supplierId, event: "Purchase Order", reference: o.orderNumber, amount: sum(o.lines, (l) => l.netAmount + l.vatAmount), status: o.status, drill: drill.document("purchase-order", o.id) });
        }
        const scoped = events.filter((e) => partyId === null || e.partyId === partyId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        return {
          subtitle: periodLabel(dateFrom, dateTo),
          summary: [summaryCount("Events", scoped.length)],
          sections: [section([col("date", "Date", "date"), col("party", cfg.party), col("event", "Event", "badge"), col("reference", "Reference"), col("amount", "Amount", "money"), col("status", "Status", "badge")], scoped.map((e) => row({ date: e.date, party: partyLabel(parties, cfg, e.partyId).name, event: e.event, reference: e.reference, amount: e.amount, status: e.status }, { drill: e.drill })), undefined, "No activity in this period.")],
          checks: [],
          notices,
        };
      },
    },
    {
      id: `${p}-vat-analysis`,
      title: `${cfg.party} VAT Analysis`,
      description: `Net, VAT and gross on posted ${L} documents by ${L} and VAT treatment, reconciled to the VAT ${p === "customer" ? "Output" : "Input"} account.`,
      categories: [cfg.category, "vat"],
      filters: [...F.period, partyFilter],
      async build(ctx) {
        const { dateFrom, dateTo } = ctx.filters;
        const partyId = numberFilter(ctx.filters[cfg.filterKey]);
        const [parties, { entries, notices }] = await Promise.all([loadParties(ctx, cfg), loadLedger(ctx, cfg, dateTo)]);
        const docs = entries.filter((e) => e.source === "document" && inRange(e.date, dateFrom, dateTo) && (partyId === null || e.partyId === partyId));
        const byParty = new Map<number, Map<string, { net: number; vat: number; gross: number }>>();
        for (const d of docs) {
          const codes = byParty.get(d.partyId) ?? new Map();
          const key = d.vatCode || "No VAT code";
          const t = codes.get(key) ?? { net: 0, vat: 0, gross: 0 };
          t.net = round2(t.net + (d.netAmount ?? 0));
          t.vat = round2(t.vat + (d.vatAmount ?? 0));
          t.gross = round2(t.gross + d.amount);
          codes.set(key, t);
          byParty.set(d.partyId, codes);
        }
        const rows: ReportRow[] = [];
        for (const { id, name } of [...byParty.keys()].map((id) => ({ id, ...partyLabel(parties, cfg, id) })).sort((a, b) => a.name.localeCompare(b.name))) {
          const codes = byParty.get(id)!;
          rows.push(groupRow({ code: name }));
          for (const [code, t] of codes) rows.push(row({ code, net: t.net, vat: t.vat, gross: t.gross }, { level: 1 }));
          rows.push(subtotalRow({ code: `Total — ${name}`, net: sum([...codes.values()], (t) => t.net), vat: sum([...codes.values()], (t) => t.vat), gross: sum([...codes.values()], (t) => t.gross) }));
        }
        const totalVat = sum(docs, (d) => d.vatAmount ?? 0);
        rows.push(totalRow({ code: "Total", net: sum(docs, (d) => d.netAmount ?? 0), vat: totalVat, gross: sum(docs, (d) => d.amount) }));
        const checks: ReconciliationCheck[] = [];
        const extraNotices: string[] = [];
        if (partyId === null) {
          const vatAccount = (await ctx.source.controlAccounts()).vat.find((v) => v.role === (p === "customer" ? "Output" : "Input"));
          if (vatAccount) {
            const gl = await ctx.source.glTransactions({ from: dateFrom, to: dateTo, accountId: vatAccount.accountId });
            const sourceType = p === "customer" ? "sales_invoice" : "purchase_bill";
            const glVat = sum(gl.items.filter((t) => t.sourceType === sourceType), (t) => (p === "customer" ? t.credit - t.debit : t.debit - t.credit));
            checks.push(check(`Document VAT equals ${p === "customer" ? "sales-invoice" : "purchase-bill"} postings to VAT ${vatAccount.role} (${vatAccount.accountCode})`, glVat, totalVat, "A difference usually means a document dated in this period was posted to the ledger in a different period, or a document's VAT was posted to another account."));
          } else {
            extraNotices.push(`No VAT ${p === "customer" ? "Output" : "Input"} account exists in the Chart of Accounts to reconcile against.`);
          }
        }
        return {
          subtitle: periodLabel(dateFrom, dateTo),
          summary: [summaryMoney("Net", sum(docs, (d) => d.netAmount ?? 0)), summaryMoney("VAT", totalVat), summaryMoney("Gross", sum(docs, (d) => d.amount))],
          sections: [section([col("code", "VAT Treatment"), col("net", "Net", "money"), col("vat", "VAT", "money"), col("gross", "Gross", "money")], rows, undefined, "No posted documents in this period.")],
          checks,
          notices: [...notices, ...extraNotices, "Credit notes reduce net, VAT and gross."],
        };
      },
    },
  ];
}

/** Register of Sales/Purchasing documents of the given types, any status. */
async function documentRegister(ctx: ReportContext, cfg: SideConfig, types: string[], label: string) {
  const { dateFrom, dateTo, status } = ctx.filters;
  const partyId = numberFilter(ctx.filters[cfg.filterKey]);
  const parties = await loadParties(ctx, cfg);
  type Doc = { id: number; date: string; number: string; type: string; partyId: number; due: string | null; net: number; vat: number; total: number; outstanding: number; status: string; posted: boolean; docType: "sales-invoice" | "purchase-bill" };
  const docs: Doc[] = [];
  if (cfg.side === "customer") {
    for (const i of await ctx.source.salesInvoices()) {
      docs.push({ id: i.id, date: i.invoiceDate, number: i.invoiceNumber, type: i.documentType, partyId: i.customerId, due: i.dueDate, net: i.subtotal, vat: i.vatAmount, total: i.total, outstanding: i.outstanding, status: i.status, posted: i.status === "Posted", docType: "sales-invoice" });
    }
  } else {
    for (const b of await ctx.source.bills()) {
      if (b.supplierId === null || !b.invoiceDate) continue;
      docs.push({ id: b.id, date: b.invoiceDate, number: b.invoiceNumber, type: b.documentType, partyId: b.supplierId, due: b.dueDate, net: round2(b.total - b.vat), vat: b.vat, total: b.total, outstanding: b.outstanding, status: b.postingStatus ?? b.status, posted: isPostedBill(b), docType: "purchase-bill" });
    }
  }
  const scoped = docs
    .filter((d) => types.includes(d.type) && inRange(d.date, dateFrom, dateTo) && (partyId === null || d.partyId === partyId) && (!status || d.status === status))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number.localeCompare(b.number)));
  const rows = scoped.map((d) =>
    row({ date: d.date, number: d.number, type: d.type, party: partyLabel(parties, cfg, d.partyId).name, due: d.due, net: d.net, vat: d.vat, total: d.total, outstanding: d.outstanding, status: d.status }, { drill: drill.document(d.docType, d.id) }),
  );
  rows.push(totalRow({ number: `${scoped.length} documents`, net: sum(scoped, (d) => d.net), vat: sum(scoped, (d) => d.vat), total: sum(scoped, (d) => d.total), outstanding: sum(scoped, (d) => d.outstanding) }));
  const posted = scoped.filter((d) => d.posted);
  return {
    subtitle: periodLabel(dateFrom, dateTo),
    summary: [summaryCount(label, scoped.length), summaryMoney("Total", sum(scoped, (d) => d.total)), summaryMoney("Posted", sum(posted, (d) => d.total)), summaryMoney("Outstanding", sum(scoped, (d) => d.outstanding))],
    sections: [
      section(
        [col("date", "Date", "date"), col("number", "Number"), col("type", "Type", "badge"), col("party", cfg.party), col("due", "Due", "date"), col("net", "Net", "money"), col("vat", "VAT", "money"), col("total", "Total", "money"), col("outstanding", "Outstanding", "money"), col("status", "Status", "badge")],
        rows,
        undefined,
        "No documents in this period.",
      ),
    ],
    checks: [check("Net + VAT = Total", sum(scoped, (d) => d.total), round2(sum(scoped, (d) => d.net) + sum(scoped, (d) => d.vat)))],
    notices: scoped.some((d) => !d.posted) ? ["Includes documents that are not posted; only Posted documents affect the ledger."] : [],
  };
}

export const CUSTOMER_REPORTS = partyReports(CUSTOMER);
export const SUPPLIER_REPORTS = partyReports(SUPPLIER);

/** Exposed for the Management pack's receivables/payables figures. */
export async function partyLedgerTotals(ctx: ReportContext, side: PartySide, asAt: string) {
  const cfg = side === "customer" ? CUSTOMER : SUPPLIER;
  const [{ entries }, items] = await Promise.all([loadLedger(ctx, cfg, asAt), loadOpenItems(ctx, cfg, asAt)]);
  const aging = buildAging(entries, items, asAt);
  return {
    balance: sum(aging, (a) => a.balance),
    overdue: sum(aging, (a) => a.days30 + a.days60 + a.days90 + a.days120Plus),
    aging,
  };
}

