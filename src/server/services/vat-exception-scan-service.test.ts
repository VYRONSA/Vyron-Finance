/**
 * Overnight QA follow-up — `runVatIntelligenceScan` previously never
 * raised `VatRateConflict` at all (the "high-risk" signal it maps to had
 * no producer). This suite covers the new wiring (`detectVatRateConflict`
 * merged into the same raise loop as every other automatic VAT signal)
 * alongside a regression check that the pre-existing signals
 * (MissingVatNumber, IncorrectVatCode, etc.) still raise exactly as
 * before. Every dependency is mocked; nothing here touches a real
 * Supabase project.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/services/vat-transaction-service", () => ({ listVatDocuments: vi.fn() }));
vi.mock("@/server/repositories/vat-rate-history-repository", () => ({ listRateHistoryForCompany: vi.fn() }));
vi.mock("@/server/services/vat-treatment-service", () => ({ listVatTreatments: vi.fn() }));
vi.mock("@/server/services/vat-rule-service", () => ({ evaluateVatRules: vi.fn() }));
vi.mock("@/server/repositories/vat-exception-repository", () => ({ raiseVatExceptionIdempotent: vi.fn() }));

import { runVatIntelligenceScan } from "./vat-exception-scan-service";
import { listVatDocuments } from "@/server/services/vat-transaction-service";
import { listRateHistoryForCompany } from "@/server/repositories/vat-rate-history-repository";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { evaluateVatRules } from "@/server/services/vat-rule-service";
import { raiseVatExceptionIdempotent } from "@/server/repositories/vat-exception-repository";
import type { VatDocument } from "@/server/vat/vat-intelligence";
import type { VatTreatment } from "@/server/company-management/types";
import type { VatRateHistoryEntry } from "@/server/vat/types";

function doc(overrides: Partial<VatDocument> & { id: number }): VatDocument {
  return {
    documentType: "Supplier Bill", partyId: 1, partyName: "Acme Supplies", partyVatNumber: "4123456789",
    date: "2026-06-01", vatTreatmentCode: "STD", vatType: "Standard", grossAmount: 1150, vatAmount: 150,
    ...overrides,
  };
}

function treatment(overrides: Partial<VatTreatment> = {}): VatTreatment {
  return { id: 1, companyId: "company-a", code: "STD", name: "Standard Rated", rate: 15, vatType: "Standard", isActive: true, createdAt: "2020-01-01T00:00:00Z", ...overrides };
}

function rateEntry(overrides: Partial<VatRateHistoryEntry> = {}): VatRateHistoryEntry {
  return { id: 1, vatTreatmentId: 1, rate: 15, effectiveFrom: "2020-01-01", effectiveTo: null, createdAt: "2020-01-01T00:00:00Z", createdBy: "System", ...overrides };
}

beforeEach(() => {
  vi.mocked(listVatDocuments).mockReset().mockResolvedValue([]);
  vi.mocked(listRateHistoryForCompany).mockReset().mockResolvedValue(new Map());
  vi.mocked(listVatTreatments).mockReset().mockResolvedValue([treatment()]);
  vi.mocked(evaluateVatRules).mockReset().mockResolvedValue([]);
  vi.mocked(raiseVatExceptionIdempotent).mockReset().mockResolvedValue({} as never);
});

describe("runVatIntelligenceScan — VatRateConflict (new wiring)", () => {
  it("raises VatRateConflict when a document's VAT doesn't match the rate that was actually in effect on its own date", async () => {
    vi.mocked(listRateHistoryForCompany).mockResolvedValue(
      new Map([[1, [rateEntry({ rate: 15, effectiveFrom: "2020-01-01", effectiveTo: "2024-12-31" }), rateEntry({ id: 2, rate: 16, effectiveFrom: "2025-01-01", effectiveTo: null })]]]),
    );
    vi.mocked(listVatDocuments).mockResolvedValue([doc({ id: 501, date: "2024-06-01", grossAmount: 1160, vatAmount: 160 })]);

    const outcome = await runVatIntelligenceScan("company-a", "System");

    expect(raiseVatExceptionIdempotent).toHaveBeenCalledWith("company-a", expect.objectContaining({ exceptionType: "VatRateConflict", documentId: 501 }));
    expect(outcome.exceptionsRaised).toBeGreaterThanOrEqual(1);
  });

  it("does not raise VatRateConflict for a legitimate historical document correctly priced at the rate effective on its own date", async () => {
    vi.mocked(listRateHistoryForCompany).mockResolvedValue(
      new Map([[1, [rateEntry({ rate: 15, effectiveFrom: "2020-01-01", effectiveTo: "2024-12-31" }), rateEntry({ id: 2, rate: 16, effectiveFrom: "2025-01-01", effectiveTo: null })]]]),
    );
    vi.mocked(listVatDocuments).mockResolvedValue([doc({ id: 501, date: "2024-06-01", grossAmount: 1150, vatAmount: 150 })]);

    await runVatIntelligenceScan("company-a", "System");

    const rateConflictCalls = vi.mocked(raiseVatExceptionIdempotent).mock.calls.filter(([, input]) => input.exceptionType === "VatRateConflict");
    expect(rateConflictCalls).toHaveLength(0);
  });

  it("skips a treatment with no rate history at all, without crashing", async () => {
    vi.mocked(listVatTreatments).mockResolvedValue([treatment({ code: "NOHISTORY" })]);
    vi.mocked(listVatDocuments).mockResolvedValue([doc({ id: 501, vatTreatmentCode: "NOHISTORY" })]);

    await expect(runVatIntelligenceScan("company-a", "System")).resolves.toBeDefined();
  });

  it("scopes the entire scan to the exact company requested (tenant isolation)", async () => {
    await runVatIntelligenceScan("company-b", "System");

    expect(listVatDocuments).toHaveBeenCalledWith("company-b");
    expect(listRateHistoryForCompany).toHaveBeenCalledWith("company-b");
    expect(listVatTreatments).toHaveBeenCalledWith("company-b");
  });

  it("returns an empty, honest outcome for a company with no VAT documents at all", async () => {
    const outcome = await runVatIntelligenceScan("company-a", "System");
    expect(outcome).toEqual({ documentsScanned: 0, exceptionsRaised: 0, ruleMatches: 0 });
  });
});

describe("runVatIntelligenceScan — existing signals still raise as before (regression)", () => {
  it("still raises MissingVatNumber for a VAT-bearing document with no party VAT number", async () => {
    vi.mocked(listVatDocuments).mockResolvedValue([doc({ id: 501, partyVatNumber: null, vatAmount: 150 })]);

    await runVatIntelligenceScan("company-a", "System");

    expect(raiseVatExceptionIdempotent).toHaveBeenCalledWith("company-a", expect.objectContaining({ exceptionType: "MissingVatNumber", documentId: 501 }));
  });

  it("still raises IncorrectVatCode for a Zero Rated document carrying a non-zero VAT amount", async () => {
    vi.mocked(listVatDocuments).mockResolvedValue([doc({ id: 501, vatType: "ZeroRated", vatAmount: 150 })]);

    await runVatIntelligenceScan("company-a", "System");

    expect(raiseVatExceptionIdempotent).toHaveBeenCalledWith("company-a", expect.objectContaining({ exceptionType: "IncorrectVatCode", documentId: 501 }));
  });
});
