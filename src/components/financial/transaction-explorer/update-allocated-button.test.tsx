/**
 * "Update Allocated (n)" — the component the REAL Transaction Explorer
 * toolbar renders.
 *
 * PRODUCTION DEFECT this guards: authenticated production verification
 * found no "Update Allocated" button at all. The button had been removed
 * from `transaction-explorer.tsx` (its job folded into "Post to
 * Accounting"), but `update-allocated*.test.tsx` each rendered their own
 * stand-in `<button>Update Allocated</button>`, so the suite stayed green
 * while production shipped without it. The fix makes the toolbar and the
 * tests render this one component, and the wiring test below fails if the
 * toolbar ever stops rendering it again.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UpdateAllocatedButton } from "./update-allocated-button";

describe("UpdateAllocatedButton", () => {
  it("shows the committable count and commits on click", () => {
    const onUpdate = vi.fn();
    render(<UpdateAllocatedButton committableCount={2} blockedCount={0} saving={false} onUpdate={onUpdate} />);
    const button = screen.getByRole("button", { name: "Update Allocated (2)" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("Allocating is not posting"));
    fireEvent.click(button);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("is disabled with nothing to commit", () => {
    render(<UpdateAllocatedButton committableCount={0} blockedCount={0} saving={false} onUpdate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Update Allocated" })).toBeDisabled();
  });

  it("does not count blocked edits, and says why it is disabled", () => {
    render(<UpdateAllocatedButton committableCount={0} blockedCount={1} saving={false} onUpdate={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Update Allocated" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("1 pending change cannot be saved yet"));
  });

  it("cannot be clicked again while a commit is running", () => {
    const onUpdate = vi.fn();
    render(<UpdateAllocatedButton committableCount={3} blockedCount={0} saving onUpdate={onUpdate} />);
    const button = screen.getByRole("button", { name: "Updating 3…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("is disabled in Preview Mode with the Preview Mode explanation", () => {
    render(<UpdateAllocatedButton committableCount={2} blockedCount={0} saving={false} disabled disabledTitle="Preview only" onUpdate={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Update Allocated (2)" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Preview only");
  });
});

describe("the real Transaction Explorer toolbar renders it", () => {
  // `<TransactionExplorer>` cannot render under jsdom (TanStack Virtual —
  // see `transaction-explorer.test.tsx`), so its source is checked instead.
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/components/financial/transaction-explorer/transaction-explorer.tsx"), "utf8");
  const usage = /<UpdateAllocatedButton[\s\S]*?\/>/.exec(source)?.[0] ?? "";

  it("renders UpdateAllocatedButton", () => {
    expect(source).toContain('import { UpdateAllocatedButton } from "./update-allocated-button";');
    expect(usage).not.toBe("");
  });

  it("counts committable edits only, and reports the blocked ones", () => {
    expect(usage).toContain("committableCount={committableIds.size}");
    expect(usage).toContain("blockedCount={blockedEdits.length}");
  });

  it("commits through commitPendingAllocations — the grid's saveSelected → allocate-row path, never posting", () => {
    expect(usage).toContain("onUpdate={commitPendingAllocations}");
    expect(usage).toContain("saving={savingSelected}");
  });

  it("is always in the toolbar — not only when rows are selected", () => {
    // The bulk action bar returns null with no selection; the button must
    // not live there (pending edits are committed regardless of selection).
    const bar = fs.readFileSync(path.resolve(process.cwd(), "src/components/financial/transaction-explorer/transaction-bulk-action-bar.tsx"), "utf8");
    expect(bar).not.toContain("UpdateAllocatedButton");
    const toolbarStart = source.indexOf('<div className="ml-auto flex items-center gap-2">');
    expect(toolbarStart).toBeGreaterThan(-1);
    expect(source.indexOf("<UpdateAllocatedButton", toolbarStart)).toBeGreaterThan(toolbarStart);
    expect(source.indexOf("<UpdateAllocatedButton", toolbarStart)).toBeLessThan(source.indexOf("+ Add Transaction", toolbarStart));
  });
});
