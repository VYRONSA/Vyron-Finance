/**
 * Mirrors `../../providers/gateway-provider.test.ts`'s own approach:
 * `generateObject` from `"ai"` is mocked so this file never makes a real
 * network call, and only the `model` argument / error propagation is
 * asserted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionClassificationEvidence } from "../types";

const { generateObjectMock } = vi.hoisted(() => ({ generateObjectMock: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: generateObjectMock };
});

import { createGatewayTransactionClassificationProvider } from "./gateway-classification-provider";

const ORIGINAL_VYRON_AI_MODEL = process.env.VYRON_AI_MODEL;

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
    candidateAccounts: [{ accountCode: "6100", description: "Groceries / Consumables", accountType: "Expense" }],
    similarPastClassifications: [],
    companyHistoricalPatterns: [],
    ...overrides,
  };
}

beforeEach(() => {
  generateObjectMock.mockReset();
  generateObjectMock.mockResolvedValue({ object: { accountCode: "6100", confidence: 96, explanation: "Matches a known grocery merchant." } });
});

afterEach(() => {
  if (ORIGINAL_VYRON_AI_MODEL === undefined) delete process.env.VYRON_AI_MODEL;
  else process.env.VYRON_AI_MODEL = ORIGINAL_VYRON_AI_MODEL;
});

describe("createGatewayTransactionClassificationProvider — model selection", () => {
  it("uses VYRON_AI_MODEL when set", async () => {
    process.env.VYRON_AI_MODEL = "anthropic/claude-opus-4-6";
    const provider = createGatewayTransactionClassificationProvider();

    await provider.classify(evidence());

    expect(generateObjectMock).toHaveBeenCalledWith(expect.objectContaining({ model: "anthropic/claude-opus-4-6" }));
  });

  it("falls back to the SAME default VYRON AI itself uses when VYRON_AI_MODEL is absent", async () => {
    delete process.env.VYRON_AI_MODEL;
    const provider = createGatewayTransactionClassificationProvider();

    await provider.classify(evidence());

    expect(generateObjectMock).toHaveBeenCalledWith(expect.objectContaining({ model: "openai/gpt-4o-mini" }));
  });
});

describe("createGatewayTransactionClassificationProvider — evidence and errors", () => {
  it("sends the evidence (including candidateAccounts) as part of the prompt", async () => {
    await createGatewayTransactionClassificationProvider().classify(evidence());

    const call = generateObjectMock.mock.calls[0]![0];
    const userMessage = call.messages[0].content as string;
    expect(userMessage).toContain("6100");
    expect(userMessage).toContain("Pick n Pay");
  });

  it("returns the raw object on success", async () => {
    const result = await createGatewayTransactionClassificationProvider().classify(evidence());
    expect(result).toEqual({ accountCode: "6100", confidence: 96, explanation: "Matches a known grocery merchant." });
  });

  // Phase 28, Part 7 — "The model should receive this as evidence. It
  // should NOT merely receive a huge list of raw transactions."
  it("sends companyHistoricalPatterns as compact, structured evidence when present — not a raw transaction dump", async () => {
    await createGatewayTransactionClassificationProvider().classify(
      evidence({
        companyHistoricalPatterns: [
          { narrationPrefix: "FNB OB Pmt", amountRange: "5000-25000", direction: "Debit", accounts: [{ accountCode: "6940", humanConfirmedCount: 18, aiOnlyCount: 0 }] },
        ],
      }),
    );

    const call = generateObjectMock.mock.calls[0]![0];
    const userMessage = call.messages[0].content as string;
    expect(userMessage).toContain("companyHistoricalPatterns");
    expect(userMessage).toContain("humanConfirmedCount");
    expect(userMessage).toContain("6940");
  });

  // Phase 28, Part 6/11 — the exact production defect: the system
  // prompt must actively instruct against treating a bank narration
  // prefix as evidence of anything on its own.
  it("instructs the model that generic narration prefixes are never evidence on their own", async () => {
    await createGatewayTransactionClassificationProvider().classify(evidence());
    const call = generateObjectMock.mock.calls[0]![0];
    expect(call.instructions as string).toContain("FNB OB Pmt");
    expect((call.instructions as string).toLowerCase()).toContain("never evidence on their own");
  });

  it("propagates a classified error (reusing the SAME classifyProviderError as VYRON AI) when the Gateway call fails", async () => {
    generateObjectMock.mockRejectedValue(new Error("429 Too Many Requests"));

    await expect(createGatewayTransactionClassificationProvider().classify(evidence())).rejects.toMatchObject({ code: "rate-limit" });
  });

  it("never leaks a secret value in a thrown error", async () => {
    generateObjectMock.mockRejectedValue(new Error("Provide an API key or Vercel access token via 'apiKey' option or 'AI_GATEWAY_API_KEY' environment variable."));

    await expect(createGatewayTransactionClassificationProvider().classify(evidence())).rejects.toMatchObject({ code: "missing-api-key" });
  });
});
