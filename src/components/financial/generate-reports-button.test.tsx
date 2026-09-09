/**
 * Phase 38 — Phase 37's production audit found Inactive suppliers
 * (deactivated merge duplicates) selectable in this component's
 * report-scope picker. Scoping a run to a deactivated supplier would
 * only ever produce an empty, meaningless result.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { GenerateReportsButton } from "./generate-reports-button";
import type { Supplier } from "@/server/accounting/types";

function supplier(overrides: Partial<Supplier> & Pick<Supplier, "id" | "name">): Supplier {
  return {
    companyId: "co_1", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 0, spendingLimit: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GenerateReportsButton — report-scope picker Active-only (Phase 38)", () => {
  it("the Supplier scope picker shows only the Active supplier", () => {
    render(
      <GenerateReportsButton
        companyId="co_1"
        previewMode={false}
        suppliers={[supplier({ id: 1, name: "Active Supplies", status: "Active" }), supplier({ id: 2, name: "Deactivated Duplicate", status: "Inactive" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /scope run/i }));

    const picker = screen.getByLabelText("Supplier") as HTMLSelectElement;
    const optionLabels = Array.from(picker.options).map((o) => o.text);
    expect(optionLabels).toContain("Active Supplies");
    expect(optionLabels).not.toContain("Deactivated Duplicate");
  });
});
