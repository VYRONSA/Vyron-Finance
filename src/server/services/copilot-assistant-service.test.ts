/**
 * Phase 15 — service-layer coverage for the hybrid VYRON Ask/VYRON AI
 * dispatcher. `askCopilot`'s deterministic path is exhaustively covered
 * already, per-question, in `copilot-assistant-engine.test.ts` — this
 * file covers the NEW routing/tagging/fallback/isolation behavior
 * around it, using a mock `AIProvider` (never the real gateway
 * provider — see `askVyronAi`'s own test file for why that's safe) and
 * mocked fetches so no real Supabase/network call ever happens.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { askCopilot } from "./copilot-assistant-service";
import { AIProviderError, type AIProvider } from "@/server/ai/types";
import type { Company } from "@/server/company-management/types";
import type { FinancialIntelligenceSummary } from "@/server/financial-intelligence/financial-intelligence-engine";

vi.mock("@/server/services/company-service", () => ({ getCompany: vi.fn() }));
vi.mock("@/server/services/company-intelligence-service", () => ({ getCompanyIntelligenceSummary: vi.fn() }));

import { getCompany } from "@/server/services/company-service";
import { getCompanyIntelligenceSummary } from "@/server/services/company-intelligence-service";

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "co_1",
    organisationId: "org_1",
    name: "Acme Ltd",
    industry: "Retail",
    status: "active",
    registrationNumber: "REG1",
    address: "1 Main St",
    financialYearStartMonth: 1,
    baseCurrencyCode: "ZAR",
    createdAt: "2026-01-01T00:00:00.000Z",
    tradingName: "",
    vatNumber: "",
    telephone: "",
    email: "",
    website: "",
    postalAddress: "",
    city: "", province: "", postalCode: "", country: "",
    ...overrides,
  };
}

function summary(overrides: Partial<FinancialIntelligenceSummary> = {}): FinancialIntelligenceSummary {
  return { findings: [], countBySeverity: { Critical: 0, High: 0, Medium: 0, Low: 0 }, totalCash: undefined, netProfit: undefined, ...overrides };
}

function mockProvider(implementation: AIProvider["generateResponse"]): AIProvider {
  return { generateResponse: vi.fn(implementation) };
}

const PERIOD = { periodStart: "2026-08-01", periodEnd: "2026-08-12", financialYearStartDate: "2026-01-01" };

beforeEach(() => {
  vi.mocked(getCompany).mockReset();
  vi.mocked(getCompanyIntelligenceSummary).mockReset();
});

describe("askCopilot — deterministic routing (regression, no behavior change)", () => {
  it("stamps answeredBy: VyronIntelligence on a matched deterministic question, without touching its own answer content", async () => {
    vi.mocked(getCompanyIntelligenceSummary).mockResolvedValue(summary());
    const answer = await askCopilot("co_1", "What needs my attention?", PERIOD.periodStart, PERIOD.periodEnd, PERIOD.financialYearStartDate);
    expect(answer.questionId).toBe("needs-attention");
    expect(answer.answeredBy).toBe("VyronIntelligence");
    expect(answer.executiveSummary).toContain("Nothing currently needs your attention");
  });

  it("never calls the AI provider for a matched deterministic question (deterministic fallback / hybrid routing)", async () => {
    vi.mocked(getCompanyIntelligenceSummary).mockResolvedValue(summary());
    const provider = mockProvider(async () => {
      throw new Error("should never be called for a deterministic question");
    });
    const answer = await askCopilot("co_1", "What needs my attention?", PERIOD.periodStart, PERIOD.periodEnd, PERIOD.financialYearStartDate, undefined, [], provider);
    expect(answer.answeredBy).toBe("VyronIntelligence");
    expect(provider.generateResponse).not.toHaveBeenCalled();
  });
});

describe("askCopilot — VYRON AI routing for open-ended questions", () => {
  it("routes an unmatched, genuinely open-ended question to the supplied AI provider and tags the answer VyronAI", async () => {
    vi.mocked(getCompany).mockResolvedValue(company());
    vi.mocked(getCompanyIntelligenceSummary).mockResolvedValue(summary());
    const provider = mockProvider(async () => ({
      answer: "VYRON currently identifies no active findings for your business.",
      keyPoints: [],
      evidenceReferences: [],
      recommendedActions: [],
      uncertainties: [],
    }));

    const answer = await askCopilot("co_1", "What's worrying you most?", PERIOD.periodStart, PERIOD.periodEnd, PERIOD.financialYearStartDate, undefined, [], provider);

    expect(provider.generateResponse).toHaveBeenCalledTimes(1);
    expect(answer.answeredBy).toBe("VyronAI");
    expect(answer.executiveSummary).toBe("VYRON currently identifies no active findings for your business.");
  });

  it("builds the evidence package ONLY from the requested company's own real data (evidence isolation)", async () => {
    const companyAFinding = { id: "a", category: "Banking" as const, severity: "High" as const, title: "Company A finding", description: "d", evidence: "Company A evidence", recommendedAction: null, actionHref: null, source: "Deterministic" as const };
    vi.mocked(getCompany).mockImplementation(async (id: string) => company({ id, name: id === "co_a" ? "Company A" : "Company B" }));
    vi.mocked(getCompanyIntelligenceSummary).mockImplementation(async (id: string) => (id === "co_a" ? summary({ findings: [companyAFinding] }) : summary({ findings: [] })));

    const provider = mockProvider(async () => ({ answer: "ok", keyPoints: [], evidenceReferences: [], recommendedActions: [], uncertainties: [] }));

    await askCopilot("co_a", "What's going on?", PERIOD.periodStart, PERIOD.periodEnd, PERIOD.financialYearStartDate, undefined, [], provider);

    const [{ evidence }] = vi.mocked(provider.generateResponse).mock.calls[0];
    expect(evidence.companyId).toBe("co_a");
    expect(evidence.companyName).toBe("Company A");
    expect(evidence.findings).toEqual([expect.objectContaining({ title: "Company A finding" })]);
  });

  it("degrades gracefully to a deterministic-style unavailable answer when the AI provider fails (deterministic fallback)", async () => {
    vi.mocked(getCompany).mockResolvedValue(company());
    vi.mocked(getCompanyIntelligenceSummary).mockResolvedValue(summary());
    const provider = mockProvider(async () => {
      throw new AIProviderError("provider-error", "VYRON AI's provider returned an error.");
    });

    const answer = await askCopilot("co_1", "What's worrying you most?", PERIOD.periodStart, PERIOD.periodEnd, PERIOD.financialYearStartDate, undefined, [], provider);

    expect(answer.answeredBy).toBe("VyronAI");
    expect(answer.executiveSummary).toContain("VYRON AI is temporarily unavailable");
    expect(answer.executiveSummary).not.toMatch(/undefined|\[object Object\]/);
  });

  it("degrades gracefully when fetching the company's own data itself throws (provider failure)", async () => {
    vi.mocked(getCompany).mockRejectedValue(new Error("database unreachable"));
    vi.mocked(getCompanyIntelligenceSummary).mockResolvedValue(summary());
    const provider = mockProvider(async () => ({ answer: "should not be reached", keyPoints: [], evidenceReferences: [], recommendedActions: [], uncertainties: [] }));

    const answer = await askCopilot("co_1", "What's worrying you most?", PERIOD.periodStart, PERIOD.periodEnd, PERIOD.financialYearStartDate, undefined, [], provider);

    expect(answer.executiveSummary).toContain("VYRON AI is temporarily unavailable");
    expect(provider.generateResponse).not.toHaveBeenCalled();
  });

  it("forwards multi-turn conversation context to the provider", async () => {
    vi.mocked(getCompany).mockResolvedValue(company());
    vi.mocked(getCompanyIntelligenceSummary).mockResolvedValue(summary());
    const provider = mockProvider(async () => ({ answer: "ok", keyPoints: [], evidenceReferences: [], recommendedActions: [], uncertainties: [] }));
    const conversation = [
      { role: "user" as const, content: "What's worrying you most?" },
      { role: "assistant" as const, content: "VYRON currently identifies two business situations requiring attention." },
    ];

    await askCopilot("co_1", "Please expand on your previous point.", PERIOD.periodStart, PERIOD.periodEnd, PERIOD.financialYearStartDate, undefined, conversation, provider);

    const [{ conversation: forwarded }] = vi.mocked(provider.generateResponse).mock.calls[0];
    expect(forwarded).toEqual(conversation);
  });
});
