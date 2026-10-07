/**
 * @vitest-environment node
 *
 * SD-3D — the reconciliation service: preconditions, persistence of the full
 * input snapshot + fingerprint, exact replay, decisions, and boundaries.
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
    expect(run).toMatchObject({ id: 55, runNumber: 1, statementClosing: 100, precisiaBalance: 100, difference: 0, unexplained: 0 });
    const [row, items] = m.recon.insertRun.mock.calls[0];
    expect(row).toMatchObject({ supplier_id: 3, basis: "supplier-ledger-document-date", difference: 0, explained_amount: 0, unexplained_amount: 0, created_by: "editor@synthetic.test" });
    expect(row.input_fingerprint).toBe(service.fingerprint(row.input_snapshot));
    expect(row.input_snapshot.lines).toHaveLength(1); // excluded rows are not transactions
    expect(row.input_snapshot.ledger[0]).toMatchObject({ refType: "bill", refId: 1, number: "0001042" });
    expect(items).toEqual([expect.objectContaining({ category: "Matched", sub_status: "exact", statement_line_id: 40 })]);
    expect(m.recon.markStatementReconciled).toHaveBeenCalledWith(CO, 7);
    expect(m.statements.recordSystemStatementEvent).toHaveBeenCalledWith(CO, 7, "ReconciliationRun", expect.objectContaining({ runId: 55, fingerprint: row.input_fingerprint }), "editor@synthetic.test");
  });

  it.each([
    [{ status: "NeedsReview" }, /marked ready/],
    [{ supplier_confirmed_at: null }, /Confirm the supplier/],
    [{ currency_code: "USD" }, /Unsupported currency/],
    [{ closing_balance: null }, /closing balance/],
  ])("refuses %o", async (over, message) => {
    m.statements.getStatement.mockResolvedValue(statement(over));
    await expect(service.runStatementReconciliation(CO, 7)).rejects.toThrow(message);
    expect(m.recon.insertRun).not.toHaveBeenCalled();
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
    tampered.run.input_snapshot.ledger[0].amount = 90;
    m.recon.getRun.mockResolvedValue(tampered);
    expect(await service.verifyStatementReconciliation(CO, 7, 55)).toEqual({ fingerprintMatches: false, resultMatches: false });
  });
});

describe("recordStatementResolution", () => {
  it("records through the writer (session actor) and audits ids only", async () => {
    m.recon.recordResolution.mockResolvedValue(12);
    await service.recordStatementResolution(CO, 7, { action: "explained", refType: "opening-difference", reason: "Pre-migration balance" });
    expect(m.recon.recordResolution).toHaveBeenCalledWith(expect.objectContaining({ action: "explained", refType: "opening-difference", reason: "Pre-migration balance" }));
    expect(m.statements.recordStatementEvent).toHaveBeenCalledWith(CO, 7, "ResolutionRecorded", { resolutionId: 12, action: "explained", revokes: null });
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
