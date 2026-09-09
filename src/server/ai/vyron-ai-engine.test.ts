import { describe, expect, it, vi } from "vitest";
import { askVyronAi } from "./vyron-ai-engine";
import { AIProviderError, type AIProvider, type ConversationTurn, type EvidencePackage, type VyronAiStructuredResponse } from "./types";

function evidence(overrides: Partial<EvidencePackage> = {}): EvidencePackage {
  return {
    companyId: "co_1",
    companyName: "Acme",
    asOfDate: "2026-08-12",
    question: "What's worrying you most?",
    findings: [{ id: "cashflow-negative-balance", category: "CashFlow", severity: "Critical", title: "Cash balance is negative", description: "d", evidence: "e", recommendedAction: "Review Banking", actionHref: "/company/co_1/bank-accounts" }],
    situations: [],
    totalCash: -500,
    netProfit: null,
    intelligenceCentreHref: "/company/co_1/intelligence",
    ...overrides,
  };
}

function structuredResponse(overrides: Partial<VyronAiStructuredResponse> = {}): VyronAiStructuredResponse {
  return {
    answer: "VYRON found a negative cash balance.",
    keyPoints: ["Cash balance is negative"],
    evidenceReferences: [{ label: "VYRON Intelligence — Cash Flow", href: "/company/co_1/intelligence" }],
    recommendedActions: [{ label: "Review Banking", href: "/company/co_1/bank-accounts" }],
    uncertainties: [],
    ...overrides,
  };
}

function mockProvider(implementation: AIProvider["generateResponse"]): AIProvider {
  return { generateResponse: vi.fn(implementation) };
}

describe("askVyronAi", () => {
  it("returns the provider's validated, sanitized response on success (successful response)", async () => {
    const provider = mockProvider(async () => structuredResponse());
    const result = await askVyronAi(provider, evidence(), []);
    expect(result.answer).toBe("VYRON found a negative cash balance.");
    expect(result.recommendedActions).toEqual([{ label: "Review Banking", href: "/company/co_1/bank-accounts" }]);
  });

  it("passes the real system prompt and the exact evidence package to the provider", async () => {
    const generateResponse = vi.fn(async () => structuredResponse());
    const provider: AIProvider = { generateResponse };
    const ev = evidence();
    await askVyronAi(provider, ev, []);
    expect(generateResponse).toHaveBeenCalledWith(expect.objectContaining({ evidence: ev, systemPrompt: expect.stringContaining("You are VYRON AI") }));
  });

  it("forwards conversation history to the provider unchanged (multi-turn context)", async () => {
    const generateResponse = vi.fn(async () => structuredResponse());
    const provider: AIProvider = { generateResponse };
    const conversation: ConversationTurn[] = [
      { role: "user", content: "What's worrying you most?" },
      { role: "assistant", content: "VYRON currently identifies two business situations requiring attention." },
      { role: "user", content: "Tell me more about the first one." },
    ];
    await askVyronAi(provider, evidence({ question: "Tell me more about the first one." }), conversation);
    expect(generateResponse).toHaveBeenCalledWith(expect.objectContaining({ conversation }));
  });

  it("strips a fabricated action/evidence href even when the provider's own response is otherwise well-formed (no fabricated action links)", async () => {
    const provider = mockProvider(async () => structuredResponse({ recommendedActions: [{ label: "Post a journal entry", href: "/company/co_1/general-ledger/post" }] }));
    const result = await askVyronAi(provider, evidence(), []);
    expect(result.recommendedActions).toEqual([]);
  });

  it("throws malformed-response when the provider returns a structurally invalid object (malformed response)", async () => {
    const provider = mockProvider(async () => ({ executiveSummary: 42 }) as unknown as VyronAiStructuredResponse);
    await expect(askVyronAi(provider, evidence(), [])).rejects.toMatchObject({ code: "malformed-response" });
  });

  it("throws malformed-response for an empty question without ever calling the provider (empty question)", async () => {
    const generateResponse = vi.fn(async () => structuredResponse());
    const provider: AIProvider = { generateResponse };
    await expect(askVyronAi(provider, evidence({ question: "   " }), [])).rejects.toMatchObject({ code: "malformed-response" });
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it("propagates a missing-api-key error from the provider unchanged (missing API key)", async () => {
    const provider = mockProvider(async () => {
      throw new AIProviderError("missing-api-key", "VYRON AI's provider is not configured (missing API key).");
    });
    await expect(askVyronAi(provider, evidence(), [])).rejects.toMatchObject({ code: "missing-api-key" });
  });

  it("propagates a timeout error from the provider unchanged (provider timeout)", async () => {
    const provider = mockProvider(async () => {
      throw new AIProviderError("timeout", "VYRON AI's provider did not respond in time.");
    });
    await expect(askVyronAi(provider, evidence(), [])).rejects.toMatchObject({ code: "timeout" });
  });

  it("propagates a rate-limit error from the provider unchanged (rate limit)", async () => {
    const provider = mockProvider(async () => {
      throw new AIProviderError("rate-limit", "VYRON AI's provider rate limit was reached.");
    });
    await expect(askVyronAi(provider, evidence(), [])).rejects.toMatchObject({ code: "rate-limit" });
  });

  it("propagates a generic provider-error from the provider unchanged (provider failure)", async () => {
    const provider = mockProvider(async () => {
      throw new AIProviderError("provider-error", "VYRON AI's provider returned an error.");
    });
    await expect(askVyronAi(provider, evidence(), [])).rejects.toMatchObject({ code: "provider-error" });
  });

  it("never invokes the real production provider — every test here uses a mock (never call the real provider in tests)", async () => {
    const provider = mockProvider(async () => structuredResponse());
    await askVyronAi(provider, evidence(), []);
    expect(provider.generateResponse).toHaveBeenCalledTimes(1);
  });
});
