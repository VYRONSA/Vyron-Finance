/**
 * Phase 33A — replaces Phase 33's flagged ambiguity (the old "Suggested
 * Merge" button derived a survivor from whichever finding row was
 * clicked, with no user-visible choice) with a real, explicit two-step
 * flow: pick a survivor from both real records shown side by side (never
 * preselected), then confirm an unambiguous KEEP/MERGE summary before
 * anything is written.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SupplierMergeDialog } from "./supplier-merge-dialog";

const PREVIEW = {
  supplierA: { id: 1, name: "Acme Supplies", supplierCode: "SUP-A", status: "Active", vatNumber: "4123456789", taxNumber: "", paymentTermsDays: 30, linkedRecordCount: 12 },
  supplierB: { id: 2, name: "ACME Supplies (dup)", supplierCode: "", status: "Active", vatNumber: "", taxNumber: "", paymentTermsDays: 0, linkedRecordCount: 0 },
};

function fetchMockFor(previewOverride: unknown = PREVIEW, mergeResult?: unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("merge-preview")) {
      return { ok: true, json: async () => previewOverride };
    }
    if (init?.method === "POST") {
      return {
        ok: true,
        json: async () =>
          mergeResult ?? {
            result: {
              survivingSupplierId: 1, survivingSupplierName: "Acme Supplies", survivingSupplierCode: "SUP-A",
              mergedSupplierId: 2, mergedSupplierName: "ACME Supplies (dup)", mergedSupplierCode: "",
              recordsRepointed: { bills: 1, bankTransactions: 0, purchaseOrders: 0, goodsReceivedNotes: 0, payments: 0, stockItems: 0, merchants: 0, bankTransactionSplits: 0, fixedAssets: 0, openingBalanceEntries: 0, supplierContacts: 0, supplierAddresses: 0 },
              totalRecordsRepointed: 1,
              duplicateStatus: "Inactive",
            },
          },
      };
    }
    return { ok: true, json: async () => ({}) };
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SupplierMergeDialog (Phase 33A)", () => {
  it("displays both suppliers, with both names and both codes visible", async () => {
    vi.stubGlobal("fetch", fetchMockFor());
    render(<SupplierMergeDialog companyId="co_1" supplierAId={1} supplierBId={2} onClose={() => {}} onMerged={() => {}} />);

    await waitFor(() => expect(screen.getByText("Acme Supplies")).toBeInTheDocument());
    expect(screen.getByText("ACME Supplies (dup)")).toBeInTheDocument();
    expect(screen.getByText("SUP-A")).toBeInTheDocument();
    // Supplier B's blank code renders as an em dash, not silently omitted.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("no survivor is selected by default, and the Continue button is disabled", async () => {
    vi.stubGlobal("fetch", fetchMockFor());
    render(<SupplierMergeDialog companyId="co_1" supplierAId={1} supplierBId={2} onClose={() => {}} onMerged={() => {}} />);
    await waitFor(() => expect(screen.getByText("Acme Supplies")).toBeInTheDocument());

    expect(screen.getByText("Keep Supplier A")).toBeInTheDocument();
    expect(screen.getByText("Keep Supplier B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("selecting Supplier A enables Continue and clearly marks A as the choice", async () => {
    vi.stubGlobal("fetch", fetchMockFor());
    render(<SupplierMergeDialog companyId="co_1" supplierAId={1} supplierBId={2} onClose={() => {}} onMerged={() => {}} />);
    await waitFor(() => expect(screen.getByText("Acme Supplies")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Keep Supplier A"));
    expect(screen.getByText("✓ Keeping Supplier A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled();
  });

  it("selecting Supplier B enables Continue and clearly marks B as the choice", async () => {
    vi.stubGlobal("fetch", fetchMockFor());
    render(<SupplierMergeDialog companyId="co_1" supplierAId={1} supplierBId={2} onClose={() => {}} onMerged={() => {}} />);
    await waitFor(() => expect(screen.getByText("Acme Supplies")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Keep Supplier B"));
    expect(screen.getByText("✓ Keeping Supplier B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled();
  });

  it("the final confirmation step names the correct survivor (Keep) and duplicate (Merge/deactivate)", async () => {
    vi.stubGlobal("fetch", fetchMockFor());
    render(<SupplierMergeDialog companyId="co_1" supplierAId={1} supplierBId={2} onClose={() => {}} onMerged={() => {}} />);
    await waitFor(() => expect(screen.getByText("Acme Supplies")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Keep Supplier A"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Merge suppliers?")).toBeInTheDocument();
    expect(screen.getByText("Keep")).toBeInTheDocument();
    expect(screen.getByText(/Merge \(deactivate\)/)).toBeInTheDocument();
    // Both the Keep card and the sentence above it name the real survivor.
    expect(screen.getAllByText("Acme Supplies").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("ACME Supplies (dup)").length).toBeGreaterThanOrEqual(2);
  });

  it("the confirmation naming flips correctly when Supplier B is chosen instead", async () => {
    vi.stubGlobal("fetch", fetchMockFor());
    render(<SupplierMergeDialog companyId="co_1" supplierAId={1} supplierBId={2} onClose={() => {}} onMerged={() => {}} />);
    await waitFor(() => expect(screen.getByText("Acme Supplies")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Keep Supplier B"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const keepLabel = screen.getByText("Keep").closest("div");
    expect(keepLabel?.textContent).toContain("ACME Supplies (dup)");
  });

  // Phase 33B — the approved correction: Cancel at the FINAL confirmation
  // step must close the dialog entirely (not just step back to survivor
  // selection), send no request, and leave both suppliers unchanged.
  it("Cancel at the final confirmation step closes the dialog entirely, performs no merge, and calls neither the merge endpoint nor onMerged", async () => {
    const fetchMock = fetchMockFor();
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    const onMerged = vi.fn();
    render(<SupplierMergeDialog companyId="co_1" supplierAId={1} supplierBId={2} onClose={onClose} onMerged={onMerged} />);
    await waitFor(() => expect(screen.getByText("Acme Supplies")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Keep Supplier A"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Merge suppliers?")).toBeInTheDocument(); // confirms we reached the final step
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Dialog closed: the parent's onClose fired, unlocking the caller to
    // unmount it (this test renders the component standalone, so we
    // assert the callback contract rather than DOM removal, which is the
    // parent's responsibility — see duplicate-detection-tab.test.tsx for
    // the full mount/unmount proof).
    expect(onClose).toHaveBeenCalledTimes(1);

    // No merge occurred: neither the merge endpoint fired nor onMerged
    // was called — client-side supplier data (the preview state, still
    // rendered here) is unchanged, matching what a real, un-merged pair
    // looks like.
    const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCalls).toHaveLength(0);
    expect(onMerged).not.toHaveBeenCalled();
    expect(screen.queryByText("Supplier merged successfully.")).not.toBeInTheDocument();
    // Both suppliers still show their original, unmerged Active status —
    // nothing about their client-visible state changed.
    expect(screen.getAllByText("Active")).toHaveLength(2);
    // Local state was genuinely reset (survivor cleared, step reset to
    // "choosing"), not just visually hidden — the choosing view's own
    // "Keep Supplier A/B" controls are back, not the confirmation step's.
    expect(screen.getByText("Keep Supplier A")).toBeInTheDocument();
    expect(screen.getByText("Keep Supplier B")).toBeInTheDocument();
    expect(screen.queryByText("Merge suppliers?")).not.toBeInTheDocument();
  });

  it("a successful merge shows the success banner with Kept/Deactivated/Records transferred", async () => {
    vi.stubGlobal("fetch", fetchMockFor());
    const onMerged = vi.fn();
    render(<SupplierMergeDialog companyId="co_1" supplierAId={1} supplierBId={2} onClose={() => {}} onMerged={onMerged} />);
    await waitFor(() => expect(screen.getByText("Acme Supplies")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Keep Supplier A"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Merge Suppliers" }));

    await waitFor(() => expect(screen.getByText("Supplier merged successfully.")).toBeInTheDocument());
    expect(screen.getByText("Kept:")).toBeInTheDocument();
    expect(screen.getByText("Deactivated:")).toBeInTheDocument();
    expect(screen.getByText("Records transferred:")).toBeInTheDocument();
    expect(onMerged).toHaveBeenCalled();
  });

  it("zero linked records are explicitly stated, not just shown as a bare 0", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMockFor(PREVIEW, {
        result: {
          survivingSupplierId: 1, survivingSupplierName: "Acme Supplies", survivingSupplierCode: "SUP-A",
          mergedSupplierId: 2, mergedSupplierName: "ACME Supplies (dup)", mergedSupplierCode: "",
          recordsRepointed: { bills: 0, bankTransactions: 0, purchaseOrders: 0, goodsReceivedNotes: 0, payments: 0, stockItems: 0, merchants: 0, bankTransactionSplits: 0, fixedAssets: 0, openingBalanceEntries: 0, supplierContacts: 0, supplierAddresses: 0 },
          totalRecordsRepointed: 0,
          duplicateStatus: "Inactive",
        },
      }),
    );
    render(<SupplierMergeDialog companyId="co_1" supplierAId={1} supplierBId={2} onClose={() => {}} onMerged={() => {}} />);
    await waitFor(() => expect(screen.getByText("Acme Supplies")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Keep Supplier A"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Merge Suppliers" }));

    await waitFor(() => expect(screen.getByText(/this duplicate had no linked records/)).toBeInTheDocument());
  });

  it("a failed merge shows 'Supplier merge failed' with the real reason — never a success message", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("merge-preview")) return { ok: true, json: async () => PREVIEW };
      if (init?.method === "POST") return { ok: false, status: 400, json: async () => ({ error: "Supplier \"Acme Supplies\" is not Active — only Active suppliers can be merged." }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const onMerged = vi.fn();
    render(<SupplierMergeDialog companyId="co_1" supplierAId={1} supplierBId={2} onClose={() => {}} onMerged={onMerged} />);
    await waitFor(() => expect(screen.getByText("Acme Supplies")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Keep Supplier A"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Merge Suppliers" }));

    await waitFor(() => expect(screen.getByText("Supplier merge failed")).toBeInTheDocument());
    expect(screen.getByText(/only Active suppliers can be merged/)).toBeInTheDocument();
    expect(screen.queryByText("Supplier merged successfully.")).not.toBeInTheDocument();
    expect(onMerged).not.toHaveBeenCalled();
  });
});
