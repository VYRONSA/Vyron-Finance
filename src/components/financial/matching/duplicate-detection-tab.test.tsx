/**
 * Phase 33A — the Supplier merge action now opens the explicit-choice
 * dialog instead of the old arbitrary-survivor ConfirmActionRow flow;
 * Customer/Merchant findings are deliberately untouched (out of scope —
 * see the Phase 33/33A reports).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/company/co_1/matching",
  useSearchParams: () => new URLSearchParams(),
}));

import { DuplicateDetectionTab } from "./duplicate-detection-tab";
import type { DuplicateFinding } from "@/server/services/duplicate-detection-service";

function finding(overrides: Partial<DuplicateFinding> & Pick<DuplicateFinding, "entityType" | "relatedId" | "groupIds">): DuplicateFinding {
  return {
    id: `${overrides.entityType}:${overrides.relatedId}`,
    confidence: 0.8,
    reason: "2 records share the normalized name.",
    evidence: "Matching IDs: 1, 2.",
    detailHref: "/company/co_1/suppliers",
    supportsMerge: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DuplicateDetectionTab — Supplier merge wiring (Phase 33A)", () => {
  it("a Supplier finding shows 'Merge Suppliers' and opens the explicit-choice dialog, not the old ConfirmActionRow", async () => {
    const findings = [finding({ entityType: "Supplier", relatedId: 1, groupIds: [1, 2] })];
    const preview = {
      supplierA: { id: 1, name: "Acme Supplies", supplierCode: "SUP-A", status: "Active", vatNumber: "", taxNumber: "", paymentTermsDays: 30, linkedRecordCount: 0 },
      supplierB: { id: 2, name: "ACME Supplies (dup)", supplierCode: "", status: "Active", vatNumber: "", taxNumber: "", paymentTermsDays: 0, linkedRecordCount: 0 },
    };
    // previewMode is false here specifically so the "Merge Suppliers"
    // button isn't disabled — this exercises the real fetch-driven path,
    // so both the initial findings list and the merge-preview call need
    // mocking.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("merge-preview")) return { ok: true, json: async () => preview };
        return { ok: true, json: async () => ({ findings }) };
      }),
    );

    render(<DuplicateDetectionTab companyId="co_1" previewMode={false} />);
    await waitFor(() => expect(screen.getByText("Merge Suppliers")).toBeInTheDocument());
    expect(screen.queryByText("Suggested Merge")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Merge Suppliers"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByText("Keep Supplier A")).toBeInTheDocument();
    expect(screen.getByText("Keep Supplier B")).toBeInTheDocument();
  });

  it("a Customer finding still shows 'Suggested Merge' (old flow), unchanged by this phase", () => {
    const findings = [finding({ entityType: "Customer", relatedId: 1, groupIds: [1, 2] })];
    render(<DuplicateDetectionTab companyId="co_1" previewMode initialFindings={findings} />);

    expect(screen.getByText("Suggested Merge")).toBeInTheDocument();
    expect(screen.queryByText("Merge Suppliers")).not.toBeInTheDocument();
  });

  it("a Merchant finding still shows 'Suggested Merge' (old flow), unchanged by this phase", () => {
    const findings = [finding({ entityType: "Merchant", relatedId: 1, groupIds: [1, 2] })];
    render(<DuplicateDetectionTab companyId="co_1" previewMode initialFindings={findings} />);

    expect(screen.getByText("Suggested Merge")).toBeInTheDocument();
  });

  it("a Supplier finding with no real second group member shows no merge action at all", () => {
    const findings = [finding({ entityType: "Supplier", relatedId: 1, groupIds: [1] })];
    render(<DuplicateDetectionTab companyId="co_1" previewMode initialFindings={findings} />);

    expect(screen.queryByText("Merge Suppliers")).not.toBeInTheDocument();
  });
});
