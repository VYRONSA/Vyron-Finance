import { describe, expect, it } from "vitest";
import { isValidVyronAiStructuredResponse, sanitizeVyronAiResponse } from "./response-validation";
import type { EvidencePackage, VyronAiStructuredResponse } from "./types";

function response(overrides: Partial<VyronAiStructuredResponse> = {}): VyronAiStructuredResponse {
  return {
    answer: "VYRON found a negative cash balance.",
    keyPoints: [],
    evidenceReferences: [],
    recommendedActions: [],
    uncertainties: [],
    ...overrides,
  };
}

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

describe("isValidVyronAiStructuredResponse", () => {
  it("accepts a well-formed response (successful response)", () => {
    expect(isValidVyronAiStructuredResponse(response())).toBe(true);
  });

  it("accepts a fully populated response", () => {
    expect(
      isValidVyronAiStructuredResponse(
        response({
          keyPoints: ["Point A"],
          evidenceReferences: [{ label: "VYRON Intelligence — Cash Collection Pressure", href: "/company/co_1/intelligence" }, { label: "Informational note", href: null }],
          recommendedActions: [{ label: "Review Banking", href: "/company/co_1/bank-accounts" }],
          uncertainties: ["The exact cause of the shortfall isn't in the evidence."],
        }),
      ),
    ).toBe(true);
  });

  it("rejects null/undefined/non-object values (malformed response)", () => {
    expect(isValidVyronAiStructuredResponse(null)).toBe(false);
    expect(isValidVyronAiStructuredResponse(undefined)).toBe(false);
    expect(isValidVyronAiStructuredResponse("a string")).toBe(false);
    expect(isValidVyronAiStructuredResponse(42)).toBe(false);
  });

  it("rejects a response with a missing or blank answer (malformed response)", () => {
    const rest: Record<string, unknown> = response();
    delete rest.answer;
    expect(isValidVyronAiStructuredResponse(rest)).toBe(false);
    expect(isValidVyronAiStructuredResponse(response({ answer: "   " }))).toBe(false);
  });

  it("rejects a response whose arrays are the wrong shape (malformed response)", () => {
    expect(isValidVyronAiStructuredResponse({ ...response(), keyPoints: "not an array" })).toBe(false);
    expect(isValidVyronAiStructuredResponse({ ...response(), evidenceReferences: [{ label: "ok" }] })).toBe(false);
    expect(isValidVyronAiStructuredResponse({ ...response(), recommendedActions: [{ label: "ok", href: null }] })).toBe(false);
    expect(isValidVyronAiStructuredResponse({ ...response(), uncertainties: [1, 2] })).toBe(false);
  });
});

describe("sanitizeVyronAiResponse", () => {
  it("keeps a recommended action whose href is real (present in the Evidence Package)", () => {
    const r = response({ recommendedActions: [{ label: "Review Banking", href: "/company/co_1/bank-accounts" }] });
    expect(sanitizeVyronAiResponse(r, evidence()).recommendedActions).toEqual([{ label: "Review Banking", href: "/company/co_1/bank-accounts" }]);
  });

  it("strips a recommended action whose href the model invented (no fabricated action links)", () => {
    const r = response({ recommendedActions: [{ label: "Post a journal entry", href: "/company/co_1/general-ledger/post" }] });
    expect(sanitizeVyronAiResponse(r, evidence()).recommendedActions).toEqual([]);
  });

  it("keeps an evidence reference with href: null (an honest reference with no route) untouched", () => {
    const r = response({ evidenceReferences: [{ label: "General context", href: null }] });
    expect(sanitizeVyronAiResponse(r, evidence()).evidenceReferences).toEqual([{ label: "General context", href: null }]);
  });

  it("strips an evidence reference whose href the model invented", () => {
    const r = response({ evidenceReferences: [{ label: "Fabricated source", href: "/company/co_1/some-invented-page" }] });
    expect(sanitizeVyronAiResponse(r, evidence()).evidenceReferences).toEqual([]);
  });

  it("always allows the real Intelligence Centre route", () => {
    const r = response({ evidenceReferences: [{ label: "VYRON Intelligence", href: "/company/co_1/intelligence" }] });
    expect(sanitizeVyronAiResponse(r, evidence()).evidenceReferences).toEqual([{ label: "VYRON Intelligence", href: "/company/co_1/intelligence" }]);
  });

  it("allows a real href sourced from a situation's own recommended actions, not just a finding's", () => {
    const withSituation = evidence({
      situations: [
        {
          id: "s",
          title: "Cash Collection Pressure",
          summary: "VYRON identified two related conditions.",
          severity: "Critical",
          category: "WorkingCapital",
          evidence: ["e"],
          contributingFindingIds: ["cashflow-negative-balance"],
          recommendedActions: [{ label: "Review Customer Aging", href: "/company/co_1/customers" }],
        },
      ],
    });
    const r = response({ recommendedActions: [{ label: "Review Customer Aging", href: "/company/co_1/customers" }] });
    expect(sanitizeVyronAiResponse(r, withSituation).recommendedActions).toEqual([{ label: "Review Customer Aging", href: "/company/co_1/customers" }]);
  });

  it("never mutates the original response object", () => {
    const r = response({ recommendedActions: [{ label: "Post a journal entry", href: "/company/co_1/some-invented-page" }] });
    const before = JSON.stringify(r);
    sanitizeVyronAiResponse(r, evidence());
    expect(JSON.stringify(r)).toBe(before);
  });
});
