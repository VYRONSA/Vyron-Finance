import { describe, expect, it } from "vitest";
import { classifyTransactionWithAi } from "./classification-engine";
import { confidenceLevelFor } from "./types";
import type { TransactionClassificationEvidence, TransactionClassificationProvider } from "./types";

function evidence(overrides: Partial<TransactionClassificationEvidence> = {}): TransactionClassificationEvidence {
  return {
    companyId: "company-a",
    transactionId: 501,
    description: "PICK N PAY SOMERSET",
    beneficiary: "Pick n Pay",
    reference: "",
    amount: 1245.6,
    direction: "Debit",
    transactionDate: "2026-08-01",
    bankAccount: "Cheque Account",
    candidateAccounts: [
      { accountCode: "6100", description: "Groceries / Consumables", accountType: "Expense" },
      { accountCode: "6200", description: "Repairs & Maintenance", accountType: "Expense" },
    ],
    similarPastClassifications: [],
    companyHistoricalPatterns: [],
    ...overrides,
  };
}

function provider(classifyImpl: TransactionClassificationProvider["classify"]): TransactionClassificationProvider {
  return { classify: classifyImpl };
}

describe("confidenceLevelFor — deterministic bucketing", () => {
  it("is High at and above 85", () => {
    expect(confidenceLevelFor(85)).toBe("High");
    expect(confidenceLevelFor(96)).toBe("High");
    expect(confidenceLevelFor(100)).toBe("High");
  });

  it("is Medium from 60 up to (but not including) 85", () => {
    expect(confidenceLevelFor(60)).toBe("Medium");
    expect(confidenceLevelFor(84)).toBe("Medium");
  });

  it("is Low below 60", () => {
    expect(confidenceLevelFor(59)).toBe("Low");
    expect(confidenceLevelFor(0)).toBe("Low");
  });
});

describe("classifyTransactionWithAi — success", () => {
  it("returns a validated result for a valid, offered accountCode", async () => {
    const result = await classifyTransactionWithAi(
      provider(async () => ({ accountCode: "6100", confidence: 96, explanation: "Matches a known grocery merchant." })),
      evidence(),
    );

    expect(result).toEqual({
      transactionId: 501,
      companyId: "company-a",
      accountCode: "6100",
      confidence: 96,
      confidenceLevel: "High",
      explanation: "Matches a known grocery merchant.",
      modelUsed: "openai/gpt-4o-mini",
      // Migration 0099 — usage is only what the provider reported (none here).
      usage: null,
      // Phase 28 — `evidence()`'s default fixture has no
      // `companyHistoricalPatterns`, so accounting confidence correctly
      // falls back to the "no historical evidence" branch — capped at
      // Medium even though the model itself said High. This is exactly
      // the forensic report's own central point, proven here directly.
      accountingConfidence: {
        modelConfidence: 96,
        modelConfidenceLevel: "High",
        evidenceStrength: "None",
        agreesWithHistory: null,
        accountingConfidenceLevel: "Medium",
        explanation: "No company historical pattern exists yet for this type of transaction — the model's own confidence alone is never treated as sufficient for High accounting confidence.",
        reasoning: ["No company historical pattern exists yet for this type of transaction — the model's own confidence alone is never treated as sufficient for High accounting confidence."],
      },
    });
  });

  it("computes the Medium confidence level", async () => {
    const result = await classifyTransactionWithAi(provider(async () => ({ accountCode: "6100", confidence: 70, explanation: "Plausible match." })), evidence());
    expect(result.confidenceLevel).toBe("Medium");
  });

  it("computes the Low confidence level", async () => {
    const result = await classifyTransactionWithAi(provider(async () => ({ accountCode: "6100", confidence: 40, explanation: "Weak match." })), evidence());
    expect(result.confidenceLevel).toBe("Low");
  });

  it("clamps an out-of-range confidence value into 0-100", async () => {
    const result = await classifyTransactionWithAi(provider(async () => ({ accountCode: "6100", confidence: 140, explanation: "Overconfident." })), evidence());
    expect(result.confidence).toBe(100);
  });
});

describe("classifyTransactionWithAi — honest null (no fabrication)", () => {
  it("passes through a null accountCode as a real, non-error outcome", async () => {
    const result = await classifyTransactionWithAi(provider(async () => ({ accountCode: null, confidence: 0, explanation: "Nothing in the candidate list fits." })), evidence());

    expect(result.accountCode).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.confidenceLevel).toBe("Low");
  });
});

describe("classifyTransactionWithAi — hallucination defense", () => {
  it("rejects an accountCode that was never in candidateAccounts", async () => {
    await expect(
      classifyTransactionWithAi(provider(async () => ({ accountCode: "9999", confidence: 90, explanation: "Invented account." })), evidence()),
    ).rejects.toMatchObject({ code: "malformed-response" });
  });

  it("never persists/returns the hallucinated code even inside the thrown error", async () => {
    let caught: unknown;
    try {
      await classifyTransactionWithAi(provider(async () => ({ accountCode: "9999", confidence: 90, explanation: "Invented account." })), evidence());
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).not.toContain("9999");
  });
});

describe("classifyTransactionWithAi — tenant isolation", () => {
  it("only ever offers/returns accounts scoped to the evidence's own companyId's candidate list", async () => {
    const companyAEvidence = evidence({ companyId: "company-a", candidateAccounts: [{ accountCode: "6100", description: "Groceries", accountType: "Expense" }] });
    const companyBOnlyAccountCode = "7700"; // never in company-a's candidateAccounts

    await expect(
      classifyTransactionWithAi(provider(async () => ({ accountCode: companyBOnlyAccountCode, confidence: 90, explanation: "Cross-tenant leak attempt." })), companyAEvidence),
    ).rejects.toMatchObject({ code: "malformed-response" });
  });
});
