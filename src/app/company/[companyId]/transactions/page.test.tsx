/**
 * Phase 26A — regression coverage for removing the "Transaction
 * Intelligence" header (title/subtitle, the 5-card summary bar, and the
 * Attention Queue) from the Transaction Explorer page. `TransactionExplorer`
 * itself is mocked with a lightweight stub exposing identifiable
 * "filters"/"grid" regions — this file only proves page-level
 * COMPOSITION (what's rendered, what's gone), never re-testing
 * `TransactionExplorer`'s own internals (filtering/allocation/export),
 * which remain covered by that component's own existing, untouched test
 * suite (`transaction-grid.test.tsx`, `transaction-bulk-action-bar.test.tsx`,
 * `transaction-column-chooser.test.tsx`) — proof those still pass is the
 * full test-suite run, not a duplicate here. `TransactionAttentionQueue`/
 * `ExecutiveSummaryBar` are untouched, still-tested components
 * (`transaction-attention-queue.test.tsx` still exists and passes) —
 * this page simply no longer renders them.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/supabase/is-configured", () => ({ isSupabaseConfigured: vi.fn(() => false) }));
vi.mock("@/components/financial/transaction-explorer/transaction-explorer", () => ({
  TransactionExplorer: (props: { companyId: string; initialTransactions: unknown[] }) => (
    <div data-testid="transaction-explorer-stub">
      <div data-testid="te-filters">filters for {props.companyId}</div>
      <div data-testid="te-action-bar">action / export controls</div>
      <div data-testid="te-grid">grid ({props.initialTransactions.length} rows)</div>
    </div>
  ),
}));

import TransactionExplorerPage from "./page";

async function renderPage(searchParams: { importBatch?: string } = {}) {
  const element = await TransactionExplorerPage({
    params: Promise.resolve({ companyId: "company-a" }),
    searchParams: Promise.resolve(searchParams),
  });
  return render(element);
}

describe("Transaction Explorer page — Phase 26A composition", () => {
  it("no longer renders the Transaction Intelligence title/subtitle", async () => {
    await renderPage();
    expect(screen.queryByText("Transaction Intelligence")).not.toBeInTheDocument();
    expect(screen.queryByText(/Review, match and allocate transactions that need your attention/)).not.toBeInTheDocument();
  });

  it("no longer renders the 5-card executive summary bar (Total Transactions / Needs Review / Matched-Allocated / Possible Duplicates / Unusual Transactions)", async () => {
    await renderPage();
    expect(screen.queryByText("Total Transactions")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs Review")).not.toBeInTheDocument();
    expect(screen.queryByText("Matched / Allocated")).not.toBeInTheDocument();
    expect(screen.queryByText("Possible Duplicates")).not.toBeInTheDocument();
    expect(screen.queryByText("Unusual Transactions")).not.toBeInTheDocument();
  });

  it("no longer renders the 'All Transactions' section heading that used to separate the Attention Queue from the grid", async () => {
    await renderPage();
    expect(screen.queryByText("All Transactions")).not.toBeInTheDocument();
  });

  it("still renders the Transaction Explorer's own filters", async () => {
    await renderPage();
    expect(screen.getByTestId("te-filters")).toBeInTheDocument();
  });

  it("still renders the Transaction Explorer's own action/export controls", async () => {
    await renderPage();
    expect(screen.getByTestId("te-action-bar")).toBeInTheDocument();
  });

  it("still renders the Transaction Explorer grid", async () => {
    await renderPage();
    expect(screen.getByTestId("te-grid")).toBeInTheDocument();
  });

  it("passes the real companyId and initial transaction data through to TransactionExplorer unchanged", async () => {
    await renderPage();
    const stub = screen.getByTestId("transaction-explorer-stub");
    expect(stub).toHaveTextContent("filters for company-a");
  });

  it("the page opens directly into the Transaction Explorer — it is the only major region rendered (no chrome above it)", async () => {
    const { container } = await renderPage();
    // The stub is the outermost real content region; no sibling
    // "intelligence" card/section exists in the rendered tree.
    expect(container.querySelectorAll('[data-testid="transaction-explorer-stub"]')).toHaveLength(1);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
