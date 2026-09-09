import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/vat-treatment-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/vat-treatment-repository")>();
  return { ...actual, getVatTreatment: vi.fn(), updateVatTreatment: vi.fn() };
});
vi.mock("@/server/repositories/vat-rate-history-repository", () => ({ changeRate: vi.fn(), listRateHistory: vi.fn() }));

import { createVatTreatment, updateVatTreatment, validateVatTreatmentInput, ValidationError, NotFoundError } from "./vat-treatment-service";
import * as repo from "@/server/repositories/vat-treatment-repository";
import * as rateHistoryRepo from "@/server/repositories/vat-rate-history-repository";
import type { VatTreatment } from "@/server/company-management/types";

describe("validateVatTreatmentInput", () => {
  it("accepts a valid rate", () => {
    expect(() => validateVatTreatmentInput({ code: "Standard Rated", rate: 15 })).not.toThrow();
  });

  it("accepts the boundary rates 0 and 100", () => {
    expect(() => validateVatTreatmentInput({ code: "X", rate: 0 })).not.toThrow();
    expect(() => validateVatTreatmentInput({ code: "X", rate: 100 })).not.toThrow();
  });

  it("rejects a blank code", () => {
    expect(() => validateVatTreatmentInput({ code: "", rate: 15 })).toThrow(ValidationError);
  });

  it("rejects a negative or out-of-range rate", () => {
    expect(() => validateVatTreatmentInput({ code: "X", rate: -1 })).toThrow(ValidationError);
    expect(() => validateVatTreatmentInput({ code: "X", rate: 101 })).toThrow(ValidationError);
  });

  it("rejects a non-finite rate", () => {
    expect(() => validateVatTreatmentInput({ code: "X", rate: NaN })).toThrow(ValidationError);
  });
});

describe("createVatTreatment", () => {
  it("rejects a blank name even with a valid code/rate", () => {
    return expect(createVatTreatment("co_1", { code: "X", name: "", rate: 15 })).rejects.toThrow(ValidationError);
  });
});

function vatTreatment(overrides: Partial<VatTreatment> = {}): VatTreatment {
  return { id: 1, companyId: "co_1", code: "STD", name: "Standard Rated", rate: 15, vatType: "Standard", isActive: true, createdAt: "2025-01-01T00:00:00Z", ...overrides };
}

describe("updateVatTreatment — cross-company ownership guard (Phase 25K)", () => {
  beforeEach(() => {
    vi.mocked(repo.getVatTreatment).mockReset().mockResolvedValue(vatTreatment());
    vi.mocked(repo.updateVatTreatment).mockReset().mockResolvedValue(vatTreatment());
    vi.mocked(rateHistoryRepo.changeRate).mockReset().mockResolvedValue(undefined as never);
  });

  it("rejects a rate-only update for a VAT treatment that doesn't belong to this company, before ever touching rate history (the core fix)", async () => {
    vi.mocked(repo.getVatTreatment).mockResolvedValue(null);

    await expect(updateVatTreatment("company-a", 999, { rate: 25 }, "attacker@company-a.test")).rejects.toThrow(NotFoundError);

    expect(rateHistoryRepo.changeRate).not.toHaveBeenCalled();
  });

  it("rejects a name/vatType/isActive-only update for a VAT treatment that doesn't belong to this company", async () => {
    vi.mocked(repo.getVatTreatment).mockResolvedValue(null);

    await expect(updateVatTreatment("company-a", 999, { name: "Renamed" }, "attacker@company-a.test")).rejects.toThrow(NotFoundError);

    expect(repo.updateVatTreatment).not.toHaveBeenCalled();
  });

  it("proceeds normally (changes the rate) when the treatment genuinely belongs to this company", async () => {
    vi.mocked(repo.getVatTreatment).mockResolvedValue(vatTreatment({ id: 5, companyId: "co_1" }));

    await updateVatTreatment("co_1", 5, { rate: 16 }, "jane@vyron.test");

    expect(repo.getVatTreatment).toHaveBeenCalledWith("co_1", 5);
    expect(rateHistoryRepo.changeRate).toHaveBeenCalledWith(5, 16, expect.any(String), "jane@vyron.test");
  });
});
