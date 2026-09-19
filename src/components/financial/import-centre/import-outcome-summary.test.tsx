/**
 * Phase 5C — an import that left transactions unposted must SAY so.
 *
 * The rows are imported and unchanged either way, so nothing is lost; the
 * risk this guards against is presentational and real: reporting only
 * "Imported / Rules Applied" would let a permission refusal or a
 * processing bound look like a complete, fully-processed import.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImportOutcomeSummary } from "./import-outcome-summary";

function renderSummary(rulePass?: { notPermitted: number; notAttempted: number; stopReason: "time-budget" | "posting-limit" | null } | null) {
  return render(
    <ImportOutcomeSummary
      companyId="co_1"
      batchId="BATCH-1"
      importedCount={10}
      duplicateCount={0}
      rulesAllocatedCount={3}
      exceptionCount={0}
      rulePass={rulePass}
      onImportAnother={() => {}}
      onFinish={() => {}}
    />,
  );
}

describe("ImportOutcomeSummary — Phase 5C disclosure", () => {
  it("says nothing extra when the rule pass did everything", () => {
    renderSummary({ notPermitted: 0, notAttempted: 0, stopReason: null });
    expect(screen.queryByText(/Banking:Post/)).toBeNull();
    expect(screen.queryByText(/not processed by the Banking Rules/)).toBeNull();
  });

  it("is unchanged for a caller that passes no rule pass at all", () => {
    renderSummary(undefined);
    expect(screen.getByText("Import Complete")).toBeTruthy();
    expect(screen.queryByText(/Banking:Post/)).toBeNull();
  });

  it("discloses transactions left unposted for want of Banking:Post, and that they are still postable", () => {
    renderSummary({ notPermitted: 4, notAttempted: 0, stopReason: null });
    const notice = screen.getByText(/4 transactions were not posted/);
    expect(notice.textContent).toContain("Banking:Post");
    expect(notice.textContent).toContain("imported and unchanged");
    expect(notice.textContent).toContain("can still post");
  });

  it("uses singular wording for exactly one transaction", () => {
    renderSummary({ notPermitted: 1, notAttempted: 0, stopReason: null });
    expect(screen.getByText(/1 transaction was not posted/)).toBeTruthy();
  });

  it("discloses a posting-limit stop, and that the remainder will be picked up", () => {
    renderSummary({ notPermitted: 0, notAttempted: 7, stopReason: "posting-limit" });
    const notice = screen.getByText(/7 transactions were not processed/);
    expect(notice.textContent).toContain("posting limit");
    expect(notice.textContent).toContain("picked up by the next Banking Rules run");
  });

  it("names the time limit when that is why it stopped", () => {
    renderSummary({ notPermitted: 0, notAttempted: 2, stopReason: "time-budget" });
    expect(screen.getByText(/2 transactions were not processed/).textContent).toContain("time limit");
  });

  it("reports both conditions at once when both happened", () => {
    renderSummary({ notPermitted: 5, notAttempted: 3, stopReason: "posting-limit" });
    expect(screen.getByText(/5 transactions were not posted/)).toBeTruthy();
    expect(screen.getByText(/3 transactions were not processed/)).toBeTruthy();
  });
});
