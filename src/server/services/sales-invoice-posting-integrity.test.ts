/**
 * Sales posting integrity (migration 0121):
 *
 *  1. Credit-note signs — a credit note posts DR Sales Returns / DR VAT
 *     Output / CR Debtors from POSITIVE stored figures; a document stored
 *     with negative figures (the ten credit notes imported from Xero) is
 *     refused instead of being negated twice.
 *  2. One journal per approval — overlapping or repeated approvals of one
 *     document create, link and post exactly one journal.
 *  3. Credit-note allocation — input checks and the mapping of the
 *     database's errors.
 *
 * The journal lines come from the REAL `buildJournalLinesFromRule` with the
 * rules `seed_company_defaults()` installs (0022), so the debit/credit
 * assertions are the accounting effect production would get. Every
 * repository is mocked or replaced by an in-memory store; nothing here
 * touches a real Supabase project.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/repositories/sales-invoice-repository");
vi.mock("@/server/repositories/journal-repository");
vi.mock("@/server/repositories/sales-order-repository");
vi.mock("@/server/repositories/stock-item-repository");
vi.mock("@/server/repositories/inventory-transaction-repository");
vi.mock("@/server/services/posting-engine-service");
vi.mock("@/server/services/inventory-transaction-service");
vi.mock("@/server/services/posting-rule-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/posting-rule-service")>()),
  buildJournalFromEvent: vi.fn(),
}));

import {
  allocateCreditNote,
  approveAndPostInvoice,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  salesJournalAmounts,
  ValidationError,
} from "./sales-invoice-service";
import * as invoiceRepo from "@/server/repositories/sales-invoice-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as postingRules from "@/server/services/posting-rule-service";
import * as postingEngine from "@/server/services/posting-engine-service";
import type { SalesInvoice, SalesInvoiceLine } from "@/server/sales/types";
import type { Journal } from "@/server/accounting/types";
import type { PostingRule } from "@/server/general-ledger/types";

const CO = "company-a";

/** The rules `seed_company_defaults()` installs (0022_cashbook_reconciliation.sql). */
const SEEDED: Record<string, PostingRule> = {
  "Sales Invoice": rule("Sales Invoice", [["Debit", "debtors", "1100", "gross"], ["Credit", "sales", "4000", "net"], ["Credit", "vat_output", "2200", "vat"]]),
  "Customer Credit Note": rule("Customer Credit Note", [["Debit", "sales_returns", "4100", "net"], ["Debit", "vat_output", "2200", "vat"], ["Credit", "debtors", "1100", "gross"]]),
};

function rule(eventType: string, lines: [string, string, string, string][]): PostingRule {
  return {
    id: 1, companyId: CO, eventType, description: eventType, isActive: true, createdAt: "2026-01-01T00:00:00Z",
    lines: lines.map(([side, role, fixedAccountCode, amountSource], i) => ({ id: i + 1, postingRuleId: 1, lineOrder: i, side, role, fixedAccountCode, amountSource })) as PostingRule["lines"],
  };
}

function line(id: number, net: number, vat: number, overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    id, invoiceId: 495, lineOrder: id, description: `Line ${id}`, quantity: 1, unitPrice: net, discount: 0,
    netAmount: net, vatAmount: vat, lineTotal: Math.round((net + vat) * 100) / 100, stockItemId: null, glAccount: "1000", vatCode: vat === 0 ? "No VAT" : "Standard Rated",
    ...overrides,
  };
}

function doc(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 495, companyId: CO, documentType: "Credit Note", invoiceNumber: "CN-3607", customerId: 70, orderId: null, invoiceDate: "2026-08-06", dueDate: null,
    reference: "ANDREA", status: "Submitted", subtotal: 298.6, vatAmount: 44.79, total: 343.39, outstanding: 343.39, notes: "", journalId: null,
    originalInvoiceId: null, postedAt: null,
    // CN-3607's three lines, as PRECISIA stores them after 0121 (positive).
    lines: [line(1, 159.6, 23.94), line(2, 55.6, 8.34), line(3, 83.4, 12.51)],
    ...overrides,
  } as SalesInvoice;
}

function journal(id: number, overrides: Partial<Journal> = {}): Journal {
  return {
    id, companyId: CO, journalNumber: `JR${String(id).padStart(6, "0")}`, journalDate: "2026-08-06", journalType: "Credit Note", description: "", reference: "",
    sourceType: "sales_invoice", sourceId: 495, status: "Approved", totalDebit: 0, totalCredit: 0, createdAt: "2026-10-22T00:00:00Z", postedAt: null,
    submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, cancelledBy: null, cancelledAt: null,
    isReversed: false, reversalOfJournalId: null, reversedByJournalId: null, postingBatchId: null, lines: [],
    ...overrides,
  };
}

const sum = (xs: number[]) => Math.round(xs.reduce((t, x) => t + x, 0) * 100) / 100;

/** Lines the seeded rule produces for a document, through the real builder. */
function postingLines(d: SalesInvoice) {
  const eventType = d.documentType === "Credit Note" ? "Customer Credit Note" : "Sales Invoice";
  const amounts = salesJournalAmounts(d);
  const built = postingRules.buildJournalLinesFromRule(SEEDED[eventType], { grossAmount: amounts.gross, vatRatePercent: 0, amounts, description: d.invoiceNumber });
  if (!built.ok) throw new Error(built.reason);
  return built.lines;
}

/** Net movement per account: debit − credit. */
function movement(lines: { accountCode: string; debit: number; credit: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) out[l.accountCode] = Math.round(((out[l.accountCode] ?? 0) + l.debit - l.credit) * 100) / 100;
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(postingRules.buildJournalFromEvent).mockImplementation(async (_co, eventType, context) => postingRules.buildJournalLinesFromRule(SEEDED[eventType], context));
});

// ---------------------------------------------------------------------
// 1. Credit-note signs
// ---------------------------------------------------------------------

describe("credit note posting — signs and accounting effect", () => {
  it("a credit note with VAT reduces Debtors and Output VAT and debits Sales Returns (CN-3607, R343.39)", () => {
    const lines = postingLines(doc());
    expect(lines.every((l) => l.debit >= 0 && l.credit >= 0)).toBe(true);
    expect(sum(lines.map((l) => l.debit))).toBe(sum(lines.map((l) => l.credit)));
    expect(movement(lines)).toEqual({ "4100": 298.6, "2200": 44.79, "1100": -343.39 });
  });

  it("a credit note without VAT posts no VAT line and still reduces Debtors", () => {
    const lines = postingLines(doc({ subtotal: 1440, vatAmount: 0, total: 1440, outstanding: 1440, lines: [line(1, 1440, 0)] }));
    expect(lines.map((l) => l.accountCode)).toEqual(["4100", "1100"]);
    expect(movement(lines)).toEqual({ "4100": 1440, "1100": -1440 });
  });

  it("a multi-line credit note posts its header figures, which equal the sum of its lines", () => {
    const d = doc();
    expect(sum(d.lines.map((l) => l.netAmount))).toBe(d.subtotal);
    expect(sum(d.lines.map((l) => l.vatAmount))).toBe(d.vatAmount);
    const lines = postingLines(d);
    expect(lines.find((l) => l.accountCode === "1100")?.credit).toBe(sum(d.lines.map((l) => l.lineTotal)));
  });

  it("an invoice still posts DR Debtors / CR Sales / CR VAT Output — unchanged", () => {
    const lines = postingLines(doc({ documentType: "Invoice", invoiceNumber: "INV-3576", subtotal: 1389.2, vatAmount: 208.38, total: 1597.58 }));
    expect(movement(lines)).toEqual({ "1100": 1597.58, "4000": -1389.2, "2200": -208.38 });
  });

  it("refuses a credit note stored with negative figures — the defect that posted the ten imported credit notes backwards", () => {
    // CN-3607 exactly as the pre-0121 importer stored it. Posting it would
    // have produced 4100 Dr −298.60 / 2200 Dr −44.79 / 1100 Cr −343.39, i.e.
    // Debtors and Output VAT UP by R343.39 / R44.79 (JR001392).
    const legacy = doc({ subtotal: -298.6, vatAmount: -44.79, total: -343.39, outstanding: -343.39 });
    expect(() => salesJournalAmounts(legacy)).toThrow(ValidationError);
    expect(() => salesJournalAmounts(legacy)).toThrow(/negative amounts/);
  });

  it("refuses any sales document with a negative net or VAT, not only credit notes", () => {
    expect(() => salesJournalAmounts(doc({ documentType: "Invoice", vatAmount: -1 }))).toThrow(ValidationError);
    expect(() => salesJournalAmounts(doc({ documentType: "Debit Note", subtotal: -1 }))).toThrow(ValidationError);
  });

  it("approving a legacy negative credit note writes nothing at all", async () => {
    vi.mocked(invoiceRepo.getSalesInvoice).mockResolvedValue(doc({ subtotal: -298.6, vatAmount: -44.79, total: -343.39 }));
    await expect(approveAndPostInvoice(CO, 495)).rejects.toThrow(ValidationError);
    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(invoiceRepo.approveInvoice).not.toHaveBeenCalled();
    expect(postingEngine.postApprovedJournals).not.toHaveBeenCalled();
  });

  it("approving a credit note creates its journal from the positive figures and the credit-note rule", async () => {
    vi.mocked(invoiceRepo.getSalesInvoice).mockResolvedValue(doc());
    vi.mocked(journalRepo.listJournalsBySource).mockResolvedValue([]);
    vi.mocked(journalRepo.createJournal).mockImplementation(async (_co, j) => journal(901, { lines: j.lines.map((l, i) => ({ id: i, journalId: 901, lineOrder: i, ...l })) }));
    vi.mocked(invoiceRepo.approveInvoice).mockResolvedValue(doc({ status: "Approved", journalId: 901 }));
    vi.mocked(postingEngine.postApprovedJournals).mockResolvedValue({ posted: [{ journalId: 901 }], skipped: [] } as never);
    vi.mocked(invoiceRepo.markInvoicePosted).mockResolvedValue(doc({ status: "Posted", journalId: 901 }));

    await approveAndPostInvoice(CO, 495);

    expect(postingRules.buildJournalFromEvent).toHaveBeenCalledWith(CO, "Customer Credit Note", expect.objectContaining({ amounts: { gross: 343.39, net: 298.6, vat: 44.79 } }));
    const created = vi.mocked(journalRepo.createJournal).mock.calls[0][1];
    expect(movement(created.lines)).toEqual({ "4100": 298.6, "2200": 44.79, "1100": -343.39 });
    expect(invoiceRepo.approveInvoice).toHaveBeenCalledWith(CO, 495, 901, "Submitted");
  });
});

// ---------------------------------------------------------------------
// 2. One journal per approval
// ---------------------------------------------------------------------

/** An in-memory stand-in with the database's 0121 semantics: one live
 * journal per sales document (the trigger), a conditional link (the
 * repository's `approveInvoice`), and a Posting Engine that posts every
 * Approved journal in the company. Every call yields to the event loop, so
 * two requests started together interleave the way two HTTP requests do. */
function store(initial: SalesInvoice) {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const state = { invoice: { ...initial }, journals: [] as Journal[], postCalls: 0 };
  const live = (j: Journal) => !j.isReversed && j.status !== "Rejected" && j.status !== "Cancelled";
  vi.mocked(invoiceRepo.getSalesInvoice).mockImplementation(async () => { await tick(); return { ...state.invoice }; });
  vi.mocked(journalRepo.listJournalsBySource).mockImplementation(async () => { await tick(); return state.journals.map((j) => ({ ...j })); });
  vi.mocked(journalRepo.createJournal).mockImplementation(async (_co, j) => {
    await tick();
    if (state.journals.some((x) => x.sourceId === j.sourceId && live(x))) {
      throw Object.assign(new Error("PRECISIA_SALES_JOURNAL_EXISTS: sales document 495 already has live journal JR000001."), { code: "23505" });
    }
    const created = journal(state.journals.length + 1, { lines: j.lines.map((l, i) => ({ id: i, journalId: 0, lineOrder: i, ...l })) });
    state.journals.push(created);
    return { ...created };
  });
  vi.mocked(invoiceRepo.approveInvoice).mockImplementation(async (_co, _id, journalId, expected) => {
    await tick();
    if (state.invoice.status !== expected || state.invoice.journalId !== null) return null;
    state.invoice = { ...state.invoice, status: "Approved", journalId };
    return { ...state.invoice };
  });
  vi.mocked(postingEngine.postApprovedJournals).mockImplementation(async () => {
    await tick();
    state.postCalls++;
    const posted = state.journals.filter((j) => j.status === "Approved").map((j) => { j.status = "Posted"; return { journalId: j.id }; });
    return { posted, skipped: [] } as never;
  });
  vi.mocked(invoiceRepo.markInvoicePosted).mockImplementation(async () => { await tick(); state.invoice = { ...state.invoice, status: "Posted" }; return { ...state.invoice }; });
  vi.mocked(journalRepo.cancelUnpostedJournal).mockImplementation(async (_co, id) => {
    await tick();
    const j = state.journals.find((x) => x.id === id);
    if (!j || j.status !== "Approved") return false;
    j.status = "Cancelled";
    return true;
  });
  return state;
}

describe("approval — one journal, however many requests", () => {
  it("two simultaneous approvals: one posts, the other is refused, exactly one journal exists and is posted (INV-3611)", async () => {
    const state = store(doc({ documentType: "Invoice", invoiceNumber: "INV-3611", subtotal: 3052.8, vatAmount: 457.92, total: 3510.72 }));
    const results = await Promise.allSettled([approveAndPostInvoice(CO, 495), approveAndPostInvoice(CO, 495)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictError);
    expect(state.journals).toHaveLength(1);
    expect(state.journals[0].status).toBe("Posted");
    expect(state.invoice).toMatchObject({ status: "Posted", journalId: state.journals[0].id });
  });

  it("five simultaneous approvals still produce exactly one live journal", async () => {
    const state = store(doc({ documentType: "Invoice" }));
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => approveAndPostInvoice(CO, 495)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.journals.filter((j) => j.status !== "Cancelled")).toHaveLength(1);
    expect(state.invoice.status).toBe("Posted");
  });

  it("approving again after it was posted is refused and writes nothing", async () => {
    const state = store(doc({ documentType: "Invoice" }));
    await approveAndPostInvoice(CO, 495);
    vi.mocked(journalRepo.createJournal).mockClear();
    await expect(approveAndPostInvoice(CO, 495)).rejects.toThrow(/Cannot approve .* from status Posted/);
    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(state.journals).toHaveLength(1);
  });

  it("an interrupted approval (journal created, never linked) is completed on retry with that same journal", async () => {
    const state = store(doc());
    state.journals.push(journal(7, { lines: postingLines(doc()).map((l, i) => ({ id: i, journalId: 7, lineOrder: i, ...l })) }));
    await approveAndPostInvoice(CO, 495);
    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(state.journals).toHaveLength(1);
    expect(state.journals[0].status).toBe("Posted");
    expect(state.invoice).toMatchObject({ status: "Posted", journalId: 7 });
  });

  it("an interrupted approval whose journal was already posted is linked and finished without posting again", async () => {
    const state = store(doc());
    state.journals.push(journal(7, { status: "Posted", lines: postingLines(doc()).map((l, i) => ({ id: i, journalId: 7, lineOrder: i, ...l })) }));
    await approveAndPostInvoice(CO, 495);
    expect(state.postCalls).toBe(0);
    expect(state.invoice).toMatchObject({ status: "Posted", journalId: 7 });
  });

  it("refuses when an existing journal does not match the document, and writes nothing", async () => {
    const state = store(doc());
    state.journals.push(journal(7, { lines: [{ id: 1, journalId: 7, lineOrder: 0, accountCode: "1100", debit: 1, credit: 0, description: "" }] }));
    await expect(approveAndPostInvoice(CO, 495)).rejects.toThrow(/does not match this document/);
    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(invoiceRepo.approveInvoice).not.toHaveBeenCalled();
    expect(state.invoice.status).toBe("Submitted");
  });

  it("refuses when the document already has two live journals (the INV-3611 state) and writes nothing", async () => {
    const lines = postingLines(doc()).map((l, i) => ({ id: i, journalId: 0, lineOrder: i, ...l }));
    const state = store(doc());
    state.journals.push(journal(1436, { status: "Posted", lines }), journal(1437, { status: "Posted", lines }));
    await expect(approveAndPostInvoice(CO, 495)).rejects.toThrow(/2 live journals/);
    expect(invoiceRepo.approveInvoice).not.toHaveBeenCalled();
    expect(postingEngine.postApprovedJournals).not.toHaveBeenCalled();
  });

  it("a reversed or cancelled earlier journal does not block a new one", async () => {
    const state = store(doc());
    state.journals.push(journal(3, { status: "Posted", isReversed: true }), journal(4, { status: "Cancelled" }));
    await approveAndPostInvoice(CO, 495);
    expect(state.journals).toHaveLength(3);
    expect(state.invoice.journalId).toBe(3);
  });

  it("cancelled while being approved: the new journal is withdrawn before anything posts it", async () => {
    const state = store(doc());
    vi.mocked(invoiceRepo.approveInvoice).mockImplementationOnce(async () => {
      state.invoice = { ...state.invoice, status: "Cancelled" };
      return null;
    });
    await expect(approveAndPostInvoice(CO, 495)).rejects.toBeInstanceOf(ConflictError);
    expect(state.journals[0].status).toBe("Cancelled");
    expect(state.postCalls).toBe(0);
  });

  it("if the withdrawn journal had already been posted, says so instead of hiding it", async () => {
    const state = store(doc());
    vi.mocked(invoiceRepo.approveInvoice).mockImplementationOnce(async () => {
      state.invoice = { ...state.invoice, status: "Cancelled" };
      state.journals[0].status = "Posted";
      return null;
    });
    await expect(approveAndPostInvoice(CO, 495)).rejects.toThrow(/had already been posted/);
  });

  it("losing the link to a request that linked this same journal does not cancel it", async () => {
    const state = store(doc());
    vi.mocked(invoiceRepo.approveInvoice).mockImplementationOnce(async (_co, _id, journalId) => {
      state.invoice = { ...state.invoice, status: "Approved", journalId };
      return null;
    });
    await expect(approveAndPostInvoice(CO, 495)).rejects.toBeInstanceOf(ConflictError);
    expect(journalRepo.cancelUnpostedJournal).not.toHaveBeenCalled();
    expect(state.journals[0].status).toBe("Approved");
  });
});

// ---------------------------------------------------------------------
// 3. Credit-note allocation — service checks and error mapping
// ---------------------------------------------------------------------

describe("allocateCreditNote", () => {
  const KEY = "6c1f2a8e-5d3b-4f7a-9e21-0b6a4c8d2f10";

  it("passes a valid request to the database function unchanged", async () => {
    vi.mocked(invoiceRepo.allocateCreditNote).mockResolvedValue({ allocationId: 1, replayed: false, amount: 343.39 } as never);
    await allocateCreditNote(CO, 495, 514, 343.39, KEY);
    expect(invoiceRepo.allocateCreditNote).toHaveBeenCalledWith(CO, 495, 514, 343.39, KEY);
  });

  it.each([
    ["no target", 495, Number.NaN, 10, KEY],
    ["itself", 495, 495, 10, KEY],
    ["zero", 495, 514, 0, KEY],
    ["negative", 495, 514, -10, KEY],
    ["fractions of a cent", 495, 514, 10.005, KEY],
    ["no request key", 495, 514, 10, ""],
    ["a malformed request key", 495, 514, 10, "not-a-key"],
  ])("refuses %s before reaching the database", async (_label, cn, inv, amount, key) => {
    await expect(allocateCreditNote(CO, cn, inv, amount, key)).rejects.toBeInstanceOf(ValidationError);
    expect(invoiceRepo.allocateCreditNote).not.toHaveBeenCalled();
  });

  it.each([
    ["PRECISIA_CN_ALLOCATION_OVER: CN-3406 has only 10.00 of credit left to apply.", "22023", ValidationError, "CN-3406 has only 10.00 of credit left to apply."],
    ["PRECISIA_CN_ALLOCATION_INVALID: CN-3607 and INV-3624 belong to different customers.", "22023", ValidationError, "CN-3607 and INV-3624 belong to different customers."],
    ["PRECISIA_CN_ALLOCATION_NOT_FOUND: the credit note or the invoice does not exist in this company.", "P0002", NotFoundError, "the credit note or the invoice does not exist in this company."],
    ["PRECISIA_CN_ALLOCATION_KEY_REUSED: this request key was already used for a different allocation.", "23505", ConflictError, "this request key was already used for a different allocation."],
    ["PRECISIA_CN_ALLOCATION_FORBIDDEN: Sales:Edit and Sales:Approve are required.", "42501", ForbiddenError, "Sales:Edit and Sales:Approve are required."],
  ])("maps %s", async (message, code, type, shown) => {
    vi.mocked(invoiceRepo.allocateCreditNote).mockRejectedValue(Object.assign(new Error(message), { code }));
    const error = await allocateCreditNote(CO, 495, 514, 10, KEY).catch((e) => e);
    expect(error).toBeInstanceOf(type);
    expect(error.message).toBe(shown);
  });

  it("passes any other database error through untouched", async () => {
    const boom = Object.assign(new Error("connection reset"), { code: "08006" });
    vi.mocked(invoiceRepo.allocateCreditNote).mockRejectedValue(boom);
    await expect(allocateCreditNote(CO, 495, 514, 10, KEY)).rejects.toBe(boom);
  });
});
