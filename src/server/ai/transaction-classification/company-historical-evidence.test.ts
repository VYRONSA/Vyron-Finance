/**
 * Phase 28 — the forensic report's own explicit requirement: human-
 * confirmed evidence (manual override, Banking Rule, or an accepted AI
 * suggestion — all share `is_manual_override: true` or a real `rule_id`)
 * must count for substantially more than a mere unconfirmed AI
 * suggestion or automatic allocation. These tests prove the aggregation
 * rule directly, plus company scoping on the async orchestrator.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/transaction-explorer-repository", () => ({ listHistoricalAllocationsForPattern: vi.fn() }));
vi.mock("@/server/services/transaction-explorer-service", () => ({ REPEATED_ALLOCATION_THRESHOLD: 3 }));

import { aggregatePatternEvidence, buildCompanyHistoricalPatternEvidence } from "./company-historical-evidence";
import { listHistoricalAllocationsForPattern } from "@/server/repositories/transaction-explorer-repository";

type Row = { suggestedGlAccount: string | null; ruleId: number | null; isManualOverride: boolean; allocationMethod: string | null };

function humanRow(accountCode: string): Row {
  return { suggestedGlAccount: accountCode, ruleId: null, isManualOverride: true, allocationMethod: "Manual" };
}
function ruleRow(accountCode: string): Row {
  return { suggestedGlAccount: accountCode, ruleId: 7, isManualOverride: false, allocationMethod: null };
}
function aiOnlyRow(accountCode: string): Row {
  return { suggestedGlAccount: accountCode, ruleId: null, isManualOverride: false, allocationMethod: "Future AI" };
}

const PATTERN = { prefix: "FNB OB Pmt", amountBand: "5000-25000", direction: "Debit" as const };

describe("aggregatePatternEvidence", () => {
  it("returns None strength with zero sample size for no historical rows", () => {
    const result = aggregatePatternEvidence(PATTERN, []);
    expect(result).toEqual({ pattern: PATTERN, sampleSize: 0, accounts: [], strength: "None", dominantAccountCode: null, isAmbiguous: false });
  });

  it("Case A/E shape — repeated HUMAN-confirmed allocations to the same account are Strong evidence pointing at that account", () => {
    const rows = [humanRow("6940"), humanRow("6940"), humanRow("6940"), aiOnlyRow("6100")];
    const result = aggregatePatternEvidence(PATTERN, rows);
    expect(result.strength).toBe("Strong");
    expect(result.dominantAccountCode).toBe("6940");
    expect(result.accounts.find((a) => a.accountCode === "6940")).toEqual({ accountCode: "6940", humanConfirmedCount: 3, aiOnlyCount: 0, totalCount: 3 });
  });

  it("a Banking Rule match counts as human-confirmed evidence, same as a manual override", () => {
    const rows = [ruleRow("6100"), ruleRow("6100"), ruleRow("6100")];
    const result = aggregatePatternEvidence(PATTERN, rows);
    expect(result.strength).toBe("Strong");
    expect(result.accounts[0]).toEqual({ accountCode: "6100", humanConfirmedCount: 3, aiOnlyCount: 0, totalCount: 3 });
  });

  it("Case G — ONLY prior AI allocations exist: never treated as equivalent to human-confirmed evidence, capped at Weak", () => {
    const rows = [aiOnlyRow("6100"), aiOnlyRow("6100"), aiOnlyRow("6100"), aiOnlyRow("6100"), aiOnlyRow("6100")];
    const result = aggregatePatternEvidence(PATTERN, rows);
    expect(result.strength).toBe("Weak");
    expect(result.accounts[0]).toEqual({ accountCode: "6100", humanConfirmedCount: 0, aiOnlyCount: 5, totalCount: 5 });
  });

  it("below the repeated-allocation threshold (1-2 human-confirmed) is Moderate, not Strong", () => {
    const rows = [humanRow("6940"), humanRow("6940")];
    const result = aggregatePatternEvidence(PATTERN, rows);
    expect(result.strength).toBe("Moderate");
    expect(result.dominantAccountCode).toBe("6940");
  });

  it("an ambiguous candidate set (two accounts tied on human-confirmed count) never claims a dominant account — 'do not force allocation'", () => {
    const rows = [humanRow("6940"), humanRow("6940"), humanRow("6940"), humanRow("6800"), humanRow("6800"), humanRow("6800")];
    const result = aggregatePatternEvidence(PATTERN, rows);
    expect(result.isAmbiguous).toBe(true);
    expect(result.dominantAccountCode).toBeNull();
    // Still Moderate, not Strong — a genuine tie is inherently less certain than an outright winner.
    expect(result.strength).toBe("Moderate");
  });

  it("rows with no suggestedGlAccount are ignored entirely — nothing to learn from an unresolved transaction", () => {
    const rows: Row[] = [{ suggestedGlAccount: null, ruleId: null, isManualOverride: false, allocationMethod: null }];
    const result = aggregatePatternEvidence(PATTERN, rows);
    expect(result.strength).toBe("None");
  });

  it("sampleSize reflects the raw row count, including ignored/unresolved rows, for honest transparency", () => {
    const rows: Row[] = [humanRow("6940"), { suggestedGlAccount: null, ruleId: null, isManualOverride: false, allocationMethod: null }];
    expect(aggregatePatternEvidence(PATTERN, rows).sampleSize).toBe(2);
  });
});

describe("buildCompanyHistoricalPatternEvidence — company scoping (Phase 28, multi-tenant requirement)", () => {
  beforeEach(() => {
    vi.mocked(listHistoricalAllocationsForPattern).mockReset().mockResolvedValue([]);
  });

  it("passes the exact companyId through to the repository query — never a global/cross-tenant lookup", async () => {
    await buildCompanyHistoricalPatternEvidence("company-b", { id: 501, description: "FNB OB Pmt Someone", beneficiary: "FNB OB Pmt Someone", debit: 15000, credit: 0 });
    expect(listHistoricalAllocationsForPattern).toHaveBeenCalledWith("company-b", "FNB OB Pmt", "Debit", 5000, 25000, 501, expect.any(Number));
  });

  it("excludes the transaction being classified from its own evidence", async () => {
    await buildCompanyHistoricalPatternEvidence("company-a", { id: 999, description: "Magtape Debit x", beneficiary: "Magtape Debit x", debit: 100, credit: 0 });
    const call = vi.mocked(listHistoricalAllocationsForPattern).mock.calls[0]!;
    expect(call[5]).toBe(999);
  });

  it("derives the correct pattern (prefix/band/direction) and passes it through to the repository call", async () => {
    await buildCompanyHistoricalPatternEvidence("company-a", { id: 1, description: "Overseas Bank Charge ref", beneficiary: "Overseas Bank Charge ref", debit: 143.23, credit: 0 });
    expect(listHistoricalAllocationsForPattern).toHaveBeenCalledWith("company-a", "Overseas Bank Charge", "Debit", 0, 500, 1, expect.any(Number));
  });

  it("bounds the query with a real, finite limit — never unbounded", async () => {
    await buildCompanyHistoricalPatternEvidence("company-a", { id: 1, description: "FNB OB Pmt x", beneficiary: "FNB OB Pmt x", debit: 1000, credit: 0 });
    const call = vi.mocked(listHistoricalAllocationsForPattern).mock.calls[0]!;
    expect(typeof call[6]).toBe("number");
    expect(call[6]).toBeGreaterThan(0);
    expect(call[6]).toBeLessThan(10_000);
  });

  it("aggregates whatever the repository returns into real evidence", async () => {
    vi.mocked(listHistoricalAllocationsForPattern).mockResolvedValue([humanRow("6940"), humanRow("6940"), humanRow("6940")]);
    const evidence = await buildCompanyHistoricalPatternEvidence("company-a", { id: 1, description: "FNB OB Pmt x", beneficiary: "FNB OB Pmt x", debit: 15000, credit: 0 });
    expect(evidence.strength).toBe("Strong");
    expect(evidence.dominantAccountCode).toBe("6940");
  });
});
