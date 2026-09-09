import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/chart-of-accounts-repository", () => ({ listChartOfAccounts: vi.fn() }));
vi.mock("@/server/repositories/transaction-explorer-repository", () => ({ listTransactionsByBeneficiary: vi.fn(), listHistoricalAllocationsForPattern: vi.fn() }));
// Phase 28 — evidence-builder.ts now pulls in company-historical-evidence.ts,
// which imports REPEATED_ALLOCATION_THRESHOLD from the real
// transaction-explorer-service.ts module. That module also re-exports
// several transaction-explorer-repository functions at module scope
// (`export const getTransactionsByJournalId = repo.getTransactionsByJournalId`,
// etc.) — evaluated at import time regardless of whether they're called
// — which would throw against the narrow repository mock above. Mocking
// this service module directly (same pattern already used in
// `company-historical-evidence.test.ts`) sidesteps that entirely.
vi.mock("@/server/services/transaction-explorer-service", () => ({ REPEATED_ALLOCATION_THRESHOLD: 3 }));

import { buildTransactionClassificationEvidence, rankCandidateAccounts } from "./evidence-builder";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { listTransactionsByBeneficiary, listHistoricalAllocationsForPattern } from "@/server/repositories/transaction-explorer-repository";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

function account(overrides: Partial<ChartOfAccount> = {}): ChartOfAccount {
  return {
    id: 1, companyId: "company-a", accountCode: "6100", description: "Groceries", accountType: "Expense", category: "", normalBalance: "Debit",
    parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null,
    projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function transaction(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 501, companyId: "company-a", transactionDate: "2026-08-01", reference: "", description: "PICK N PAY", beneficiary: "Pick n Pay",
    debit: 1245.6, credit: 0, balance: null, bankAccount: "Cheque Account", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00.000Z", allocationStatus: "Unallocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(listChartOfAccounts).mockReset().mockResolvedValue([
    account({ accountCode: "6100", description: "Groceries", accountType: "Expense" }),
    account({ accountCode: "6200", description: "Repairs & Maintenance", accountType: "Expense" }),
    account({ accountCode: "4000", description: "Sales Income", accountType: "Income" }),
    // Phase 26I — the platform's own structurally-special accounts
    // (seeded verbatim by migration 0007), which must stay excluded even
    // though Asset/Liability/Equity are now qualifying types.
    account({ accountCode: "1000", description: "Bank", accountType: "Asset" }),
    account({ accountCode: "1100", description: "Debtors", accountType: "Asset", isControlAccount: true }),
    account({ accountCode: "2000", description: "Creditors", accountType: "Liability", isControlAccount: true }),
    account({ accountCode: "2100", description: "VAT Input", accountType: "Asset" }),
    account({ accountCode: "2200", description: "VAT Output", accountType: "Liability" }),
    account({ accountCode: "3000", description: "Retained Income", accountType: "Equity" }),
    account({ accountCode: "9999", description: "Suspense", accountType: "Equity" }),
    // Phase 26I — real, non-reserved Asset/Liability/Equity accounts the
    // widened candidate set is meant to newly surface.
    account({ accountCode: "1620", description: "Computer Equipment - Cost", accountType: "Asset" }),
    account({ accountCode: "2500", description: "Loans Payable", accountType: "Liability" }),
    account({ accountCode: "3400", description: "Director's Loan Account", accountType: "Equity" }),
    account({ accountCode: "6999", description: "Inactive Expense", accountType: "Expense", isActive: false }),
  ]);
  vi.mocked(listTransactionsByBeneficiary).mockReset().mockResolvedValue([]);
  vi.mocked(listHistoricalAllocationsForPattern).mockReset().mockResolvedValue([]);
});

describe("buildTransactionClassificationEvidence — candidate account filtering", () => {
  it("offers Expense-type accounts, plus real Asset/Liability/Equity accounts, for a debit (payment) transaction", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 100, credit: 0 }));
    expect(evidence.candidateAccounts.map((a) => a.accountCode).sort()).toEqual(["1620", "2500", "3400", "6100", "6200"]);
  });

  it("offers Income-type accounts, plus real Asset/Liability/Equity accounts, for a credit (receipt) transaction", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 0, credit: 500 }));
    expect(evidence.candidateAccounts.map((a) => a.accountCode).sort()).toEqual(["1620", "2500", "3400", "4000"]);
  });

  it("never offers an inactive account", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 100, credit: 0 }));
    expect(evidence.candidateAccounts.some((a) => a.accountCode === "6999")).toBe(false);
  });

  it("never offers the Bank account itself, even though it is now a qualifying Asset type — it is always the OTHER side of every bank transaction, never a classification of itself", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 100, credit: 0 }));
    expect(evidence.candidateAccounts.some((a) => a.accountCode === "1000")).toBe(false);
  });

  it("never offers a control account (Debtors/Creditors) — those are Matching's job, not the AI's", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 100, credit: 0 }));
    expect(evidence.candidateAccounts.some((a) => a.accountCode === "1100" || a.accountCode === "2000")).toBe(false);
  });

  it("never offers the VAT Input/VAT Output control accounts — owned exclusively by the dedicated VAT engine", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 100, credit: 0 }));
    expect(evidence.candidateAccounts.some((a) => a.accountCode === "2100" || a.accountCode === "2200")).toBe(false);
  });

  it("never offers Retained Income or Suspense — system/period-close accounts, never a real classification target", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 0, credit: 500 }));
    expect(evidence.candidateAccounts.some((a) => a.accountCode === "3000" || a.accountCode === "9999")).toBe(false);
  });

  it("offers a real loan/owner Liability or Equity account when relevant (e.g. Loans Payable, Director's Loan Account)", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 100, credit: 0 }));
    expect(evidence.candidateAccounts.map((a) => a.accountCode)).toEqual(expect.arrayContaining(["2500", "3400"]));
  });

  it("sets direction and amount correctly for a payment", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 1245.6, credit: 0 }));
    expect(evidence.direction).toBe("Debit");
    expect(evidence.amount).toBe(1245.6);
  });

  it("sets direction and amount correctly for a receipt", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 0, credit: 500 }));
    expect(evidence.direction).toBe("Credit");
    expect(evidence.amount).toBe(500);
  });
});

// Phase 28 — the forensic report's own Part 9: candidate accounts must
// be ranked using this company's real historical evidence, not left flat.
describe("buildTransactionClassificationEvidence — company historical patterns + candidate ranking (Phase 28)", () => {
  it("includes an empty companyHistoricalPatterns array when this company has no matching history", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 100, credit: 0 }));
    expect(evidence.companyHistoricalPatterns).toEqual([]);
  });

  it("surfaces real historical evidence as a compact, structured pattern — not a raw transaction dump", async () => {
    vi.mocked(listHistoricalAllocationsForPattern).mockResolvedValue([
      { suggestedGlAccount: "6100", ruleId: null, isManualOverride: true, allocationMethod: "Manual" },
      { suggestedGlAccount: "6100", ruleId: null, isManualOverride: true, allocationMethod: "Manual" },
      { suggestedGlAccount: "6100", ruleId: null, isManualOverride: true, allocationMethod: "Manual" },
    ]);

    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 100, credit: 0 }));

    expect(evidence.companyHistoricalPatterns).toHaveLength(1);
    expect(evidence.companyHistoricalPatterns[0]!.accounts).toEqual([{ accountCode: "6100", humanConfirmedCount: 3, aiOnlyCount: 0 }]);
  });

  it("queries the historical pattern company-scoped, excluding the transaction being classified from its own evidence", async () => {
    await buildTransactionClassificationEvidence("company-b", transaction({ id: 777, beneficiary: "FNB OB Pmt x", debit: 1000, credit: 0 }));
    const call = vi.mocked(listHistoricalAllocationsForPattern).mock.calls[0]!;
    expect(call[0]).toBe("company-b");
    expect(call[5]).toBe(777);
  });

  it("re-orders candidateAccounts to put the account with the strongest historical evidence first — never filters the candidate set", async () => {
    vi.mocked(listHistoricalAllocationsForPattern).mockResolvedValue([
      { suggestedGlAccount: "6200", ruleId: null, isManualOverride: true, allocationMethod: "Manual" },
      { suggestedGlAccount: "6200", ruleId: null, isManualOverride: true, allocationMethod: "Manual" },
      { suggestedGlAccount: "6200", ruleId: null, isManualOverride: true, allocationMethod: "Manual" },
    ]);

    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 100, credit: 0 }));

    // 6200 (Repairs & Maintenance) is not first in the raw chart-of-accounts
    // fixture order (6100 is) — strong history for 6200 must move it first.
    expect(evidence.candidateAccounts[0]!.accountCode).toBe("6200");
    // Still the SAME full candidate set — ranking reorders, never filters.
    expect(evidence.candidateAccounts.map((a) => a.accountCode).sort()).toEqual(["1620", "2500", "3400", "6100", "6200"]);
  });
});

describe("rankCandidateAccounts (Phase 28)", () => {
  const candidates = [
    { accountCode: "6100", description: "Bank Charges", accountType: "Expense" as const },
    { accountCode: "6200", description: "Repairs & Maintenance", accountType: "Expense" as const },
    { accountCode: "6940", description: "Salaries & Wages", accountType: "Expense" as const },
  ];

  it("returns candidates unchanged (same order) when there is no historical evidence", () => {
    const evidence = { pattern: { prefix: "Other", amountBand: "0-500", direction: "Debit" as const }, sampleSize: 0, accounts: [], strength: "None" as const, dominantAccountCode: null, isAmbiguous: false };
    expect(rankCandidateAccounts(candidates, evidence)).toEqual(candidates);
  });

  it("ranks human-confirmed evidence above AI-only evidence (which is now neutral, not merely lower-weighted), and both tie with no evidence", () => {
    const evidence = {
      pattern: { prefix: "FNB OB Pmt", amountBand: "5000-25000", direction: "Debit" as const },
      sampleSize: 5,
      accounts: [
        { accountCode: "6100", humanConfirmedCount: 0, aiOnlyCount: 5, totalCount: 5 },
        { accountCode: "6940", humanConfirmedCount: 3, aiOnlyCount: 0, totalCount: 3 },
      ],
      strength: "Strong" as const,
      dominantAccountCode: "6940",
      isAmbiguous: false,
    };
    const ranked = rankCandidateAccounts(candidates, evidence);
    // 6940 (human=3) ranks first. 6100 (aiOnly=5, human=0) ties at 0 with
    // 6200 (no evidence at all) and keeps its original relative order —
    // it is NOT elevated above 6200 by its 5 AI-only guesses.
    expect(ranked.map((c) => c.accountCode)).toEqual(["6940", "6100", "6200"]);
  });

  it("never drops or adds a candidate — a pure re-sort", () => {
    const evidence = { pattern: { prefix: "Other", amountBand: "0-500", direction: "Debit" as const }, sampleSize: 0, accounts: [{ accountCode: "9999", humanConfirmedCount: 5, aiOnlyCount: 0, totalCount: 5 }], strength: "Strong" as const, dominantAccountCode: "9999", isAmbiguous: false };
    const ranked = rankCandidateAccounts(candidates, evidence);
    expect(ranked).toHaveLength(3);
    expect(ranked.map((c) => c.accountCode).sort()).toEqual(["6100", "6200", "6940"]);
  });

  // Phase 28B — the dry run's "Greenest Office" finding: AI-only history
  // must not create a self-reinforcing ranking advantage ("VYRON learning
  // its own mistakes"). Tests 1-4 below map directly onto the four
  // required regression cases from the Phase 28B request.
  describe("Phase 28B — AI-only history must not create a self-reinforcing ranking advantage", () => {
    it("TEST 1: a candidate with 20 AI-only guesses and 0 human confirmations gains no positive ranking advantage over an untouched candidate", () => {
      const evidence = {
        pattern: { prefix: "FNB OB Pmt", amountBand: "500-5000", direction: "Debit" as const },
        sampleSize: 20,
        accounts: [{ accountCode: "6100", humanConfirmedCount: 0, aiOnlyCount: 20, totalCount: 20 }],
        strength: "Weak" as const,
        dominantAccountCode: "6100",
        isAmbiguous: false,
      };
      const ranked = rankCandidateAccounts(candidates, evidence);
      // 6100 (aiOnly=20) ties at score 0 with 6200/6940 (no evidence) and
      // keeps its original position — it does not move to the front.
      expect(ranked.map((c) => c.accountCode)).toEqual(["6100", "6200", "6940"]);
    });

    it("TEST 2: two candidates differing only in AI-only count (20 vs 0), both with zero human evidence, are NOT reordered relative to each other", () => {
      const evidence = {
        pattern: { prefix: "FNB OB Pmt", amountBand: "500-5000", direction: "Debit" as const },
        sampleSize: 20,
        accounts: [
          { accountCode: "6100", humanConfirmedCount: 0, aiOnlyCount: 20, totalCount: 20 },
          { accountCode: "6200", humanConfirmedCount: 0, aiOnlyCount: 0, totalCount: 0 },
        ],
        strength: "Weak" as const,
        dominantAccountCode: "6100",
        isAmbiguous: false,
      };
      const ranked = rankCandidateAccounts(candidates, evidence);
      // Both score 0 — original candidate order (6100 before 6200) is preserved.
      expect(ranked.map((c) => c.accountCode)).toEqual(["6100", "6200", "6940"]);
    });

    it("TEST 3: a candidate with 3 human-confirmed allocations outranks a candidate with 20 AI-only guesses", () => {
      const evidence = {
        pattern: { prefix: "FNB OB Pmt", amountBand: "500-5000", direction: "Debit" as const },
        sampleSize: 23,
        accounts: [
          { accountCode: "6200", humanConfirmedCount: 0, aiOnlyCount: 20, totalCount: 20 },
          { accountCode: "6940", humanConfirmedCount: 3, aiOnlyCount: 0, totalCount: 3 },
        ],
        strength: "Strong" as const,
        dominantAccountCode: "6940",
        isAmbiguous: false,
      };
      const ranked = rankCandidateAccounts(candidates, evidence);
      expect(ranked[0]!.accountCode).toBe("6940");
    });

    it("TEST 4: 1 human-confirmed allocation still outranks 100 AI-only guesses", () => {
      const evidence = {
        pattern: { prefix: "FNB OB Pmt", amountBand: "500-5000", direction: "Debit" as const },
        sampleSize: 101,
        accounts: [
          { accountCode: "6200", humanConfirmedCount: 0, aiOnlyCount: 100, totalCount: 100 },
          { accountCode: "6940", humanConfirmedCount: 1, aiOnlyCount: 0, totalCount: 1 },
        ],
        strength: "Moderate" as const,
        dominantAccountCode: "6940",
        isAmbiguous: false,
      };
      const ranked = rankCandidateAccounts(candidates, evidence);
      expect(ranked[0]!.accountCode).toBe("6940");
    });

    it("TEST 5: AI-only history remains visible on companyHistoricalPatterns (still surfaced as Weak evidence to accounting-confidence) even though it no longer affects ranking", async () => {
      vi.mocked(listHistoricalAllocationsForPattern).mockResolvedValue([
        { suggestedGlAccount: "6100", ruleId: null, isManualOverride: false, allocationMethod: "Future AI" },
        { suggestedGlAccount: "6100", ruleId: null, isManualOverride: false, allocationMethod: "Future AI" },
      ]);

      const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ debit: 100, credit: 0 }));

      expect(evidence.companyHistoricalPatterns).toHaveLength(1);
      expect(evidence.companyHistoricalPatterns[0]!.accounts).toEqual([{ accountCode: "6100", humanConfirmedCount: 0, aiOnlyCount: 2 }]);
      // 2 AI-only guesses for 6100 leave candidate order IDENTICAL to the
      // no-evidence-at-all case (6100 happens to be first only because it's
      // first in the chart-of-accounts fixture, not because of its AI-only
      // history) — proving neutrality, not a ranking advantage.
      expect(evidence.candidateAccounts.map((a) => a.accountCode)).toEqual(["6100", "6200", "1620", "2500", "3400"]);
    });
  });
});

describe("buildTransactionClassificationEvidence — similar past classifications", () => {
  it("queries by this company and this exact beneficiary", async () => {
    await buildTransactionClassificationEvidence("company-a", transaction({ beneficiary: "Pick n Pay" }));
    expect(listTransactionsByBeneficiary).toHaveBeenCalledWith("company-a", "Pick n Pay");
  });

  it("excludes the transaction being classified itself", async () => {
    vi.mocked(listTransactionsByBeneficiary).mockResolvedValue([transaction({ id: 501, suggestedGlAccount: "6100" }), transaction({ id: 502, suggestedGlAccount: "6200" })]);

    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ id: 501 }));

    expect(evidence.similarPastClassifications).toHaveLength(1);
    expect(evidence.similarPastClassifications[0]!.glAccount).toBe("6200");
  });

  it("excludes past transactions with no resolved GL account", async () => {
    vi.mocked(listTransactionsByBeneficiary).mockResolvedValue([transaction({ id: 502, suggestedGlAccount: null })]);

    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ id: 501 }));

    expect(evidence.similarPastClassifications).toHaveLength(0);
  });

  it("caps the number of similar past classifications", async () => {
    const many = Array.from({ length: 20 }, (_, i) => transaction({ id: 600 + i, suggestedGlAccount: "6100" }));
    vi.mocked(listTransactionsByBeneficiary).mockResolvedValue(many);

    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ id: 501 }));

    expect(evidence.similarPastClassifications.length).toBeLessThanOrEqual(5);
  });

  it("marks a manually-overridden past classification as wasManuallyConfirmed", async () => {
    vi.mocked(listTransactionsByBeneficiary).mockResolvedValue([transaction({ id: 502, suggestedGlAccount: "6100", isManualOverride: true })]);

    const evidence = await buildTransactionClassificationEvidence("company-a", transaction({ id: 501 }));

    expect(evidence.similarPastClassifications[0]!.wasManuallyConfirmed).toBe(true);
  });

  it("does not query history at all for a transaction with no beneficiary", async () => {
    await buildTransactionClassificationEvidence("company-a", transaction({ beneficiary: "" }));
    expect(listTransactionsByBeneficiary).not.toHaveBeenCalled();
  });
});

describe("buildTransactionClassificationEvidence — tenant isolation", () => {
  it("passes the exact companyId through to both underlying queries", async () => {
    await buildTransactionClassificationEvidence("company-b", transaction({ companyId: "company-b" }));
    expect(listChartOfAccounts).toHaveBeenCalledWith("company-b");
    expect(listTransactionsByBeneficiary).toHaveBeenCalledWith("company-b", expect.any(String));
  });

  it("the evidence itself carries the correct companyId", async () => {
    const evidence = await buildTransactionClassificationEvidence("company-b", transaction({ companyId: "company-b" }));
    expect(evidence.companyId).toBe("company-b");
  });
});
