/**
 * @vitest-environment node
 *
 * SD-3D / SD-3G — the reconciliation service: preconditions, persistence of
 * the full input snapshot + fingerprint, exact replay (by the engine that
 * produced the run), decisions, and boundaries. SD-3G runs are DOCUMENT runs.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  recon: {
    loadSupplierSources: vi.fn(),
    loadSupplierCaptures: vi.fn(),
    loadCaptureBillIds: vi.fn(),
    listResolutionsAsSystem: vi.fn(),
    listResolutions: vi.fn(),
    recordResolution: vi.fn(),
    nextRunNumber: vi.fn(),
    insertRun: vi.fn(),
    markStatementReconciled: vi.fn(),
    listRuns: vi.fn(),
    getRun: vi.fn(),
  },
  statements: {
    getStatement: vi.fn(),
    getCompanyBaseCurrency: vi.fn(),
    listStatementLinesAsSystem: vi.fn(),
    recordSystemStatementEvent: vi.fn(),
    recordStatementEvent: vi.fn(),
  },
}));
vi.mock("@/server/repositories/supplier-statement-reconciliation-repository", () => m.recon);
vi.mock("@/server/repositories/supplier-statement-repository", () => m.statements);
vi.mock("@/server/auth/require-session", () => ({ getPerformedByLabel: async () => "editor@synthetic.test" }));

import * as service from "./supplier-statement-reconciliation-service";

const CO = "co_1";
function statement(over: Record<string, unknown> = {}) {
  return {
    id: 7, company_id: CO, status: "Ready", supplier_id: 3, supplier_confirmed_at: "2026-10-01T00:00:00Z", statement_date: "2026-09-30",
    period_from: "2026-09-01", opening_balance: "0.00", closing_balance: "100.00", currency_code: null, sign_convention: "debit-increases-owed", ...over,
  };
}
const bill = { id: 1, companyId: CO, supplierId: 3, supplierName: "S", invoiceNumber: "0001042", documentType: "Bill", invoiceDate: "2026-09-03", total: 100, vat: 0, postingStatus: "Posted", journalId: 9, origin: "Purchasing" };

beforeEach(() => {
  vi.clearAllMocks();
  m.statements.getStatement.mockResolvedValue(statement());
  m.statements.getCompanyBaseCurrency.mockResolvedValue("ZAR");
  m.statements.listStatementLinesAsSystem.mockResolvedValue([
    { id: 40, line_order: 1, page_number: 1, transaction_date: "2026-09-03", reference_text: "0001042", description: "Invoice", transaction_type: "invoice", debit: "100.00", credit: null, is_excluded: false },
    { id: 41, line_order: 2, page_number: 1, transaction_date: null, reference_text: null, description: "Closing", transaction_type: "other", debit: null, credit: null, is_excluded: true },
  ]);
  m.recon.listResolutionsAsSystem.mockResolvedValue([]);
  m.recon.loadSupplierSources.mockResolvedValue({ bills: [bill], payments: [], bankTransactions: [], openingBalances: [] });
  m.recon.loadSupplierCaptures.mockResolvedValue([]);
  m.recon.loadCaptureBillIds.mockResolvedValue(new Set());
  m.recon.nextRunNumber.mockResolvedValue(1);
  m.recon.insertRun.mockResolvedValue(55);
});

describe("runStatementReconciliation", () => {
  it("records an immutable run with the full input snapshot and its fingerprint, then marks the statement Reconciled", async () => {
    const run = await service.runStatementReconciliation(CO, 7);
    expect(run).toMatchObject({ id: 55, runNumber: 1, documentsOnStatement: 100, documentsInPrecisia: 100, difference: 0, unexplained: 0 });
    const [row, items] = m.recon.insertRun.mock.calls[0];
    expect(row).toMatchObject({
      supplier_id: 3, basis: "supplier-statement-documents", engine_version: "sd3g-1", statement_opening: 0, statement_closing: 100,
      precisia_balance_before_window: 0, precisia_balance_at: 100, difference: 0, explained_amount: 0, unexplained_amount: 0, created_by: "editor@synthetic.test",
    });
    expect(row.input_fingerprint).toBe(service.fingerprint(row.input_snapshot));
    expect(row.input_snapshot.lines).toHaveLength(1); // excluded rows are not transactions
    expect(row.input_snapshot.documents[0]).toMatchObject({ refType: "bill", refId: 1, number: "0001042", posted: true });
    expect(items).toEqual([expect.objectContaining({ category: "Matched", sub_status: "posted", match_tier: "exact", statement_line_id: 40 })]);
    expect(m.recon.markStatementReconciled).toHaveBeenCalledWith(CO, 7);
    expect(m.statements.recordSystemStatementEvent).toHaveBeenCalledWith(CO, 7, "ReconciliationRun", expect.objectContaining({ runId: 55, fingerprint: row.input_fingerprint }), "editor@synthetic.test");
  });

  it.each([
    [{ status: "NeedsReview" }, /marked ready/],
    [{ supplier_confirmed_at: null }, /Confirm the supplier/],
    [{ currency_code: "USD" }, /Unsupported currency/],
    [{ statement_date: null }, /date/],
  ])("refuses %o", async (over, message) => {
    m.statements.getStatement.mockResolvedValue(statement(over));
    await expect(service.runStatementReconciliation(CO, 7)).rejects.toThrow(message);
    expect(m.recon.insertRun).not.toHaveBeenCalled();
  });

  it("SD-3G: needs no opening or closing balance (a statement that prints none can be reconciled)", async () => {
    m.statements.getStatement.mockResolvedValue(statement({ opening_balance: null, closing_balance: null }));
    await expect(service.runStatementReconciliation(CO, 7)).resolves.toMatchObject({ difference: 0 });
  });

  it("SD-3G: payments are out of scope — PRECISIA payments and bank transactions are never read into the run", async () => {
    m.statements.listStatementLinesAsSystem.mockResolvedValue([
      { id: 40, line_order: 1, page_number: 1, transaction_date: "2026-09-03", reference_text: "0001042", description: "Invoice", transaction_type: "invoice", debit: "100.00", credit: null, is_excluded: false },
      { id: 42, line_order: 2, page_number: 1, transaction_date: "2026-09-10", reference_text: "SP-1", description: "Payment", transaction_type: "payment", debit: null, credit: null, is_excluded: false },
    ]);
    m.recon.loadSupplierSources.mockResolvedValue({
      bills: [bill],
      payments: [{ id: 5, supplierId: 3, paymentNumber: "SP-1", paymentDate: "2026-09-10", amount: 40, status: "Posted", reference: "", notes: "", journalId: 3 }],
      bankTransactions: [{ id: 6, transactionDate: "2026-09-11", reference: "SP-1", description: "x", debit: 0, credit: 40, postedFlag: true, allocationType: "S", matchedSupplierId: 3, journalId: 4 }],
      openingBalances: [],
    });
    await service.runStatementReconciliation(CO, 7);
    const [row, items] = m.recon.insertRun.mock.calls[0];
    expect(JSON.stringify(row.input_snapshot)).not.toMatch(/supplier-payment|bank-transaction/);
    expect(items.map((i: { category: string }) => i.category)).toEqual(["Matched", "Out of Scope"]);
    expect(row.difference).toBe(0);
    expect(row.category_summary.__byKind).toEqual({ invoice: { Matched: 1 } });
  });

  it("an unknown (or another company's) statement is not found", async () => {
    m.statements.getStatement.mockResolvedValue(null);
    await expect(service.runStatementReconciliation(CO, 7)).rejects.toBeInstanceOf(service.NotFoundError);
  });
});

describe("verifyStatementReconciliation", () => {
  it("a stored run replays exactly from its persisted inputs; any tampering is detected", async () => {
    await service.runStatementReconciliation(CO, 7);
    const [row, items] = m.recon.insertRun.mock.calls[0];
    // Round-trip through JSON, as the database stores it.
    const stored = JSON.parse(JSON.stringify({ run: { ...row, id: 55 }, items: items.map((i: object) => ({ ...i })) }));
    m.recon.getRun.mockResolvedValue(stored);
    expect(await service.verifyStatementReconciliation(CO, 7, 55)).toEqual({ fingerprintMatches: true, resultMatches: true });

    const tampered = JSON.parse(JSON.stringify(stored));
    tampered.run.input_snapshot.documents[0].amount = 90;
    m.recon.getRun.mockResolvedValue(tampered);
    expect(await service.verifyStatementReconciliation(CO, 7, 55)).toEqual({ fingerprintMatches: false, resultMatches: false });
  });
});

describe("verifyStatementReconciliation — SD-3D balance runs still replay", () => {
  it("a stored sd3d-1 run is replayed by the SD-3D engine and reproduces exactly", async () => {
    const { reconcileStatement: sd3d } = await import("@/server/supplier-statements/reconciliation-engine-sd3d");
    const input = {
      engineVersion: "sd3d-1",
      statement: { id: 7, statementDate: "2026-09-30", periodFrom: "2026-09-01", openingBalance: 0, closingBalance: 100, signConvention: "debit-increases-owed" as const },
      lines: [{ id: 40, lineOrder: 1, pageNumber: 1, date: "2026-09-03", reference: "0001042", description: null, type: "invoice" as const, debit: 100, credit: null }],
      ledger: [{ refType: "bill" as const, refId: 1, date: "2026-09-03", number: "0001042", evidence: "", amount: 100 }],
      unposted: [],
      resolutions: [],
    };
    const result = sd3d(input);
    m.recon.getRun.mockResolvedValue({
      run: { id: 9, engine_version: "sd3d-1", input_snapshot: input, input_fingerprint: service.fingerprint(input), difference: result.difference, explained_amount: result.explained, unexplained_amount: result.unexplained, precisia_balance_at: result.balanceAt },
      items: result.items.map((i) => ({ item_order: i.order, category: i.category, sub_status: i.subStatus, match_tier: i.matchTier, precisia_ref_type: i.refType, precisia_ref_id: i.refId, effect_on_difference: i.effect, explained: i.explained, statement_line_id: i.lineId })),
    });
    expect(await service.verifyStatementReconciliation(CO, 7, 9)).toEqual({ fingerprintMatches: true, resultMatches: true });
  });
});

describe("recordStatementResolution", () => {
  it("records through the writer (session actor) and audits ids only", async () => {
    m.recon.recordResolution.mockResolvedValue(12);
    await service.recordStatementResolution(CO, 7, { action: "manual-link", statementLineId: 40, refType: "bill", refId: 1, reason: "Same delivery" });
    expect(m.recon.recordResolution).toHaveBeenCalledWith(expect.objectContaining({ action: "manual-link", refType: "bill", refId: 1, reason: "Same delivery" }));
    expect(m.statements.recordStatementEvent).toHaveBeenCalledWith(CO, 7, "ResolutionRecorded", { resolutionId: 12, action: "manual-link", revokes: null });
  });
  it("SD-3G: decisions refer to supplier DOCUMENTS only — never a payment, bank transaction or opening balance", async () => {
    for (const refType of ["supplier-payment", "bank-transaction", "opening-balance", "opening-difference"]) {
      await expect(service.recordStatementResolution(CO, 7, { action: "explained", refType, refId: 1, reason: "because" }), refType).rejects.toThrow(/Unknown record type/);
    }
    expect(m.recon.recordResolution).not.toHaveBeenCalled();
  });

  it("requires a reason and a known action", async () => {
    await expect(service.recordStatementResolution(CO, 7, { action: "explained", reason: " " })).rejects.toThrow(/reason/);
    await expect(service.recordStatementResolution(CO, 7, { action: "adjust" as never, reason: "force it" })).rejects.toThrow(/Unknown decision/);
    expect(m.recon.recordResolution).not.toHaveBeenCalled();
  });
});

describe("boundaries", () => {
  it("reconciliation imports no posting, allocation or AI module, and writes only its own tables", () => {
    const files = [
      "src/server/services/supplier-statement-reconciliation-service.ts",
      "src/server/repositories/supplier-statement-reconciliation-repository.ts",
      "src/server/supplier-statements/reconciliation-engine.ts",
      "src/server/supplier-statements/reconciliation-engine-sd3d.ts",
      "src/server/supplier-statements/reconciliation-input.ts",
    ];
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      for (const spec of [...source.matchAll(/from\s+"([^"]+)"/g)].map((x) => x[1])) {
        expect(spec, `${path} imports ${spec}`).not.toMatch(/purchase-bill-service|posting|journal-service|supplier-payment-service|allocation|\/ai\/|extraction-provider|gateway/);
      }
      // Writes (insert/update/delete/upsert) only to reconciliation tables and the statement's status.
      const writes = [...source.matchAll(/\.from\("([a-z_]+)"\)\s*\.(insert|update|delete|upsert)\(/g)].map((x) => x[1]);
      for (const table of writes) {
        expect(["supplier_statement_reconciliations", "supplier_statement_reconciliation_items", "supplier_statements"], `${path} writes ${table}`).toContain(table);
      }
    }
  });
});
