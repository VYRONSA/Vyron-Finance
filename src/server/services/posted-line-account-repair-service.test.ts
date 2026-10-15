/**
 * Bulk repair of missing revenue accounts on Posted invoices. Runs against
 * an in-memory stand-in for the invoice, journal and audit tables (every
 * repository is mocked; nothing touches a real Supabase project), so each
 * test can prove — byte for byte — that journals and every accounting
 * value are exactly as they were, and that only `gl_account` of lines
 * that had none ever changes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/repositories/sales-invoice-repository");
vi.mock("@/server/repositories/journal-repository");
vi.mock("@/server/repositories/posted-line-account-repair-repository");
vi.mock("@/server/repositories/sales-order-repository");
vi.mock("@/server/repositories/stock-item-repository");
vi.mock("@/server/repositories/inventory-transaction-repository");
vi.mock("@/server/services/posting-rule-service");
vi.mock("@/server/services/posting-engine-service");
vi.mock("@/server/services/inventory-transaction-service");
vi.mock("@/server/repositories/chart-of-accounts-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/repositories/chart-of-accounts-repository")>()),
  listChartOfAccounts: vi.fn(),
}));
vi.mock("@/server/services/automation-audit-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/automation-audit-service")>()),
  recordAuditEntry: vi.fn(),
  listAuditLogForDocument: vi.fn(),
}));
vi.mock("@/server/sales/posted-line-account-repair-scopes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/sales/posted-line-account-repair-scopes")>()),
  findRepairScope: vi.fn(),
}));

import {
  bulkAssignMissingPostedLineAccounts,
  MAX_POSTED_REPAIR_BATCH,
  parseInvoiceIds,
  previewPostedLineAccountRepair,
} from "./posted-line-account-repair-service";
import { ValidationError } from "./sales-invoice-service";
import * as invoiceRepo from "@/server/repositories/sales-invoice-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as repairRepo from "@/server/repositories/posted-line-account-repair-repository";
import * as orderRepo from "@/server/repositories/sales-order-repository";
import * as itemRepo from "@/server/repositories/stock-item-repository";
import * as inventoryRepo from "@/server/repositories/inventory-transaction-repository";
import * as postingRules from "@/server/services/posting-rule-service";
import * as postingEngine from "@/server/services/posting-engine-service";
import * as inventoryService from "@/server/services/inventory-transaction-service";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { listAuditLogForDocument, recordAuditEntry } from "@/server/services/automation-audit-service";
import { findRepairScope, type PostedLineAccountRepairScope } from "@/server/sales/posted-line-account-repair-scopes";
import type { SalesInvoice, SalesInvoiceLine } from "@/server/sales/types";
import type { Journal } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { AutomationAuditLogEntry } from "@/server/automation/types";

const CO = "company-a";
const OTHER = "company-b";

type Store = { invoices: Map<number, SalesInvoice>; journals: Map<number, Journal>; audit: { companyId: string; documentId: number; actionType: string; journalIds: number[] }[] };
let store: Store;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

let nextLineId = 1;
function line(glAccount: string | null, net = 100): SalesInvoiceLine {
  const id = nextLineId++;
  return { id, invoiceId: 0, lineOrder: id, description: `Line ${id}`, quantity: 1, unitPrice: net, discount: 0, netAmount: net, vatAmount: net * 0.15, lineTotal: net * 1.15, stockItemId: null, glAccount, vatCode: "Standard Rated" };
}

function addInvoice(id: number, o: { companyId?: string; status?: SalesInvoice["status"]; documentType?: SalesInvoice["documentType"]; lines?: SalesInvoiceLine[]; journal?: Partial<Journal> | null } = {}) {
  const lines = (o.lines ?? [line(null), line(null)]).map((l) => ({ ...l, invoiceId: id }));
  const subtotal = lines.reduce((t, l) => t + l.netAmount, 0);
  const vat = lines.reduce((t, l) => t + l.vatAmount, 0);
  const journalId = o.journal === null ? null : 1000 + id;
  const companyId = o.companyId ?? CO;
  store.invoices.set(id, {
    id, companyId, documentType: o.documentType ?? "Invoice", invoiceNumber: `SI-${id}`, customerId: 7, invoiceDate: "2026-09-01", dueDate: "2026-09-01",
    reference: "", status: o.status ?? "Posted", subtotal, vatAmount: vat, total: subtotal + vat, outstanding: subtotal + vat, notes: "", journalId,
    postedAt: "2026-10-15T06:10:00Z", lines,
  } as SalesInvoice);
  if (journalId !== null) {
    store.journals.set(journalId, {
      id: journalId, companyId, journalNumber: `JR00${journalId}`, journalDate: "2026-09-01", journalType: "Invoice", description: "", reference: "",
      sourceType: "sales_invoice", sourceId: id, status: "Posted", totalDebit: subtotal + vat, totalCredit: subtotal + vat, createdAt: "2026-10-15T06:10:00Z",
      postedAt: "2026-10-15T06:10:01Z", submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null,
      cancelledBy: null, cancelledAt: null, isReversed: false, reversalOfJournalId: null, reversedByJournalId: null, postingBatchId: 800 + id,
      lines: [
        { id: journalId * 10 + 1, journalId, accountCode: "1100", debit: subtotal + vat, credit: 0, description: "", lineOrder: 1 },
        { id: journalId * 10 + 2, journalId, accountCode: "4000", debit: 0, credit: subtotal, description: "", lineOrder: 2 },
        { id: journalId * 10 + 3, journalId, accountCode: "2200", debit: 0, credit: vat, description: "", lineOrder: 3 },
      ],
      ...(o.journal ?? {}),
    });
  }
}

const account = (code: string, overrides: Partial<ChartOfAccount> = {}) =>
  ({ id: Number(code), companyId: CO, accountCode: code, description: code === "1000" ? "Product Sales" : `Account ${code}`, accountType: "Income", isActive: true, ...overrides }) as ChartOfAccount;

/** Everything except line accounts, for "nothing else changed" checks. */
const accountingState = () =>
  JSON.stringify({
    invoices: [...store.invoices.values()].map((i) => ({ ...i, lines: i.lines.map((l) => ({ ...l, glAccount: undefined })) })),
    journals: [...store.journals.values()],
  });
const accountsOf = (id: number) => store.invoices.get(id)!.lines.map((l) => l.glAccount);

function calledExcept(mod: Record<string, unknown>, allowed: string[]): string[] {
  return Object.entries(mod).filter(([n, fn]) => !allowed.includes(n) && vi.isMockFunction(fn) && fn.mock.calls.length > 0).map(([n]) => n);
}

beforeEach(() => {
  vi.clearAllMocks();
  nextLineId = 1;
  store = { invoices: new Map(), journals: new Map(), audit: [] };
  addInvoice(501, { lines: [line(null), line(null), line("1005")] }); // eligible: 2 missing, 1 kept
  addInvoice(502, { lines: [line(null), line(null), line(null)] }); // eligible: 3 missing
  addInvoice(503, { status: "Draft", journal: null });
  addInvoice(504, { documentType: "Credit Note" });
  addInvoice(505, { documentType: "Debit Note" });
  addInvoice(506, { journal: { isReversed: true, reversedByJournalId: 9999 } });
  addInvoice(507, { journal: { status: "Approved" } });
  addInvoice(508, { lines: [line("1000"), line("1005")] }); // nothing missing, never repaired
  addInvoice(509, { status: "Submitted", journal: null });
  addInvoice(510, { status: "Approved" });
  addInvoice(511, { status: "Cancelled", journal: null });
  addInvoice(512, { journal: { sourceId: 999 } }); // a journal that is not its own
  addInvoice(900, { companyId: OTHER }); // another company's eligible invoice

  vi.mocked(invoiceRepo.getSalesInvoice).mockImplementation(async (companyId, id) => {
    const i = store.invoices.get(id);
    return i && i.companyId === companyId ? clone(i) : null;
  });
  vi.mocked(invoiceRepo.listSalesInvoicesByNumbers).mockImplementation(async (companyId, numbers) =>
    [...store.invoices.values()].filter((i) => i.companyId === companyId && numbers.includes(i.invoiceNumber)).map(clone),
  );
  vi.mocked(invoiceRepo.setMissingLineAccounts).mockImplementation(async (invoiceId, lineIds, code) => {
    const changed: number[] = [];
    for (const l of store.invoices.get(invoiceId)?.lines ?? []) if (lineIds.includes(l.id) && l.glAccount === null) { l.glAccount = code; changed.push(l.id); }
    return changed;
  });
  vi.mocked(invoiceRepo.clearLineAccounts).mockImplementation(async (invoiceId, lineIds, code) => {
    for (const l of store.invoices.get(invoiceId)?.lines ?? []) if (lineIds.includes(l.id) && l.glAccount === code) l.glAccount = null;
  });
  vi.mocked(journalRepo.getJournal).mockImplementation(async (companyId, id) => {
    const j = store.journals.get(id);
    return j && j.companyId === companyId ? clone(j) : null;
  });
  vi.mocked(repairRepo.countCompanyJournals).mockImplementation(async (companyId) => [...store.journals.values()].filter((j) => j.companyId === companyId).length);
  vi.mocked(listChartOfAccounts).mockResolvedValue([account("1000"), account("1005"), account("4000")]);
  vi.mocked(recordAuditEntry).mockImplementation(async (companyId, e) => {
    store.audit.push({ companyId, documentId: e.documentId!, actionType: e.actionType, journalIds: e.journalIds ?? [] });
    return {} as AutomationAuditLogEntry;
  });
  vi.mocked(listAuditLogForDocument).mockImplementation(async (companyId, _type, id) =>
    store.audit.filter((a) => a.companyId === companyId && a.documentId === id).map((a) => ({ actionType: a.actionType }) as AutomationAuditLogEntry),
  );
});

describe("bulkAssignMissingPostedLineAccounts — mixed selection", () => {
  it("repairs only eligible Posted invoices of this company, skips or fails everything else, and changes no accounting value", async () => {
    const before = accountingState();
    const journalsBefore = JSON.stringify([...store.journals.values()]);
    const ids = [501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 900, 77777];
    const run = await bulkAssignMissingPostedLineAccounts(CO, ids, "owner@example.test");

    const outcome = Object.fromEntries(run.results.map((r) => [r.invoiceId, r.outcome]));
    expect(outcome).toEqual({
      501: "repaired", 502: "repaired",
      503: "skipped", 504: "skipped", 505: "skipped", 506: "skipped", 507: "skipped", 508: "skipped",
      509: "skipped", 510: "skipped", 511: "skipped", 512: "skipped",
      900: "failed", 77777: "failed",
    });
    expect(run.summary).toEqual({ repaired: 2, "already-repaired": 0, skipped: 10, failed: 2, linesAssigned: 5 });
    expect(run.results.find((r) => r.invoiceId === 900)!.message).toMatch(/No sales invoice with id 900 in this company/);

    expect(accountsOf(501)).toEqual(["1000", "1000", "1005"]); // the existing account is never overwritten
    expect(accountsOf(502)).toEqual(["1000", "1000", "1000"]);
    for (const id of [503, 504, 505, 506, 507, 509, 510, 511, 512, 900]) expect(accountsOf(id)).toEqual([null, null]);
    expect(accountsOf(508)).toEqual(["1000", "1005"]);

    expect(accountingState()).toBe(before); // every amount, status, date and VAT code, on every invoice
    expect(JSON.stringify([...store.journals.values()])).toBe(journalsBefore); // every journal, byte for byte
    expect(store.audit).toEqual([
      { companyId: CO, documentId: 501, actionType: "SalesInvoicePostedLineAccountsAssigned", journalIds: [1501] },
      { companyId: CO, documentId: 502, actionType: "SalesInvoicePostedLineAccountsAssigned", journalIds: [1502] },
    ]);
  });

  it("never reaches a journal, posting, inventory or other invoice write", async () => {
    await bulkAssignMissingPostedLineAccounts(CO, [501, 502, 503, 504, 506, 900], "x");
    expect(calledExcept(journalRepo, ["getJournal"])).toEqual([]);
    expect(calledExcept(invoiceRepo, ["getSalesInvoice", "setMissingLineAccounts"])).toEqual([]);
    for (const mod of [postingEngine, postingRules, inventoryService, inventoryRepo, orderRepo, itemRepo]) expect(calledExcept(mod, [])).toEqual([]);
    // Only the two eligible invoices were ever written, each with account 1000.
    expect(vi.mocked(invoiceRepo.setMissingLineAccounts).mock.calls.map((c) => [c[0], c[2]])).toEqual([[501, "1000"], [502, "1000"]]);
  });

  it("never writes another company's invoice even when its id is sent (company isolation)", async () => {
    const run = await bulkAssignMissingPostedLineAccounts(CO, [900], "x");
    expect(run.results[0]).toMatchObject({ outcome: "failed", linesAssigned: 0 });
    expect(invoiceRepo.setMissingLineAccounts).not.toHaveBeenCalled();
    expect(accountsOf(900)).toEqual([null, null]);
    expect(store.audit).toEqual([]);
  });
});

describe("retries are idempotent", () => {
  it("a second run reports already-repaired, writes nothing and adds no audit entry", async () => {
    await bulkAssignMissingPostedLineAccounts(CO, [501, 502], "x");
    const writes = vi.mocked(invoiceRepo.setMissingLineAccounts).mock.calls.length;
    const state = JSON.stringify([...store.invoices.values()]);

    const again = await bulkAssignMissingPostedLineAccounts(CO, [501, 502], "x");
    expect(again.results.map((r) => r.outcome)).toEqual(["already-repaired", "already-repaired"]);
    expect(again.summary.linesAssigned).toBe(0);
    expect(vi.mocked(invoiceRepo.setMissingLineAccounts).mock.calls.length).toBe(writes);
    expect(JSON.stringify([...store.invoices.values()])).toBe(state);
    expect(store.audit).toHaveLength(2);
  });

  it("sends each id once even if it is repeated in the request", async () => {
    const run = await bulkAssignMissingPostedLineAccounts(CO, [501, 501, 501], "x");
    expect(run.results).toHaveLength(1);
    expect(store.audit).toHaveLength(1);
  });
});

describe("partial failures, rollback and retry", () => {
  it("an audit failure undoes only that invoice; the others are repaired; a retry then repairs it exactly once", async () => {
    addInvoice(513, { lines: [line(null)] });
    vi.mocked(recordAuditEntry).mockImplementationOnce(async () => ({}) as AutomationAuditLogEntry).mockImplementationOnce(async () => {
      throw new Error("audit unavailable");
    });
    const run = await bulkAssignMissingPostedLineAccounts(CO, [501, 502, 513], "x");
    expect(run.results.map((r) => r.outcome)).toEqual(["repaired", "failed", "repaired"]);
    expect(run.results[1].message).toBe("audit unavailable");
    expect(accountsOf(502)).toEqual([null, null, null]); // undone
    expect(accountsOf(513)).toEqual(["1000"]);

    const retry = await bulkAssignMissingPostedLineAccounts(CO, run.results.filter((r) => r.outcome === "failed").map((r) => r.invoiceId), "x");
    expect(retry.results).toEqual([expect.objectContaining({ invoiceId: 502, outcome: "repaired", linesAssigned: 3 })]);
    expect(store.audit.filter((a) => a.documentId === 502)).toHaveLength(1);
  });

  it.each<[string, (id: number) => void]>([
    ["a journal line's amount", (id) => { store.journals.get(1000 + id)!.lines[1].credit += 1; }],
    ["a journal line's account", (id) => { store.journals.get(1000 + id)!.lines[1].accountCode = "1000"; }],
    ["the journal status", (id) => { store.journals.get(1000 + id)!.status = "Cancelled"; }],
    ["the invoice total", (id) => { store.invoices.get(id)!.total += 1; }],
    ["the invoice VAT", (id) => { store.invoices.get(id)!.vatAmount += 1; }],
    ["the outstanding balance", (id) => { store.invoices.get(id)!.outstanding = 0; }],
    ["the invoice status", (id) => { store.invoices.get(id)!.status = "Cancelled"; }],
    ["the posting timestamp", (id) => { store.invoices.get(id)!.postedAt = "2026-10-16T00:00:00Z"; }],
    ["a line's VAT code", (id) => { store.invoices.get(id)!.lines[0].vatCode = "Zero Rated"; }],
  ])("drift in %s while writing: that invoice is undone, not audited and reported failed; the rest carry on", async (_label, drift) => {
    const write = vi.mocked(invoiceRepo.setMissingLineAccounts).getMockImplementation()!;
    vi.mocked(invoiceRepo.setMissingLineAccounts).mockImplementationOnce(async (invoiceId, lineIds, code) => {
      const changed = await write(invoiceId, lineIds, code);
      drift(invoiceId);
      return changed;
    });
    const run = await bulkAssignMissingPostedLineAccounts(CO, [501, 502], "x");
    expect(run.results.map((r) => r.outcome)).toEqual(["failed", "repaired"]);
    expect(run.results[0].message).toMatch(/changed while assigning accounts; the change was undone/);
    expect(accountsOf(501)).toEqual([null, null, "1005"]);
    expect(store.audit.map((a) => a.documentId)).toEqual([502]);
  });

  it("reports a failed undo plainly, with the lines left on 1000", async () => {
    vi.mocked(recordAuditEntry).mockRejectedValueOnce(new Error("audit unavailable"));
    vi.mocked(invoiceRepo.clearLineAccounts).mockRejectedValueOnce(new Error("connection lost"));
    const run = await bulkAssignMissingPostedLineAccounts(CO, [501], "x");
    expect(run.results[0].outcome).toBe("failed");
    expect(run.results[0].message).toMatch(/audit unavailable Undoing it also failed \(connection lost\): line\(s\) 1, 2 of SI-501 are on 1000 without an audit entry/);
  });
});

describe("concurrent changes", () => {
  it("someone else filled every line first: nothing is written or audited by this run", async () => {
    vi.mocked(invoiceRepo.setMissingLineAccounts).mockImplementationOnce(async (invoiceId) => {
      for (const l of store.invoices.get(invoiceId)!.lines) if (l.glAccount === null) l.glAccount = "1000";
      return [];
    });
    const run = await bulkAssignMissingPostedLineAccounts(CO, [502], "x");
    expect(run.results[0]).toMatchObject({ outcome: "failed", linesAssigned: 0 });
    expect(run.results[0].message).toMatch(/may have been updated by someone else/);
    expect(store.audit).toEqual([]);
  });

  it("someone else filled one line in between: this run's lines are undone, theirs are left alone", async () => {
    const write = vi.mocked(invoiceRepo.setMissingLineAccounts).getMockImplementation()!;
    vi.mocked(invoiceRepo.setMissingLineAccounts).mockImplementationOnce(async (invoiceId, lineIds, code) => {
      store.invoices.get(invoiceId)!.lines[0].glAccount = "1005"; // the other writer
      return write(invoiceId, lineIds, code);
    });
    const run = await bulkAssignMissingPostedLineAccounts(CO, [502], "x");
    expect(run.results[0].outcome).toBe("failed");
    expect(accountsOf(502)).toEqual(["1005", null, null]);
    expect(store.audit).toEqual([]);
  });
});

describe("account and request validation (nothing is written)", () => {
  it.each([
    ["inactive", [account("1000", { isActive: false })], /Account 1000 is inactive/],
    ["not Income", [account("1000", { accountType: "Cost of Sales" })], /a sales line needs an Income account/],
    ["missing", [account("4000")], /not in the chart of accounts/],
  ])("refuses the whole run when account 1000 is %s", async (_label, chart, message) => {
    vi.mocked(listChartOfAccounts).mockResolvedValue(chart);
    await expect(bulkAssignMissingPostedLineAccounts(CO, [501, 502], "x")).rejects.toThrow(message);
    expect(invoiceRepo.setMissingLineAccounts).not.toHaveBeenCalled();
    expect(store.audit).toEqual([]);
  });

  it.each([
    ["nothing", []],
    ["not a list", "501"],
    ["a string id", ["501"]],
    ["a negative id", [-1]],
    ["a fraction", [1.5]],
  ])("refuses %s as invoice ids", async (_label, ids) => {
    await expect(bulkAssignMissingPostedLineAccounts(CO, ids, "x")).rejects.toThrow(ValidationError);
    expect(invoiceRepo.setMissingLineAccounts).not.toHaveBeenCalled();
  });

  it(`refuses more than ${MAX_POSTED_REPAIR_BATCH} invoices in one request`, async () => {
    const ids = Array.from({ length: MAX_POSTED_REPAIR_BATCH + 1 }, (_, i) => i + 1);
    await expect(bulkAssignMissingPostedLineAccounts(CO, ids, "x")).rejects.toThrow(/At most 50 invoices/);
    expect(parseInvoiceIds(ids.slice(0, MAX_POSTED_REPAIR_BATCH))).toHaveLength(MAX_POSTED_REPAIR_BATCH);
    expect(invoiceRepo.getSalesInvoice).not.toHaveBeenCalled();
  });
});

describe("previewPostedLineAccountRepair", () => {
  it("lists exactly what would happen, with eligible counts and totals, and writes nothing", async () => {
    const preview = await previewPostedLineAccountRepair(CO, { invoiceIds: [501, 502, 503, 504, 900] });
    expect(preview.candidates.map((c) => [c.invoiceId, c.eligible, c.missingLines])).toEqual([[501, true, 2], [502, true, 3], [503, false, 2], [504, false, 2], [900, false, 0]]);
    expect(preview.eligible).toEqual({ invoices: 2, lines: 5, total: 690, vatAmount: 90 });
    expect(preview.account).toEqual({ code: "1000", description: "Product Sales", ok: true, problem: null });
    expect(preview.ready).toBe(true);
    expect(invoiceRepo.setMissingLineAccounts).not.toHaveBeenCalled();
    expect(recordAuditEntry).not.toHaveBeenCalled();
  });

  it("is not ready when account 1000 cannot be used", async () => {
    vi.mocked(listChartOfAccounts).mockResolvedValue([account("1000", { isActive: false })]);
    const preview = await previewPostedLineAccountRepair(CO, { invoiceIds: [501] });
    expect(preview.ready).toBe(false);
    expect(preview.account.problem).toMatch(/inactive/);
  });
});

describe("pinned scope preflight", () => {
  const scope = (overrides: Partial<PostedLineAccountRepairScope> = {}): PostedLineAccountRepairScope => ({
    id: "test-scope", label: "Test scope", companyId: CO, description: "two invoices",
    expected: { invoices: 2, lines: 6, total: 805, vatAmount: 105, journals: 12 },
    entries: [
      { invoiceNumber: "SI-501", invoiceId: 501, journalId: 1501, journalNumber: "JR001501", total: 345, vatAmount: 45, lines: 3 },
      { invoiceNumber: "SI-502", invoiceId: 502, journalId: 1502, journalNumber: "JR001502", total: 345, vatAmount: 45, lines: 3 },
    ],
    ...overrides,
  });

  beforeEach(() => {
    // 501 is fully unaccounted for this scope's purposes.
    store.invoices.get(501)!.lines[2].glAccount = null;
  });

  it("is ready only when every pinned number, id, journal and figure matches — and selects exactly the pinned invoices", async () => {
    const s = scope({ expected: { invoices: 2, lines: 6, total: 690, vatAmount: 90, journals: 9 } });
    s.entries[0] = { ...s.entries[0], total: 345, vatAmount: 45 };
    vi.mocked(findRepairScope).mockReturnValue(s);
    const preview = await previewPostedLineAccountRepair(CO, { scopeId: "test-scope" });
    expect(preview.scope!.problems).toEqual([]);
    expect(preview.ready).toBe(true);
    expect(preview.candidates.map((c) => c.invoiceId)).toEqual([501, 502]); // never anything outside the scope
    expect(preview.eligible).toEqual({ invoices: 2, lines: 6, total: 690, vatAmount: 90 });
  });

  it.each<[string, (s: PostedLineAccountRepairScope) => void, RegExp]>([
    ["a pinned id that belongs to another number", (s) => { s.entries[1] = { ...s.entries[1], invoiceId: 508 }; }, /SI-502: expected exactly one document with id 508/],
    ["a different journal", (s) => { s.entries[0] = { ...s.entries[0], journalNumber: "JR009999" }; }, /SI-501: journal is JR001501/],
    ["a different amount", (s) => { s.entries[0] = { ...s.entries[0], total: 346 }; }, /SI-501: total\/VAT 345\/45, expected 346\/45/],
    ["a different journal count", (s) => { s.expected = { ...s.expected, journals: 10 }; }, /has 9 journals, expected 10/],
    ["a different scope total", (s) => { s.expected = { ...s.expected, total: 1 }; }, /Scope total R690, expected R1/],
  ])("is not ready on %s", async (_label, change, message) => {
    const s = scope({ expected: { invoices: 2, lines: 6, total: 690, vatAmount: 90, journals: 9 } });
    change(s);
    vi.mocked(findRepairScope).mockReturnValue(s);
    const preview = await previewPostedLineAccountRepair(CO, { scopeId: "test-scope" });
    expect(preview.ready).toBe(false);
    expect(preview.scope!.problems.join("\n")).toMatch(message);
  });

  it("is not ready when a pinned invoice is no longer eligible (e.g. reversed journal)", async () => {
    const s = scope({ expected: { invoices: 2, lines: 6, total: 690, vatAmount: 90, journals: 9 } });
    store.journals.get(1502)!.isReversed = true;
    vi.mocked(findRepairScope).mockReturnValue(s);
    const preview = await previewPostedLineAccountRepair(CO, { scopeId: "test-scope" });
    expect(preview.ready).toBe(false);
    expect(preview.scope!.problems.join("\n")).toMatch(/SI-502: Journal JR001502 of SI-502 is not a live posted journal/);
  });

  it("after the repair it shows every pinned invoice as already repaired, with no problems and nothing left to do", async () => {
    const s = scope({ expected: { invoices: 2, lines: 6, total: 690, vatAmount: 90, journals: 9 } });
    vi.mocked(findRepairScope).mockReturnValue(s);
    await bulkAssignMissingPostedLineAccounts(CO, [501, 502], "x");
    const preview = await previewPostedLineAccountRepair(CO, { scopeId: "test-scope" });
    expect(preview.candidates.every((c) => c.alreadyRepaired)).toBe(true);
    expect(preview.scope!.problems).toEqual([]);
    expect(preview.ready).toBe(false);
  });

  it("refuses a scope that is not this company's", async () => {
    vi.mocked(findRepairScope).mockReturnValue(null);
    await expect(previewPostedLineAccountRepair(OTHER, { scopeId: "test-scope" })).rejects.toThrow(/no repair scope "test-scope" for this company/);
  });
});
