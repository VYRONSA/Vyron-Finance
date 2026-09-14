/**
 * Every Reporting Centre calculation, tested against the hand-worked
 * fixture ledger in `test-fixtures.ts`. The figures in these assertions
 * are derived from the journal table at the top of that file — not read
 * back from the code under test.
 */

import { describe, expect, it } from "vitest";
import { runReport } from "./run";
import { REPORTS, REPORT_BY_ID } from "./registry";
import { fixtureSource, TODAY } from "./test-fixtures";
import { memoizeSource, createInMemorySource } from "./source";
import { reportToCsv, reportToWorkbook } from "./export";
import { REPORT_CATEGORIES, ReportInputError, type ReportFilters, type ReportResult, type ReportRow } from "./types";

async function run(reportId: string, filters: ReportFilters = {}) {
  return (await runReport(fixtureSource(), reportId, filters, TODAY)).result;
}

function totalRow(result: ReportResult, sectionIndex = 0): ReportRow {
  const row = result.sections[sectionIndex].rows.find((r) => r.kind === "total");
  if (!row) throw new Error("no total row");
  return row;
}

function rowWhere(result: ReportResult, key: string, value: string, sectionIndex = 0): ReportRow {
  const row = result.sections[sectionIndex].rows.find((r) => r.cells[key] === value);
  if (!row) throw new Error(`no row with ${key}=${value}`);
  return row;
}

function allChecksPass(result: ReportResult) {
  for (const c of result.checks) expect(c.passed, `${result.reportId}: ${c.label} (expected ${c.expected}, actual ${c.actual})`).toBe(true);
}

describe("Report engine — defaults, validation, catalogue", () => {
  it("defaults the period to the financial year containing today", async () => {
    const { filters } = await runReport(fixtureSource(), "profit-and-loss", {}, TODAY);
    expect(filters.dateFrom).toBe("2026-03-01");
    expect(filters.dateTo).toBe(TODAY);
    expect(filters.asAt).toBe(TODAY);
  });

  it("rejects malformed dates and an inverted range", async () => {
    await expect(runReport(fixtureSource(), "profit-and-loss", { dateFrom: "31/07/2026" }, TODAY)).rejects.toBeInstanceOf(ReportInputError);
    await expect(runReport(fixtureSource(), "profit-and-loss", { dateFrom: "2026-08-01", dateTo: "2026-07-01" }, TODAY)).rejects.toBeInstanceOf(ReportInputError);
  });

  it("asks for a required filter instead of producing an empty report", async () => {
    await expect(runReport(fixtureSource(), "customer-statement", {}, TODAY)).rejects.toThrow(/choose a customer/i);
  });

  it("has unique report ids, and every category has reports", () => {
    expect(REPORT_BY_ID.size).toBe(REPORTS.length);
    for (const category of REPORT_CATEGORIES) expect(REPORTS.some((r) => r.categories.includes(category)), category).toBe(true);
  });

  it("memoizes each distinct read once per run", async () => {
    let calls = 0;
    const base = fixtureSource();
    const counted = { ...base, trialBalance: (asOf: string | null) => { calls++; return base.trialBalance(asOf); } };
    const memo = memoizeSource(counted);
    await Promise.all([memo.trialBalance(TODAY), memo.trialBalance(TODAY), memo.trialBalance("2026-03-31")]);
    expect(calls).toBe(2);
  });
});

describe("Every report runs and every reconciliation holds on a coherent ledger", () => {
  const REQUIRED: ReportFilters = { customerId: "1", supplierId: "1", accountId: "2", journalId: "2", bankAccountId: "1", transactionId: "101", reconciliationId: "1" };
  it.each(REPORTS.map((r) => [r.id]))("%s", async (id) => {
    const def = REPORT_BY_ID.get(id)!;
    const filters: ReportFilters = {};
    for (const spec of def.filters) if (spec.required) filters[spec.key] = REQUIRED[spec.key];
    const result = await run(id, filters);
    expect(result.title).toBe(def.title);
    expect(result.sections.length).toBeGreaterThan(0);
    allChecksPass(result);
    for (const s of result.sections) {
      for (const r of s.rows) {
        for (const target of [r.drill, ...Object.values(r.cellDrills ?? {})]) {
          if (target?.kind === "report") expect(REPORT_BY_ID.has(target.reportId), `${id} drills to unknown report ${target.reportId}`).toBe(true);
        }
      }
    }
  });
});

describe("Trial Balance & General Ledger", () => {
  it("Trial Balance balances at 14,420 and groups by account type", async () => {
    const tb = await run("trial-balance");
    expect(totalRow(tb).cells).toMatchObject({ debit: 14420, credit: 14420 });
    expect(rowWhere(tb, "code", "1000").cells).toMatchObject({ debit: 10935 });
    expect(rowWhere(tb, "code", "2200").cells).toMatchObject({ credit: 420 });
    expect(rowWhere(tb, "code", "1000").drill).toEqual({ kind: "report", reportId: "gl-account-activity", filters: { accountId: "1", dateFrom: "2026-03-01", dateTo: TODAY } });
  });

  it("the draft journal never reaches the ledger", async () => {
    const tb = await run("trial-balance");
    expect(tb.sections[0].rows.some((r) => r.cells.code === "6300")).toBe(false);
    const unposted = await run("unposted-journals");
    expect(unposted.sections[0].rows.filter((r) => r.kind === "detail")).toHaveLength(1);
    const posted = await run("posted-journals");
    expect(posted.sections[0].rows.filter((r) => r.kind === "detail")).toHaveLength(11);
  });

  it("GL Account Activity for Debtors runs to the control balance", async () => {
    const r = await run("gl-account-activity", { accountId: "2" });
    expect(totalRow(r).cells.balance).toBe(2220);
    expect(r.sections[0].rows.find((x) => x.cells.journal === "JR000002")?.drill).toEqual({ kind: "journal", journalId: 2 });
  });

  it("Journal Detail traces a sales-invoice journal to its source document and its GL lines", async () => {
    const r = await run("journal-detail", { journalId: "2" });
    const trace = r.sections.find((s) => s.title === "Source & Traceability")!;
    expect(trace.rows[0].drill).toEqual({ kind: "document", docType: "sales-invoice", id: 1 });
    const postings = r.sections.find((s) => s.title === "General Ledger Postings")!;
    expect(postings.rows).toHaveLength(3);
  });

  it("Journal Detail of a bank posting links back to the bank transaction", async () => {
    const r = await run("journal-detail", { journalId: "6" });
    const trace = r.sections.find((s) => s.title === "Source & Traceability")!;
    expect(trace.rows.map((x) => x.drill)).toContainEqual({ kind: "bank-transaction", transactionId: 101 });
  });
});

describe("Financial statements", () => {
  it("Profit & Loss: revenue 2,800, gross profit 1,800, net profit 1,750 — and it agrees with the GL lines", async () => {
    const r = await run("detailed-profit-and-loss");
    expect(rowWhere(r, "label", "Gross Profit").cells.amount).toBe(1800);
    expect(totalRow(r).cells.amount).toBe(1750);
    expect(r.checks[0]).toMatchObject({ expected: 1750, actual: 1750, passed: true });
  });

  it("Statement of Financial Position balances at 13,305 with current-year earnings in equity", async () => {
    const r = await run("balance-sheet");
    const totals = r.sections[0].rows.filter((x) => x.kind === "total");
    expect(totals.map((t) => t.cells.current)).toEqual([13305, 13305]);
    expect(rowWhere(r, "label", "Current Year Earnings").cells.current).toBe(1750);
  });

  it("Monthly P&L months add up to the period", async () => {
    const r = await run("monthly-profit-and-loss");
    expect(totalRow(r).cells.total).toBe(1750);
    expect(totalRow(r).cells["2026-06"]).toBe(-50); // bank charges 100 less interest 50
  });

  it("Budget vs Actual uses only captured budgets", async () => {
    const r = await run("budget-vs-actual");
    expect(rowWhere(r, "code", "4000").cells).toMatchObject({ budget: 10000, actual: 2800, variance: -7200 });
    const none = (await runReport(fixtureSource({ budgets: [] }), "budget-vs-actual", {}, TODAY)).result;
    expect(none.sections[0].rows).toHaveLength(0);
    expect(none.sections[0].emptyMessage).toMatch(/No budget has been captured/);
  });
});

describe("Customers — ledger, statement, aging reconcile to Debtors", () => {
  it("Customer Ledger closes at 2,220 = Debtors control", async () => {
    const r = await run("customer-ledger");
    expect(totalRow(r).cells).toMatchObject({ opening: 0, increase: 4600, decrease: 2380, closing: 2220 });
    expect(r.checks.map((c) => c.passed)).toEqual([true, true, true]);
  });

  it("includes bank-posted customer receipts (type C) that have no receipt record", async () => {
    const r = await run("customer-detailed-ledger", { customerId: "2" });
    const bankRow = r.sections[0].rows.find((x) => x.cells.type === "Bank Receipt")!;
    expect(bankRow.cells.credit).toBe(1000);
    expect(bankRow.drill).toEqual({ kind: "bank-transaction", transactionId: 101 });
  });

  it("Customer Statement: opening 1,150, closing 920, agrees with its aging", async () => {
    const r = await run("customer-statement", { customerId: "1", dateFrom: "2026-04-01" });
    expect(r.summary.find((s) => s.label === "Opening Balance")?.value).toBe(1150);
    expect(totalRow(r).cells.balance).toBe(920);
    allChecksPass(r);
  });

  it("Customer Aging puts the unapplied bank receipt in Unallocated so rows equal the ledger", async () => {
    const r = await run("customer-aging");
    expect(rowWhere(r, "name", "Bayside Clinic").cells).toMatchObject({ days60: 2300, unallocated: -1000, balance: 1300 });
    expect(totalRow(r).cells.balance).toBe(2220);
    allChecksPass(r);
  });

  it("historical aging reconstructs outstanding from allocations dated on/before the date", async () => {
    const r = await run("customer-aging-detail", { asAt: "2026-05-10" });
    // On 10 May INV001 was still wholly unpaid (the receipt is dated 15 May).
    expect(r.sections[0].rows.find((x) => x.cells.reference === "INV001")?.cells.outstanding).toBe(1150);
  });

  it("excludes draft documents from the ledger but lists them in the register", async () => {
    const register = await run("customer-invoice-register");
    expect(register.sections[0].rows.some((x) => x.cells.number === "INV003")).toBe(true);
    const ledger = await run("customer-transactions");
    expect(ledger.sections[0].rows.some((x) => x.cells.reference === "INV003")).toBe(false);
  });

  it("Customer VAT analysis reconciles to VAT Output from sales invoices", async () => {
    const r = await run("customer-vat-analysis");
    expect(totalRow(r).cells).toMatchObject({ net: 2800, vat: 420, gross: 3220 });
    allChecksPass(r);
  });
});

describe("Suppliers — reconcile to Creditors", () => {
  it("Supplier Ledger closes at 575 = Creditors control, including the bank payment", async () => {
    const r = await run("supplier-ledger");
    expect(totalRow(r).cells.closing).toBe(575);
    allChecksPass(r);
    const detail = await run("supplier-detailed-ledger", { supplierId: "1" });
    expect(detail.sections[0].rows.find((x) => x.cells.type === "Bank Payment")?.cells.debit).toBe(575);
  });

  it("Supplier Aging: the half-paid bill is 61–90 days overdue", async () => {
    const r = await run("supplier-aging");
    expect(rowWhere(r, "name", "Northline Supplies").cells).toMatchObject({ days90: 575, unallocated: 0, balance: 575 });
  });

  it("an imported bill that never entered the books is not in the ledger", async () => {
    const r = await run("supplier-balance-summary");
    expect(r.sections[0].rows.some((x) => x.cells.name === "Nova Freight")).toBe(false);
  });

  it("Payment history shows the bank payment settling the matched bill", async () => {
    const r = await run("supplier-payment-history");
    expect(r.sections[0].rows.find((x) => x.cells.type === "Bank Payment")?.cells.allocatedTo).toBe("NL-100");
  });
});

describe("Sales & Purchasing", () => {
  it("Sales by Customer apportions invoice lines exactly and agrees with the GL", async () => {
    const r = await run("sales-by-customer");
    expect(rowWhere(r, "label", "Bayside Clinic").cells.net).toBe(2000);
    expect(rowWhere(r, "label", "Acme Retail").cells.net).toBe(800);
    expect(totalRow(r).cells).toMatchObject({ net: 2800, vat: 420 });
    allChecksPass(r);
  });

  it("Gross margin only where cost data exists (Widget at 120 average cost)", async () => {
    const r = await run("gross-margin");
    expect(rowWhere(r, "label", "W-1 Widget").cells).toMatchObject({ net: 2400, cost: 1440, margin: 960, marginPct: 40 });
    expect(rowWhere(r, "label", "Consulting").cells.cost).toBeNull();
  });

  it("Purchase Summary: net purchases 1,000 agree with purchase-bill postings", async () => {
    const r = await run("purchase-summary");
    expect(totalRow(r).cells.net).toBe(1000);
    allChecksPass(r);
  });

  it("Supplier spend counts billed spend once and adds direct bank spend", async () => {
    const r = await run("supplier-spend");
    expect(rowWhere(r, "supplier", "Northline Supplies").cells).toMatchObject({ billed: 1000, direct: 0, total: 1000 });
  });
});

describe("VAT", () => {
  it("VAT Summary: output 420, input 165 (incl. 15 bank VAT), net 255 — reconciled to the VAT accounts", async () => {
    const r = await run("vat-summary");
    expect(r.summary).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Output VAT", value: 420 }), expect.objectContaining({ label: "Input VAT", value: 165 }), expect.objectContaining({ label: "Net VAT", value: 255 })]));
    expect(r.checks).toHaveLength(2);
    allChecksPass(r);
  });

  it("Input VAT includes the VAT split out of a GL-allocated bank payment, never a supplier settlement", async () => {
    const r = await run("input-vat");
    const bank = r.sections[0].rows.filter((x) => x.cells.source === "Bank Payment");
    expect(bank).toHaveLength(1);
    expect(bank[0].cells).toMatchObject({ vat: 15, net: 100, gross: 115 });
  });

  it("VAT Position equals net VAT for a single-period ledger", async () => {
    const r = await run("vat-position");
    expect(totalRow(r).cells.payable).toBe(255);
  });
});

describe("Banking", () => {
  it("every posted bank transaction reached the bank GL account", async () => {
    const r = await run("bank-gl-reconciliation");
    expect(r.checks[0]).toMatchObject({ expected: 360, actual: 360, passed: true });
  });

  it("the lifecycle counts each transaction once: 2 Unprocessed, 1 Ready, 3 Posted, 1 Reconciled", async () => {
    const r = await run("transaction-lifecycle");
    const current = r.sections[1].rows;
    expect(current.map((x) => [x.cells.stage, x.cells.count])).toEqual([["Unprocessed", 2], ["Ready to Post", 1], ["Posted", 3], ["Reconciled", 1]]);
  });

  it("bank reconciliation: cleared items explain the statement closing balance", async () => {
    const r = await run("bank-reconciliation", { reconciliationId: "1" });
    expect(r.summary.find((s) => s.label === "Reconciled Balance")?.value).toBe(11575);
    allChecksPass(r);
  });

  it("look-alike deposits are grouped, with the source occurrence shown", async () => {
    const r = await run("duplicate-transactions");
    const group = r.sections[1].rows;
    expect(group.filter((x) => x.kind === "group")).toHaveLength(1);
    expect(group.some((x) => String(x.cells.reference).includes("occurrence 2"))).toBe(true);
  });

  it("the bank transaction trace walks import → allocation → posting → reconciliation", async () => {
    const r = await run("bank-transaction-detail", { transactionId: "101" });
    expect(r.sections[0].rows.map((x) => x.cells.done)).toEqual(["✓", "✓", "✓", "✓", "✓"]);
    expect(r.sections[0].rows[3].drill).toEqual({ kind: "journal", journalId: 6 });
  });
});

describe("Management", () => {
  it("Management pack figures tie to the detailed reports", async () => {
    const r = await run("management-pack");
    expect(r.summary).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Net Profit", value: 1750 }), expect.objectContaining({ label: "Cash & Bank", value: 10935 }), expect.objectContaining({ label: "Receivables", value: 2220 }), expect.objectContaining({ label: "Payables", value: 575 })]));
    allChecksPass(r);
  });

  it("shows no budget comparison when no budget exists", async () => {
    const r = (await runReport(fixtureSource({ budgets: [] }), "kpi-comparison", {}, TODAY)).result;
    expect(r.sections[0].rows.every((x) => x.cells.budget === null)).toBe(true);
  });
});

describe("Exports", () => {
  it("CSV carries the header, sections and reconciliation checks", async () => {
    const r = await run("trial-balance");
    const csv = reportToCsv(r, { id: "x", name: "Test Co (Pty) Ltd", financialYearStartMonth: 3, currencyCode: "ZAR" });
    expect(csv.split("\r\n").slice(0, 2)).toEqual(["Test Co (Pty) Ltd", "Trial Balance"]);
    expect(csv).toContain("14420.00");
    expect(csv).toContain("Passed");
  });

  it("Excel workbook has the report sheet and a checks sheet", async () => {
    const r = await run("customer-aging");
    const wb = await reportToWorkbook(r, { id: "x", name: "Test Co", financialYearStartMonth: 3, currencyCode: "ZAR" });
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Customer Aging", "Checks & Notes"]);
  });
});

describe("A ledger that does NOT reconcile is reported, never hidden", () => {
  it("a manual journal to Debtors with no customer fails the control-account check", async () => {
    const source = createInMemorySource({
      company: { id: "c", name: "C", financialYearStartMonth: 3, currencyCode: "ZAR" },
      accounts: fixtureSource ? (await fixtureSource().accounts()) : [],
      controlAccounts: { debtors: "1100", creditors: "2000", vat: [] },
      gl: [{ id: 1, companyId: "c", journalId: 1, journalLineId: 1, accountId: 2, postingDate: "2026-04-01", reference: "", description: "Manual", debit: 500, credit: 0, financialYearLabel: "", financialPeriod: 1, postedAt: "", postedBy: "", accountCode: "1100", accountDescription: "Debtors", journalNumber: "JR1", sourceType: "manual" }],
    });
    const r = (await runReport(source, "customer-aging", {}, TODAY)).result;
    const control = r.checks.find((c) => c.label.includes("control account"))!;
    expect(control).toMatchObject({ expected: 500, actual: 0, passed: false });
  });
});
